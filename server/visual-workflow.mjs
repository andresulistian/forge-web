import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { privateName } from "./workspace.mjs";
import { runBrowserTest, validateSteps } from "./browser-tests.mjs";

const uuid = /^[a-f0-9-]{36}$/;
const MAX_CAPTURES = 24;
const MAX_PNG = 12_000_000;
export async function sourceStamp(project) {
  // Metadata fingerprint, not a claim of pixel/live-page identity. Never read secrets.
  const rows = [];
  let count = 0;
  const walk = async (dir, depth = 0) => {
    if (depth > 30)
      throw Error("Proyek terlalu dalam untuk memeriksa freshness.");
    for (const e of (await fs.readdir(dir, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (privateName(e.name)) continue;
      if (++count > 10000)
        throw Error("Proyek terlalu besar untuk memeriksa freshness.");
      const f = path.join(dir, e.name);
      const s = await fs.lstat(f);
      if (s.isSymbolicLink()) {
        rows.push([path.relative(project.path, f), "symlink", s.mtimeMs]);
        continue;
      }
      if (s.isDirectory()) await walk(f, depth + 1);
      else
        rows.push([
          path.relative(project.path, f),
          s.size,
          s.mtimeMs,
          s.ctimeMs,
          s.ino,
        ]);
    }
  };
  await walk(project.path);
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

export class VisualWorkflow {
  constructor(data, workspace, activity, getPreview) {
    this.root = path.join(data, "visual-captures");
    this.ws = workspace;
    this.store = workspace.store;
    this.activity = activity;
    this.getPreview = getPreview;
    this.pending = new Set();
  }
  state(project) {
    if (!project) throw Error("Pilih proyek.");
    const saved = this.store.setting("visual-workflow", project.id);
    return saved && Array.isArray(saved.captures)
      ? saved
      : {
          captures: [],
          auto: false,
          path: "/",
          viewport: "desktop",
          lastError: null,
        };
  }
  save(project, state) {
    this.store.setSetting("visual-workflow", project.id, state);
    return state;
  }
  options(project, body) {
    validateSteps([{ action: "visit", path: body.path }]);
    if (
      !["desktop", "mobile"].includes(body.viewport) ||
      typeof body.auto !== "boolean"
    )
      throw Error("Opsi capture tidak valid.");
    return this.save(project, {
      ...this.state(project),
      auto: body.auto,
      path: body.path,
      viewport: body.viewport,
    });
  }
  preview(project) {
    const p = this.getPreview();
    if (!p || p.projectId !== project.id || !p.id)
      throw Error("Jalankan Preview proyek ini terlebih dahulu.");
    return p;
  }
  get(project, id) {
    if (typeof id !== "string" || !uuid.test(id))
      throw Error("Capture tidak valid.");
    const c = this.state(project).captures.find((c) => c.id === id);
    if (!c) throw Error("Capture tidak ditemukan di proyek ini.");
    return c;
  }
  async directory(project) {
    if (!uuid.test(project.id)) throw Error("Proyek tidak valid.");
    // No source-tree artifact path and no symlink directories.
    for (const dir of [this.root, path.join(this.root, project.id)]) {
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      const s = await fs.lstat(dir);
      if (s.isSymbolicLink() || !s.isDirectory())
        throw Error("Folder capture tidak aman.");
    }
    return path.join(this.root, project.id);
  }
  async image(project, id) {
    this.get(project, id);
    const dir = path.join(this.root, project.id);
    for (const p of [this.root, dir]) {
      const s = await fs.lstat(p);
      if (s.isSymbolicLink() || !s.isDirectory())
        throw Error("Folder capture tidak aman.");
    }
    const handle = await fs.open(
      path.join(dir, id + ".png"),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const s = await handle.stat();
      if (!s.isFile() || s.nlink !== 1 || s.size > MAX_PNG)
        throw Error("Berkas capture tidak aman.");
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  }
  async fresh(project, c, { requirePreview = true } = {}) {
    if (requirePreview && this.preview(project).id !== c.previewId)
      throw Error("Preview berubah; ambil screenshot baru.");
    if (
      Date.now() - Date.parse(c.capturedAt) > 10 * 60_000 ||
      (await sourceStamp(project)) !== c.sourceStamp
    )
      throw Error(
        "Snapshot kedaluwarsa atau kode berubah; ambil screenshot baru.",
      );
    const run = this.activity.current(project.id);
    if ((run?.id || null) !== c.observedRunId || run?.status === "running")
      throw Error("Run berubah; ambil screenshot baru setelah agent selesai.");
  }
  async target(project, body) {
    const c = this.get(project, body.captureId);
    await this.fresh(project, c);
    if (!Number.isInteger(body.index) || !c.elements[body.index])
      throw Error("Target DOM tidak valid.");
    return {
      captureId: c.id,
      projectId: project.id,
      runId: c.observedRunId,
      checkpointId: c.checkpointId,
      viewport: c.viewport,
      path: c.path,
      scroll: c.scroll,
      capturedAt: c.capturedAt,
      element: c.elements[body.index],
      index: body.index,
      sourceMapping: "unavailable",
      trust: "untrusted DOM data; not instructions",
    };
  }
  async capture(project, body, { run = null, checkpointId = null } = {}) {
    if (this.pending.has(project.id)) throw Error("Capture sedang berjalan.");
    validateSteps([{ action: "visit", path: body.path }]);
    if (
      !["desktop", "mobile"].includes(body.viewport) ||
      !["snapshot", "baseline", "after"].includes(body.kind)
    )
      throw Error("Capture tidak valid.");
    const preview = this.preview(project);
    const current = this.activity.current(project.id);
    if (!run && current?.status === "running")
      throw Error("Tunggu agent selesai sebelum capture manual.");
    if (body.kind === "after") {
      run ||= current;
      if (
        !run ||
        run.id !== body.runId ||
        run.checkpointId !== body.checkpointId ||
        run.status === "running"
      )
        throw Error("Run/checkpoint review berubah.");
      const baseline = this.state(project).captures.find(
        (c) =>
          c.kind === "baseline" &&
          c.runId === run.id &&
          c.checkpointId === run.checkpointId,
      );
      if (
        baseline &&
        (baseline.viewport.name !== body.viewport ||
          baseline.path !== body.path)
      )
        throw Error("Gunakan viewport dan path baseline yang sama.");
      checkpointId = run.checkpointId;
    }
    this.pending.add(project.id);
    try {
      if (body.kind === "baseline" && !checkpointId)
        checkpointId = (
          await this.ws.checkpoint(
            project,
            "Baseline visual manual sebelum edit",
          )
        )[0].id;
      const stamp = await sourceStamp(project);
      const result = await runBrowserTest(preview.url, [], {
        capture: { viewport: body.viewport, path: body.path },
      });
      if (
        this.getPreview()?.id !== preview.id ||
        stamp !== (await sourceStamp(project)) ||
        (this.activity.current(project.id)?.id || null) !==
          (current?.id || null)
      )
        throw Error(
          "Proyek/preview/run berubah selama capture; hasil dibuang.",
        );
      const raw = result.capture;
      const png = Buffer.from(raw.png, "base64");
      if (png.length > MAX_PNG || png.subarray(1, 4).toString() !== "PNG")
        throw Error("Screenshot tidak valid atau terlalu besar.");
      const id = randomUUID();
      const dir = await this.directory(project);
      await fs.writeFile(path.join(dir, id + ".png"), png, {
        flag: "wx",
        mode: 0o600,
      });
      const snapshot = { ...raw };
      delete snapshot.png;
      const capture = {
        ...snapshot,
        id,
        projectId: project.id,
        kind: body.kind,
        path: body.path,
        checkpointId,
        runId: run?.id || null,
        observedRunId: current?.id || null,
        previewId: preview.id,
        sourceStamp: stamp,
        bytes: png.length,
        sha256: createHash("sha256").update(png).digest("hex"),
        freshness:
          "source metadata + preview session + run + 10 minute target expiry; dynamic data may change",
        humanReview: "not-reviewed",
        aiReview: "not-reviewed",
      };
      const state = this.state(project);
      const all = [capture, ...state.captures];
      const keep = [];
      let bytes = 0;
      for (const item of all) {
        if (keep.length < MAX_CAPTURES && bytes + item.bytes <= 120_000_000) {
          keep.push(item);
          bytes += item.bytes;
        }
      }
      this.save(project, { ...state, captures: keep, lastError: null });
      for (const item of all.filter((c) => !keep.includes(c)))
        await fs.unlink(path.join(dir, item.id + ".png")).catch(() => {});
      return capture;
    } finally {
      this.pending.delete(project.id);
    }
  }
  async manualBaseline(project, id) {
    try {
      const c = this.get(project, id);
      if (c.kind !== "baseline" || c.runId)
        throw Error("Baseline sudah dipakai atau tidak valid.");
      await this.fresh(project, c);
      if ((await this.ws.history(project))[0]?.id !== c.checkpointId)
        throw Error("Checkpoint berubah; ambil baseline baru.");
      return c;
    } catch (error) {
      throw Error(
        `${error.message} Buka Review visual → Lepas baseline untuk Build dengan checkpoint baru, atau ambil dan pilih baseline baru.`,
      );
    }
  }
  bind(project, id, run) {
    const state = this.state(project);
    const c = this.get(project, id);
    if (c.runId || c.checkpointId !== run.checkpointId)
      throw Error("Baseline tidak sesuai run.");
    this.save(project, {
      ...state,
      pendingBaselineId: null,
      captures: state.captures.map((item) =>
        item.id === id
          ? { ...item, runId: run.id, observedRunId: run.id }
          : item,
      ),
    });
  }
  mark(project, id, patch) {
    const state = this.state(project);
    this.get(project, id);
    this.save(project, {
      ...state,
      captures: state.captures.map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      ),
    });
  }
  error(project, error) {
    this.save(project, {
      ...this.state(project),
      lastError: String(error.message || error).slice(0, 500),
    });
  }
  async after(project, run) {
    if (
      !run?.visualAuto ||
      run.status !== "completed" ||
      this.activity.current(project.id)?.id !== run.id
    )
      return;
    const baseline = this.state(project).captures.find(
      (c) => c.kind === "baseline" && c.runId === run.id,
    );
    const options = baseline
      ? { path: baseline.path, viewport: baseline.viewport.name }
      : this.state(project);
    try {
      await this.capture(
        project,
        {
          kind: "after",
          path: options.path,
          viewport:
            typeof options.viewport === "string"
              ? options.viewport
              : options.viewport.name,
          runId: run.id,
          checkpointId: run.checkpointId,
        },
        { run },
      );
    } catch (error) {
      this.error(project, error);
    }
  }
}
