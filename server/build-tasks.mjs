import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";

const exec = promisify(execFile);
const MAX_FILES = 400;
const MAX_DIFF_BYTES = 1024 * 1024;
const MAX_REVIEW_BYTES = 12 * 1024 * 1024;

const slash = (value) => value.split(path.sep).join("/");

function relativeFile(value) {
  if (typeof value !== "string" || !value || value.includes("\0") || path.isAbsolute(value))
    throw Error("Path perubahan tidak valid.");
  const normalized = path.normalize(value);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith(".." + path.sep) ||
    normalized.split(path.sep).some((part) => [".git", ".forge"].includes(part))
  )
    throw Error("Path perubahan tidak diizinkan.");
  return slash(normalized);
}

async function exists(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export class BuildTaskManager {
  constructor(workspace, emit = () => {}, options = {}) {
    this.workspace = workspace;
    this.emit = emit;
    this.root = path.resolve(options.root || path.join(workspace.dataDir, "build-worktrees"));
    this.records = path.resolve(options.records || path.join(workspace.dataDir, "build-tasks"));
    this.reviews = path.resolve(options.reviews || path.join(workspace.dataDir, "build-reviews"));
    this.tasks = new Map();
    this.ready = null;
  }

  async init() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
      await fs.mkdir(this.records, { recursive: true, mode: 0o700 });
      await fs.mkdir(this.reviews, { recursive: true, mode: 0o700 });
      for (const name of await fs.readdir(this.records)) {
        if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
        try {
          const task = JSON.parse(await fs.readFile(path.join(this.records, name), "utf8"));
          if (task?.id && task?.projectId && task?.path) this.tasks.set(task.id, task);
        } catch {
          // Ignore interrupted/corrupt records. They remain on disk for manual recovery.
        }
      }
    })();
    return this.ready;
  }

  async gitDir(project, args, options = {}) {
    const result = await exec(
      "git",
      [
        "--git-dir",
        this.workspace.gitDir(project),
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "user.name=Forge",
        "-c",
        "user.email=forge@localhost",
        ...args,
      ],
      {
        cwd: options.cwd || project.path,
        timeout: options.timeout || 30000,
        maxBuffer: options.maxBuffer || 8 * 1024 * 1024,
        encoding: options.encoding || "utf8",
      },
    );
    return result.stdout;
  }

  async taskGit(task, args, options = {}) {
    const result = await exec(
      "git",
      [
        "-C",
        task.path,
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "user.name=Forge",
        "-c",
        "user.email=forge@localhost",
        ...args,
      ],
      {
        cwd: task.path,
        timeout: options.timeout || 30000,
        maxBuffer: options.maxBuffer || 8 * 1024 * 1024,
        encoding: options.encoding || "utf8",
      },
    );
    return result.stdout;
  }

  async save(task) {
    const file = path.join(this.records, `${task.id}.json`);
    const pending = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(pending, JSON.stringify(task), { mode: 0o600 });
    await fs.rename(pending, file);
    this.tasks.set(task.id, task);
    return task;
  }

  async get(project, id) {
    await this.init();
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
      throw Error("Build task tidak valid.");
    const task = this.tasks.get(id);
    if (!task || task.projectId !== project.id) throw Error("Build task tidak ditemukan.");
    return task;
  }

  async list(project) {
    await this.init();
    return [...this.tasks.values()]
      .filter((task) => task.projectId === project.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ path: _path, branch: _branch, ...task }) => task);
  }

  async start(project, metadata = {}) {
    await this.init();
    await this.workspace.checkpoint(project, "Otomatis sebelum Build terisolasi");
    const baseCommit = (await this.workspace.git(project, ["rev-parse", "HEAD"])).trim();
    const id = randomUUID();
    const branch = `forge/build/${id}`;
    const taskPath = path.join(this.root, project.id, id);
    await fs.mkdir(path.dirname(taskPath), { recursive: true, mode: 0o700 });
    const task = {
      id,
      projectId: project.id,
      baseCommit,
      taskCommit: null,
      branch,
      path: taskPath,
      status: "active",
      appliedFiles: [],
      provider: String(metadata.provider || "").slice(0, 80),
      model: String(metadata.model || "").slice(0, 160),
      createdAt: Date.now(),
      finishedAt: null,
      appliedAt: null,
      error: null,
    };
    try {
      await this.gitDir(project, ["worktree", "add", "-b", branch, taskPath, baseCommit]);
      await this.save(task);
    } catch (error) {
      await this.gitDir(project, ["worktree", "remove", "--force", taskPath]).catch(() => {});
      await fs.rm(taskPath, { recursive: true, force: true });
      await this.gitDir(project, ["branch", "-D", branch]).catch(() => {});
      throw error;
    }
    this.emit("build-task-started", { projectId: project.id, taskId: id });
    return {
      task: { ...task, path: undefined, branch: undefined },
      project: {
        ...project,
        path: taskPath,
        agentSessionKey: `build:${id}`,
        buildTaskId: id,
      },
    };
  }

  async finish(project, id, error = null) {
    const task = await this.get(project, id);
    if (task.status !== "active") return this.review(project, id);
    if (error) {
      try {
        await this.taskGit(task, ["add", "-A", "--", "."]);
        await this.taskGit(task, ["commit", "--allow-empty", "-m", `Forge Build parsial ${id.slice(0, 8)}`]);
        task.taskCommit = (await this.taskGit(task, ["rev-parse", "HEAD"])).trim();
        task.files = await this.computeChanges(task);
        await this.archiveDiffs(task);
      } catch (snapshotError) {
        task.snapshotError = String(snapshotError.message || snapshotError).slice(0, 1000);
      }
      task.status = "failed";
      task.error = String(error.message || error).slice(0, 2000);
      task.finishedAt = Date.now();
      await this.save(task);
      const result = await this.review(project, id);
      this.emit("build-task-failed", {
        projectId: project.id,
        taskId: id,
        error: task.error,
        files: result.files.length,
      });
      return result;
    }
    await this.taskGit(task, ["add", "-A", "--", "."]);
    await this.taskGit(task, ["commit", "--allow-empty", "-m", `Forge Build ${id.slice(0, 8)}`]);
    task.taskCommit = (await this.taskGit(task, ["rev-parse", "HEAD"])).trim();
    task.files = await this.computeChanges(task);
    await this.archiveDiffs(task);
    task.status = "review";
    task.finishedAt = Date.now();
    await this.save(task);
    const result = await this.review(project, id);
    this.emit("build-review-ready", {
      projectId: project.id,
      taskId: id,
      files: result.files.length,
    });
    return result;
  }

  async changes(task) {
    if (Array.isArray(task.files)) return task.files.map((file) => ({ ...file }));
    return this.computeChanges(task);
  }

  async computeChanges(task) {
    if (!task.taskCommit) return [];
    const raw = await this.taskGit(task, [
      "diff",
      "--name-status",
      "-z",
      "--no-renames",
      task.baseCommit,
      task.taskCommit,
      "--",
    ]);
    const parts = raw.split("\0");
    const files = [];
    for (let index = 0; index + 1 < parts.length && files.length < MAX_FILES; index += 2) {
      const status = parts[index];
      if (!/^[AMD]$/.test(status)) continue;
      const file = relativeFile(parts[index + 1]);
      const stat = await this.taskGit(task, [
        "diff",
        "--numstat",
        "--no-renames",
        task.baseCommit,
        task.taskCommit,
        "--",
        file,
      ]);
      const [added = "0", deleted = "0"] = stat.trim().split("\t");
      files.push({
        path: file,
        status,
        added: added === "-" ? 0 : Number(added) || 0,
        deleted: deleted === "-" ? 0 : Number(deleted) || 0,
        binary: added === "-" || deleted === "-",
      });
    }
    return files;
  }

  async review(project, id) {
    const task = await this.get(project, id);
    if (!["review", "applied", "discarded", "failed"].includes(task.status))
      throw Error("Build task belum siap ditinjau.");
    const all = await this.changes(task);
    const applied = new Set(task.appliedFiles || []);
    return {
      task: {
        id: task.id,
        projectId: task.projectId,
        status: task.status,
        baseCommit: task.baseCommit,
        taskCommit: task.taskCommit,
        provider: task.provider,
        model: task.model,
        createdAt: task.createdAt,
        finishedAt: task.finishedAt,
        appliedAt: task.appliedAt,
        error: task.error,
      },
      files: all.map((file) => ({ ...file, applied: applied.has(file.path) })),
    };
  }

  async diff(project, id, file) {
    const task = await this.get(project, id);
    if (!task.taskCommit) throw Error("Build task belum memiliki hasil.");
    const name = relativeFile(file);
    const change = (await this.changes(task)).find((item) => item.path === name);
    if (!change) throw Error("File bukan bagian dari perubahan Build ini.");
    const archived = await this.archivedDiff(task, name);
    if (archived) return { ...change, ...archived };
    const worktree = await exists(task.path);
    if (!worktree?.isDirectory())
      return {
        ...change,
        patch: "Diff untuk Build lama ini tidak tersedia karena worktree sudah dibersihkan. File yang diterapkan tetap aman di proyek utama.",
        truncated: false,
        unavailable: true,
      };
    return { ...change, ...(await this.liveDiff(task, change)) };
  }

  reviewPath(task, file) {
    const hash = createHash("sha256").update(relativeFile(file)).digest("hex");
    return path.join(this.reviews, task.id, `${hash}.json`);
  }

  async liveDiff(task, change) {
    const output = await this.taskGit(
      task,
      [
        "diff",
        "--no-ext-diff",
        "--no-color",
        "--unified=3",
        "--no-renames",
        task.baseCommit,
        task.taskCommit,
        "--",
        change.path,
      ],
      { maxBuffer: MAX_DIFF_BYTES * 8 },
    );
    const bytes = Buffer.byteLength(output);
    return {
      patch: bytes > MAX_DIFF_BYTES ? output.slice(0, MAX_DIFF_BYTES) : output,
      truncated: bytes > MAX_DIFF_BYTES,
    };
  }

  async archivedDiff(task, file) {
    try {
      const value = JSON.parse(await fs.readFile(this.reviewPath(task, file), "utf8"));
      if (value.file !== file || typeof value.patch !== "string") return null;
      return {
        patch: value.patch,
        truncated: value.truncated === true,
        unavailable: value.unavailable === true,
      };
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async archiveDiffs(task) {
    const dir = path.join(this.reviews, task.id);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    let remaining = MAX_REVIEW_BYTES;
    for (const change of await this.changes(task)) {
      let value;
      try {
        value = await this.liveDiff(task, change);
      } catch (error) {
        value = {
          patch: `Diff tidak dapat diarsipkan: ${String(error.message || error).slice(0, 500)}`,
          truncated: false,
          unavailable: true,
        };
      }
      const size = Buffer.byteLength(value.patch);
      if (size > remaining) {
        value = {
          patch: remaining > 0
            ? value.patch.slice(0, remaining)
            : "Batas penyimpanan arsip diff untuk Build ini telah tercapai.",
          truncated: true,
          unavailable: remaining <= 0,
        };
      }
      remaining = Math.max(0, remaining - Buffer.byteLength(value.patch));
      await fs.writeFile(
        this.reviewPath(task, change.path),
        JSON.stringify({ file: change.path, ...value }),
        { mode: 0o600 },
      );
    }
  }

  async baseEntry(project, task, file) {
    const output = await this.gitDir(project, ["ls-tree", "-z", task.baseCommit, "--", file]);
    if (!output) return null;
    const match = output.match(/^(\d+)\s+blob\s+([a-f0-9]{40})\t/);
    if (!match || match[1] !== "100644" && match[1] !== "100755")
      throw Error(`Jenis file tidak didukung: ${file}`);
    return { mode: match[1], hash: match[2] };
  }

  async assertUnchanged(project, task, change) {
    const base = await this.baseEntry(project, task, change.path);
    const target = path.join(project.path, change.path);
    const current = await exists(target);
    if (current?.isSymbolicLink() || current && !current.isFile())
      throw Error(`Konflik pada ${change.path}: target bukan file biasa.`);
    if (!base && current)
      throw Error(`Konflik pada ${change.path}: file baru sudah ada di proyek.`);
    if (base && !current)
      throw Error(`Konflik pada ${change.path}: file proyek telah dihapus.`);
    if (base && current) {
      const currentHash = (await exec("git", ["hash-object", "--no-filters", "--", target], {
        cwd: project.path,
        timeout: 30000,
      })).stdout.trim();
      if (currentHash !== base.hash)
        throw Error(`Konflik pada ${change.path}: file berubah sejak Build dimulai.`);
    }
  }

  async safeParent(root, file) {
    const parts = relativeFile(file).split("/");
    let current = await fs.realpath(root);
    for (const part of parts.slice(0, -1)) {
      current = path.join(current, part);
      const stat = await exists(current);
      if (stat?.isSymbolicLink() || stat && !stat.isDirectory())
        throw Error(`Folder tujuan tidak aman: ${file}`);
      if (!stat) await fs.mkdir(current, { mode: 0o755 });
    }
    return current;
  }

  async copyChange(project, task, change) {
    const target = path.join(project.path, change.path);
    if (change.status === "D") {
      const stat = await exists(target);
      if (stat) await fs.unlink(target);
      return;
    }
    const source = path.join(task.path, change.path);
    const stat = await fs.lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw Error(`Hasil Build bukan file biasa: ${change.path}`);
    const parent = await this.safeParent(project.path, change.path);
    const pending = path.join(parent, `.${path.basename(change.path)}.${randomUUID()}.tmp`);
    await fs.copyFile(source, pending);
    await fs.chmod(pending, stat.mode & 0o777);
    await fs.rename(pending, target);
  }

  async apply(project, id, selected = null) {
    const task = await this.get(project, id);
    if (!["review", "failed"].includes(task.status))
      throw Error("Build task tidak dapat diterapkan.");
    const all = await this.changes(task);
    const applied = new Set(task.appliedFiles || []);
    const remaining = all.filter((item) => !applied.has(item.path));
    const requested = selected == null ? remaining.map((item) => item.path) : selected;
    if (!Array.isArray(requested) || !requested.length) throw Error("Pilih setidaknya satu file.");
    const names = new Set(requested.map(relativeFile));
    if (names.size !== requested.length) throw Error("Daftar file duplikat.");
    const changes = remaining.filter((item) => names.has(item.path));
    if (changes.length !== names.size) throw Error("Pilihan file tidak termasuk dalam perubahan Build.");
    for (const change of changes) await this.assertUnchanged(project, task, change);
    await this.workspace.checkpoint(project, `Cadangan sebelum menerapkan Build ${id.slice(0, 8)}`);
    for (const change of changes) await this.copyChange(project, task, change);
    await this.workspace.checkpoint(project, `Terapkan Build ${id.slice(0, 8)}`);
    task.appliedFiles = [...applied, ...changes.map((item) => item.path)];
    task.appliedAt = Date.now();
    const complete = task.appliedFiles.length === all.length;
    if (complete) task.status = "applied";
    await this.save(task);
    if (complete) await this.removeWorktree(project, task);
    this.emit("build-task-applied", {
      projectId: project.id,
      taskId: id,
      files: changes.map((item) => item.path),
      complete,
    });
    return this.review(project, id);
  }

  async removeWorktree(project, task) {
    const expected = path.join(this.root, project.id, task.id);
    if (path.resolve(task.path) !== path.resolve(expected))
      throw Error("Lokasi worktree tidak valid.");
    await this.gitDir(project, ["worktree", "remove", "--force", task.path]).catch(() => {});
    await fs.rm(task.path, { recursive: true, force: true });
    await this.gitDir(project, ["branch", "-D", task.branch]).catch(() => {});
    await this.gitDir(project, ["worktree", "prune"]).catch(() => {});
  }

  async discard(project, id) {
    const task = await this.get(project, id);
    if (!['active', 'review', 'failed'].includes(task.status))
      throw Error("Build task tidak dapat dibuang.");
    await this.removeWorktree(project, task);
    task.status = "discarded";
    task.finishedAt ||= Date.now();
    await this.save(task);
    this.emit("build-task-discarded", { projectId: project.id, taskId: id });
    return this.review(project, id);
  }

  async forget(project) {
    await this.init();
    const tasks = [...this.tasks.values()].filter((task) => task.projectId === project.id);
    if (tasks.some((task) => ["active", "review", "failed"].includes(task.status)))
      throw Error("Masih ada hasil Build yang perlu diterapkan atau dibuang.");
    for (const task of tasks) {
      this.tasks.delete(task.id);
      await fs.rm(path.join(this.records, `${task.id}.json`), { force: true });
      await fs.rm(path.join(this.reviews, task.id), { recursive: true, force: true });
    }
    await fs.rm(path.join(this.root, project.id), { recursive: true, force: true });
  }
}
