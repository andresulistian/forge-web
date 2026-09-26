import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { Store } from "./store.mjs";
const exec = promisify(execFile);
export const privateName = (n) => {
  const lower = typeof n === "string" ? n.toLowerCase() : String(n).toLowerCase();
  return (
    lower === ".git" ||
    lower === ".forge" ||
    lower === "node_modules" ||
    lower === "target" ||
    lower === "dist" ||
    (lower.startsWith(".env") && lower !== ".env.example") ||
    /\.(pem|key)$/.test(lower)
  );
};
export async function safeFile(root, relative) {
  if (
    typeof relative !== "string" ||
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/).some(privateName)
  )
    throw Error("File tidak diizinkan.");
  const resolved = await fs.realpath(path.resolve(root, relative));
  const rel = path.relative(root, resolved);
  if (
    rel.startsWith("..") ||
    path.isAbsolute(rel) ||
    rel.split(path.sep).some(privateName)
  )
    throw Error("File berada di luar proyek.");
  const stat = await fs.stat(resolved);
  if (!stat.isFile() || stat.size > 512000)
    throw Error("Pilih file teks di bawah 500 KB.");
  return resolved;
}
export class Workspace {
  constructor(dataDir, projectsDir, template, store = new Store(dataDir)) {
    Object.assign(this, { dataDir, projectsDir, template, store });
    this.platform = process.platform;
    this.homeDir = os.homedir();
    this.projects = [];
  }
  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.mkdir(this.projectsDir, { recursive: true });
    await this.store.init();
    this.projects = this.store.projects();
  }
  async save() {
    for (const project of this.projects) this.store.upsertProject(project);
  }
  get(id) {
    const p = this.projects.find((p) => p.id === id);
    if (!p) throw Error("Proyek tidak ditemukan.");
    return p;
  }
  async create(name) {
    if (
      typeof name !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,59}$/.test(name)
    )
      throw Error("Nama: 1–60 huruf, angka, spasi, atau tanda hubung.");
    const dir = path.join(this.projectsDir, name);
    try {
      await fs.mkdir(dir);
    } catch (error) {
      if (error.code === "EEXIST")
        throw Error(
          `Folder proyek “${name}” masih ada. Buka folder lama melalui “Buka folder proyek”, lalu pilih Hapus proyek → Folder dan semua file agar nama ini dapat digunakan kembali.`,
        );
      throw error;
    }
    await fs.cp(this.template, dir, { recursive: true });
    return this.open(dir);
  }
  async open(dir) {
    const root = await fs.realpath(dir);
    const data = await fs.realpath(this.dataDir);
    if (
      data === root ||
      data.startsWith(root + path.sep) ||
      root === path.parse(root).root
    )
      throw Error(
        "Pilih folder proyek khusus, bukan folder yang mencakup data Forge.",
      );
    if (!(await fs.stat(root)).isDirectory())
      throw Error("Pilih folder proyek.");
    let p = this.projects.find((p) => p.path === root);
    if (p) return p;
    p = {
      id: randomUUID(),
      name: path.basename(root),
      path: root,
      createdAt: Date.now(),
    };
    this.projects.push(p);
    await this.save();
    return p;
  }
  async remove(p, deleteFiles = false) {
    if (!p || !this.projects.some((project) => project.id === p.id))
      throw Error("Proyek tidak ditemukan.");
    let trashedTo = null;
    if (deleteFiles) {
      const target = await this.trashTarget(p);
      try {
        await fs.rename(target.root, target.destination);
        trashedTo = target.destination;
      } catch (error) {
        if (error.code === "EXDEV")
          throw Error(
            "Folder berada di volume lain dan tidak dapat dipindahkan ke Trash Mac. Hapus folder tersebut melalui Finder.",
          );
        throw error;
      }
    }
    this.store.deleteProject(p.id);
    this.projects = this.projects.filter((project) => project.id !== p.id);
    await this.cleanupProject(p);
    return {
      ok: true,
      deletedFiles: deleteFiles,
      trashedTo,
      projects: this.projects,
    };
  }
  async trashTarget(p) {
    if (this.platform !== "darwin")
      throw Error(
        "Hapus folder ke Trash pada versi ini hanya tersedia di macOS.",
      );
    const root = await fs.realpath(p.path);
    const requestedHome = this.homeDir;
    const home = await fs.realpath(requestedHome);
    const data = await fs.realpath(this.dataDir);
    const projects = await fs.realpath(this.projectsDir);
    const template = await fs.realpath(this.template);
    const unsafe = [home, data, projects, template].some(
      (protectedPath) =>
        root === protectedPath || protectedPath.startsWith(root + path.sep),
    );
    if (root === path.parse(root).root || unsafe)
      throw Error(
        "Folder ini terlalu luas atau berisi data penting Forge dan tidak boleh dihapus.",
      );
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw Error("Target proyek bukan folder biasa.");
    const trash = path.join(requestedHome, ".Trash");
    await fs.mkdir(trash, { recursive: true, mode: 0o700 });
    const suffix = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    return {
      root,
      destination: path.join(trash, `${path.basename(root)}-${suffix}`),
    };
  }
  async cleanupProject(p) {
    const cleanup = [
      this.gitDir(p),
      path.join(this.dataDir, "attachments", p.id),
      path.join(this.dataDir, "deploy", "artifacts", p.id),
      path.join(this.dataDir, "deploy", p.id + ".json"),
      path.join(this.dataDir, "ollama-memory", p.id + ".jsonl"),
      path.join(this.dataDir, "bonsai-memory", p.id + ".jsonl"),
      path.join(this.dataDir, "guide-memory", p.id + ".jsonl"),
    ];
    await Promise.all(
      cleanup.map((target) => fs.rm(target, { recursive: true, force: true })),
    );
  }
  async clear(deleteFiles = false) {
    if (!this.projects.length) throw Error("Workspace sudah kosong.");
    const removing = [...this.projects];
    const targets = deleteFiles
      ? await Promise.all(removing.map((project) => this.trashTarget(project)))
      : [];
    for (const target of targets) {
      if (
        targets.some(
          (other) =>
            other !== target && target.root.startsWith(other.root + path.sep),
        )
      )
        throw Error(
          "Workspace memiliki folder proyek bertingkat. Hapus proyek di dalamnya satu per satu terlebih dahulu.",
        );
    }
    const moved = [];
    try {
      for (const target of targets) {
        await fs.rename(target.root, target.destination);
        moved.push(target);
      }
      this.store.deleteProjects(removing.map((project) => project.id));
    } catch (error) {
      for (const target of moved.reverse())
        await fs.rename(target.destination, target.root).catch(() => {});
      if (error.code === "EXDEV")
        throw Error(
          "Salah satu proyek berada di volume lain. Hapus proyek tersebut melalui Finder terlebih dahulu.",
        );
      throw error;
    }
    this.projects = [];
    await Promise.all(removing.map((project) => this.cleanupProject(project)));
    return {
      ok: true,
      deletedFiles: deleteFiles,
      count: removing.length,
      projects: [],
    };
  }
  gitDir(p) {
    return path.join(this.dataDir, "checkpoints", p.id);
  }
  async git(p, args) {
    const { stdout } = await exec(
      "git",
      [
        "--git-dir",
        this.gitDir(p),
        "--work-tree",
        p.path,
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.pager=cat",
        "-c",
        "user.name=Forge",
        "-c",
        "user.email=forge@localhost",
        ...args,
      ],
      { cwd: p.path, maxBuffer: 8 * 1024 * 1024, timeout: 30000 },
    );
    return stdout.trim();
  }
  async ensureGit(p) {
    try {
      await fs.access(path.join(this.gitDir(p), "HEAD"));
    } catch {
      await fs.mkdir(this.gitDir(p), { recursive: true });
      await exec("git", ["init", "--bare", this.gitDir(p)]);
      await this.git(p, ["config", "core.bare", "false"]);
      await fs.writeFile(
        path.join(this.gitDir(p), "info/exclude"),
        ".git\n.forge\nnode_modules\ndist\ntarget\n.env\n.env.*\n!.env.example\n*.pem\n*.key\n.DS_Store\n",
      );
    }
  }
  async checkpoint(p, label = "Checkpoint manual") {
    await this.ensureGit(p);
    await this.git(p, ["add", "-A", "--", "."]);
    await this.git(p, [
      "commit",
      "--allow-empty",
      "-m",
      String(label).slice(0, 160),
    ]);
    return this.history(p);
  }
  async history(p) {
    await this.ensureGit(p);
    try {
      return (await this.git(p, ["log", "-30", "--format=%H%x09%s%x09%aI"]))
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          const [id, label, date] = l.split("\t");
          return { id, label, date };
        });
    } catch {
      return [];
    }
  }
  async restore(p, id) {
    if (
      !/^[a-f0-9]{40}$/.test(id) ||
      !(await this.history(p)).some((h) => h.id === id)
    )
      throw Error("Checkpoint tidak valid.");
    await this.checkpoint(p, "Cadangan otomatis sebelum restore");
    await this.git(p, [
      "restore",
      `--source=${id}`,
      "--staged",
      "--worktree",
      "--",
      ".",
    ]);
    return this.checkpoint(p, "Restore " + id.slice(0, 7));
  }
  async diff(p, id) {
    if (!/^[a-f0-9]{40}$/.test(id)) throw Error("Checkpoint tidak valid.");
    await this.ensureGit(p);
    await this.git(p, ["add", "-A", "--", "."]);
    const [names, stat, patch] = await Promise.all([
      this.git(p, ["diff", "--cached", "--name-status", id, "--", "."]),
      this.git(p, ["diff", "--cached", "--stat", id, "--", "."]),
      this.git(p, ["diff", "--cached", "--no-ext-diff", "--unified=3", id, "--", "."]),
    ]);
    return {
      files: names
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [status, ...file] = line.split("\t");
          return { status, file: file.join(" → ") };
        }),
      stat: stat.slice(0, 20000),
      patch: patch.slice(0, 250000),
      truncated: patch.length > 250000,
    };
  }
  async files(p) {
    const result = [];
    async function walk(dir, depth) {
      if (depth > 5 || result.length >= 400) return;
      for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
        if (privateName(ent.name) || ent.isSymbolicLink()) continue;
        const f = path.join(dir, ent.name);
        if (ent.isDirectory()) await walk(f, depth + 1);
        else if (result.length < 400) result.push(path.relative(p.path, f));
      }
    }
    await walk(p.path, 0);
    return result.sort();
  }
  async read(p, file) {
    return fs.readFile(await safeFile(p.path, file), "utf8");
  }
  async write(p, file, text, expected) {
    if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > 512000)
      throw Error("Kode harus berupa teks di bawah 500 KB.");
    const target = await safeFile(p.path, file);
    const current = await fs.readFile(target, "utf8");
    if (typeof expected === "string" && current !== expected)
      throw Error(
        "File berubah sejak dibuka. Buka ulang file agar perubahan terbaru tidak tertimpa.",
      );
    if (current === text)
      return { changed: false, history: await this.history(p) };
    await this.checkpoint(p, `Otomatis sebelum edit manual: ${file}`);
    await fs.writeFile(target, text, "utf8");
    return { changed: true, history: await this.history(p) };
  }
  async chat(p, entry) {
    this.store.addMessage(p.id, entry);
  }
  async messages(p) {
    return this.store.messages(p.id, 100);
  }
  close() {
    this.store.close();
  }
}
