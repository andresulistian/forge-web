import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.db = null;
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(this.dataDir, "forge.sqlite"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS messages_project_id
        ON messages(project_id, id);
      CREATE TABLE IF NOT EXISTS agent_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        scope TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_history_scope
        ON agent_history(channel, scope, id);
      CREATE TABLE IF NOT EXISTS settings (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(scope, key)
      );
      CREATE TABLE IF NOT EXISTS migrations (
        name TEXT PRIMARY KEY,
        completed_at INTEGER NOT NULL
      );
    `);
    await this.migrateLegacyFiles();
    return this;
  }

  requireDb() {
    if (!this.db) throw Error("Database Forge belum siap.");
    return this.db;
  }

  migrated(name) {
    return Boolean(
      this.requireDb()
        .prepare("SELECT 1 FROM migrations WHERE name = ?")
        .get(name),
    );
  }

  finishMigration(name) {
    this.requireDb()
      .prepare(
        "INSERT OR REPLACE INTO migrations(name, completed_at) VALUES (?, ?)",
      )
      .run(name, Date.now());
  }

  async migrateLegacyFiles() {
    if (this.migrated("json-v1")) return;
    let projects = [];
    try {
      projects = JSON.parse(
        await fs.readFile(path.join(this.dataDir, "projects.json"), "utf8"),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const db = this.requireDb();
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const project of Array.isArray(projects) ? projects : []) {
        if (
          !project ||
          typeof project.id !== "string" ||
          typeof project.name !== "string" ||
          typeof project.path !== "string"
        )
          continue;
        this.upsertProject(project);
        let input = "";
        try {
          input = await fs.readFile(
            path.join(this.dataDir, project.id + ".jsonl"),
            "utf8",
          );
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        if (!input || this.messageCount(project.id)) continue;
        for (const line of input.split("\n").filter(Boolean)) {
          try {
            this.addMessage(project.id, JSON.parse(line));
          } catch {
            /* Continue importing valid lines if one legacy entry is damaged. */
          }
        }
      }
      await this.migrateHistoryDir("ollama-memory", "ollama");
      await this.migrateHistoryDir("guide-memory", "guide");
      this.finishMigration("json-v1");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async migrateHistoryDir(directory, channel) {
    const root = path.join(this.dataDir, directory);
    let files = [];
    try {
      files = await fs.readdir(root);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const file of files.filter((name) => name.endsWith(".jsonl"))) {
      const scope = file.slice(0, -6);
      if (!scope || this.historyCount(channel, scope)) continue;
      const input = await fs.readFile(path.join(root, file), "utf8");
      for (const line of input.split("\n").filter(Boolean)) {
        try {
          this.addHistory(channel, scope, JSON.parse(line));
        } catch {
          /* Continue importing valid lines if one legacy entry is damaged. */
        }
      }
    }
  }

  projects() {
    return this.requireDb()
      .prepare(
        "SELECT id, name, path, created_at AS createdAt FROM projects ORDER BY created_at, rowid",
      )
      .all()
      .map((row) => ({ ...row }));
  }

  upsertProject(project) {
    this.requireDb()
      .prepare(
        `INSERT INTO projects(id, name, path, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           path = excluded.path,
           created_at = excluded.created_at`,
      )
      .run(
        project.id,
        project.name,
        project.path,
        project.createdAt || Date.now(),
      );
  }

  deleteProject(projectId) {
    return this.deleteProjects([projectId]);
  }

  deleteProjects(projectIds) {
    const db = this.requireDb();
    db.exec("BEGIN IMMEDIATE");
    try {
      const history = db.prepare("DELETE FROM agent_history WHERE scope = ?");
      const settings = db.prepare("DELETE FROM settings WHERE key = ?");
      const project = db.prepare("DELETE FROM projects WHERE id = ?");
      for (const projectId of projectIds) {
        history.run(projectId);
        settings.run(projectId);
        project.run(projectId);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  addMessage(projectId, entry) {
    const value = { ...entry, time: Number(entry.time) || Date.now() };
    this.requireDb()
      .prepare(
        "INSERT INTO messages(project_id, payload, created_at) VALUES (?, ?, ?)",
      )
      .run(projectId, JSON.stringify(value), value.time);
    return value;
  }

  messageCount(projectId) {
    return Number(
      this.requireDb()
        .prepare("SELECT COUNT(*) AS count FROM messages WHERE project_id = ?")
        .get(projectId).count,
    );
  }

  messages(projectId, limit = 100) {
    return this.requireDb()
      .prepare(
        `SELECT payload FROM (
           SELECT id, payload FROM messages
           WHERE project_id = ? ORDER BY id DESC LIMIT ?
         ) ORDER BY id`,
      )
      .all(projectId, limit)
      .map((row) => JSON.parse(row.payload));
  }

  addHistory(channel, scope, entry) {
    const value = { ...entry, time: Number(entry.time) || Date.now() };
    this.requireDb()
      .prepare(
        `INSERT INTO agent_history(channel, scope, payload, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(channel, scope, JSON.stringify(value), value.time);
    return value;
  }

  historyCount(channel, scope) {
    return Number(
      this.requireDb()
        .prepare(
          "SELECT COUNT(*) AS count FROM agent_history WHERE channel = ? AND scope = ?",
        )
        .get(channel, scope).count,
    );
  }

  history(channel, scope, limit = 200) {
    return this.requireDb()
      .prepare(
        `SELECT payload FROM (
           SELECT id, payload FROM agent_history
           WHERE channel = ? AND scope = ? ORDER BY id DESC LIMIT ?
         ) ORDER BY id`,
      )
      .all(channel, scope, limit)
      .map((row) => JSON.parse(row.payload));
  }

  clearHistory(channel, scope) {
    this.requireDb()
      .prepare("DELETE FROM agent_history WHERE channel = ? AND scope = ?")
      .run(channel, scope);
  }

  setting(scope, key) {
    const row = this.requireDb()
      .prepare("SELECT value FROM settings WHERE scope = ? AND key = ?")
      .get(scope, key);
    return row ? JSON.parse(row.value) : null;
  }

  settingKeys(scope) {
    return this.requireDb()
      .prepare(
        "SELECT settings.key FROM settings JOIN projects ON projects.id = settings.key WHERE settings.scope = ?",
      )
      .all(scope)
      .map((row) => row.key);
  }

  setSetting(scope, key, value) {
    this.requireDb()
      .prepare(
        `INSERT INTO settings(scope, key, value, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(scope, key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
      )
      .run(scope, key, JSON.stringify(value), Date.now());
    return value;
  }

  close() {
    this.db?.close();
    this.db = null;
  }
}
