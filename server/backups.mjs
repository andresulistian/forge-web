import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const excluded = new Set([
  "node_modules",
  "dist",
  ".next",
  ".expo",
  "target",
  ".turbo",
]);
const MAX_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_FILES = 25000;
const inside = (parent, child) =>
  child === parent || child.startsWith(parent + path.sep);
const backupHome = () =>
  process.platform === "darwin"
    ? path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "Forge Web",
        "backups",
      )
    : path.join(
        process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
        "forge-web",
        "backups",
      );

async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function copyFiles(source, destination, root, files, mode = "create") {
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    if (mode === "create" && excluded.has(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    const stat = await fs.lstat(from);
    if (stat.isSymbolicLink()) {
      if (mode === "verify")
        throw Error(
          "Backup memuat tautan simbolik dan tidak dapat dipulihkan.",
        );
      continue;
    }
    if (stat.isDirectory()) {
      if (mode !== "verify")
        await fs.mkdir(to, { recursive: true, mode: 0o700 });
      await copyFiles(from, to, root, files, mode);
    } else if (stat.isFile()) {
      if (
        files.length >= MAX_FILES ||
        (files.bytes || 0) + stat.size > MAX_BYTES
      )
        throw Error(
          "Backup melampaui batas 25.000 file atau 2 GB. Pindahkan file besar terlebih dahulu.",
        );
      files.bytes = (files.bytes || 0) + stat.size;
      if (mode !== "verify") await fs.copyFile(from, to);
      files.push({
        name: path
          .relative(root, mode === "verify" ? from : to)
          .split(path.sep)
          .join("/"),
        size: stat.size,
        sha256: await digest(mode === "verify" ? from : to),
      });
    } else throw Error("Backup memuat file yang tidak didukung.");
  }
}

export class BackupManager {
  constructor(workspace, root = process.env.FORGE_BACKUP_DIR || backupHome()) {
    this.ws = workspace;
    this.root = path.resolve(root);
    this.working = false;
  }

  async ensureRoot() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const root = await fs.realpath(this.root);
    const data = await fs.realpath(this.ws.dataDir);
    if (inside(root, data) || inside(data, root))
      throw Error("Lokasi backup harus berada di luar folder data Forge.");
  }

  async list() {
    await this.ensureRoot();
    const result = [];
    for (const entry of await fs.readdir(this.root, { withFileTypes: true })) {
      if (
        !entry.isDirectory() ||
        !/^forge-[0-9TZ-]+-[a-f0-9]{8}$/.test(entry.name)
      )
        continue;
      try {
        const manifest = JSON.parse(
          await fs.readFile(
            path.join(this.root, entry.name, "manifest.json"),
            "utf8",
          ),
        );
        if (manifest.version === 1 && manifest.id === entry.name)
          result.push({
            id: entry.name,
            createdAt: manifest.createdAt,
            projects: manifest.projects.length,
            files: manifest.files.length,
            bytes: manifest.bytes,
            label: manifest.label,
          });
      } catch {
        /* Unfinished backups are hidden. */
      }
    }
    return {
      location: this.root,
      backups: result.sort((a, b) => b.id.localeCompare(a.id)),
    };
  }

  async create(label = "Manual") {
    if (this.working) throw Error("Backup atau pemulihan sedang berjalan.");
    this.working = true;
    try {
      return await this.snapshot(label);
    } finally {
      this.working = false;
    }
  }

  async snapshot(label) {
    await this.ensureRoot();
    const id = `forge-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}`;
    const pending = path.join(this.root, `.pending-${id}`);
    const final = path.join(this.root, id);
    await fs.mkdir(pending, { mode: 0o700 });
    try {
      const files = [];
      const data = path.join(pending, "data");
      await fs.mkdir(data, { mode: 0o700 });
      for (const entry of await fs.readdir(this.ws.dataDir, {
        withFileTypes: true,
      })) {
        if (
          [
            "forge.sqlite",
            "forge.sqlite-wal",
            "forge.sqlite-shm",
            "projects",
            "runtime",
          ].includes(entry.name)
        )
          continue;
        const stat = await fs.lstat(path.join(this.ws.dataDir, entry.name));
        if (stat.isSymbolicLink()) continue;
        if (stat.isDirectory()) {
          await fs.mkdir(path.join(data, entry.name), { mode: 0o700 });
          await copyFiles(
            path.join(this.ws.dataDir, entry.name),
            path.join(data, entry.name),
            pending,
            files,
          );
        } else if (stat.isFile()) {
          if (
            files.length >= MAX_FILES ||
            (files.bytes || 0) + stat.size > MAX_BYTES
          )
            throw Error("Backup melampaui batas 25.000 file atau 2 GB.");
          files.bytes = (files.bytes || 0) + stat.size;
          await fs.copyFile(
            path.join(this.ws.dataDir, entry.name),
            path.join(data, entry.name),
          );
          files.push({
            name: `data/${entry.name}`,
            size: stat.size,
            sha256: await digest(path.join(data, entry.name)),
          });
        }
      }
      const projects = [];
      for (const [index, project] of this.ws.projects.entries()) {
        const folder = `p${String(index + 1).padStart(5, "0")}`;
        const root = path.join(pending, "projects", folder);
        const source = await fs.realpath(project.path);
        if (inside(source, this.root))
          throw Error("Folder backup tidak boleh berada di dalam proyek.");
        await fs.mkdir(root, { recursive: true, mode: 0o700 });
        await copyFiles(source, root, pending, files);
        projects.push({ id: project.id, name: project.name, folder });
      }
      const sqlite = path.join(data, "forge.sqlite");
      this.ws.store.requireDb().prepare("VACUUM INTO ?").run(sqlite);
      const stat = await fs.stat(sqlite);
      if (
        files.length >= MAX_FILES ||
        (files.bytes || 0) + stat.size > MAX_BYTES
      )
        throw Error("Backup melampaui batas 25.000 file atau 2 GB.");
      files.push({
        name: "data/forge.sqlite",
        size: stat.size,
        sha256: await digest(sqlite),
      });
      const manifest = {
        version: 1,
        id,
        label: String(label).slice(0, 80),
        createdAt: new Date().toISOString(),
        projects,
        files,
        bytes: files.reduce((n, file) => n + file.size, 0),
      };
      await fs.writeFile(
        path.join(pending, "manifest.json"),
        JSON.stringify(manifest),
        { mode: 0o600 },
      );
      await fs.rename(pending, final);
      return {
        id,
        createdAt: manifest.createdAt,
        projects: projects.length,
        files: files.length,
        bytes: manifest.bytes,
        label: manifest.label,
      };
    } catch (error) {
      await fs.rm(pending, { recursive: true, force: true });
      throw error;
    }
  }

  async verify(id) {
    if (!/^forge-[0-9TZ-]+-[a-f0-9]{8}$/.test(id))
      throw Error("Backup tidak valid.");
    await this.ensureRoot();
    const dir = path.join(this.root, id);
    if (!(await fs.lstat(dir)).isDirectory())
      throw Error("Backup tidak valid.");
    const manifest = JSON.parse(
      await fs.readFile(path.join(dir, "manifest.json"), "utf8"),
    );
    if (
      manifest.version !== 1 ||
      manifest.id !== id ||
      !Array.isArray(manifest.projects) ||
      !Array.isArray(manifest.files) ||
      manifest.files.length > MAX_FILES + 1
    )
      throw Error("Manifest backup tidak valid.");
    const observed = [];
    for (const name of ["data", "projects"]) {
      if (!(await fs.lstat(path.join(dir, name))).isDirectory())
        throw Error("Isi backup tidak lengkap.");
      await copyFiles(path.join(dir, name), "", dir, observed, "verify");
    }
    const expected = new Map(manifest.files.map((file) => [file.name, file]));
    const mismatch = observed.find(
      (file) =>
        !expected.has(file.name) ||
        expected.get(file.name).size !== file.size ||
        expected.get(file.name).sha256 !== file.sha256,
    );
    if (
      expected.size !== manifest.files.length ||
      expected.size !== observed.length ||
      mismatch
    )
      throw Error(
        `Backup berubah atau rusak${mismatch ? ` (${mismatch.name})` : ""}. Data saat ini tidak diubah.`,
      );
    const temp = await fs.mkdtemp(path.join(this.root, ".verify-"));
    await fs.copyFile(
      path.join(dir, "data", "forge.sqlite"),
      path.join(temp, "forge.sqlite"),
    );
    const db = new DatabaseSync(path.join(temp, "forge.sqlite"), {
      readOnly: true,
    });
    try {
      if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
        throw Error("Database backup rusak.");
      const rows = db.prepare("SELECT id, name FROM projects").all();
      const index = new Map(rows.map((item) => [item.id, item]));
      if (
        rows.length !== manifest.projects.length ||
        manifest.projects.some(
          (item) =>
            item.name !== index.get(item.id)?.name ||
            !/^p\d{5}$/.test(item.folder),
        )
      )
        throw Error("Daftar proyek backup tidak sesuai database.");
    } finally {
      db.close();
      await fs.rm(temp, { recursive: true, force: true });
    }
    return { dir, manifest };
  }

  async restore(id) {
    if (this.working) throw Error("Backup atau pemulihan sedang berjalan.");
    this.working = true;
    let staging = "";
    let previous = "";
    try {
      const { dir, manifest } = await this.verify(id);
      await this.snapshot("Otomatis sebelum pemulihan");
      // macOS exposes /var through /private/var; Workspace.safeFile compares
      // canonical paths, so saved project roots must use the canonical form.
      const canonicalDataDir = await fs.realpath(this.ws.dataDir);
      staging = path.join(
        path.dirname(this.ws.dataDir),
        `.forge-restore-${randomBytes(6).toString("hex")}`,
      );
      previous = path.join(
        path.dirname(this.ws.dataDir),
        `.forge-before-restore-${randomBytes(6).toString("hex")}`,
      );
      await fs.mkdir(staging, { mode: 0o700 });
      await copyFiles(path.join(dir, "data"), staging, staging, [], "restore");
      for (const project of manifest.projects) {
        const dest = path.join(staging, "projects", project.folder);
        await fs.mkdir(dest, { recursive: true, mode: 0o700 });
        await copyFiles(
          path.join(dir, "projects", project.folder),
          dest,
          staging,
          [],
          "restore",
        );
      }
      const db = new DatabaseSync(path.join(staging, "forge.sqlite"));
      try {
        const update = db.prepare("UPDATE projects SET path = ? WHERE id = ?");
        db.exec("BEGIN IMMEDIATE");
        for (const project of manifest.projects)
          update.run(
            path.join(canonicalDataDir, "projects", project.folder),
            project.id,
          );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      } finally {
        db.close();
      }
      this.ws.close();
      try {
        await fs.rename(this.ws.dataDir, previous);
        await fs.rename(staging, this.ws.dataDir);
        staging = "";
        await this.ws.init();
      } catch (error) {
        if (
          await fs
            .stat(previous)
            .then(() => true)
            .catch(() => false)
        ) {
          await fs.rm(this.ws.dataDir, { recursive: true, force: true });
          await fs.rename(previous, this.ws.dataDir);
        }
        await this.ws.init();
        throw error;
      }
      await fs.rm(previous, { recursive: true, force: true }).catch(() => {});
      return { ok: true, projects: this.ws.projects, restored: id };
    } finally {
      if (staging)
        await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
      this.working = false;
    }
  }

  async ensureDaily() {
    if (!this.ws.projects.length || this.working) return;
    const { backups } = await this.list();
    const today = new Date().toISOString().slice(0, 10);
    if (!backups.some((item) => item.createdAt?.startsWith(today)))
      await this.create("Otomatis saat Forge dibuka");
  }
}
