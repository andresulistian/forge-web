import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { privateName } from "./workspace.mjs";

export const COLUMNS = ["backlog", "todo", "in_progress", "review_test", "done"];
export const MODES = ["economy", "balanced", "maximum"];
export const CHECK_SCRIPTS = ["lint", "test", "build"];
const MAX_TASKS = 200;
const MAX_REQUEST = 40000;
const MAX_STATE_BYTES = 4_000_000;
const CHECK_TIMEOUT_MS = 180000;
const CHECK_OUTPUT_LIMIT = 256000;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const REVIEW_OK = ["accepted", "no-changes"];

const compact = (value, limit = 1200) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);

function projectId(project) {
  const id = String(project?.id || "");
  if (!PROJECT_ID.test(id)) throw Error("Project ID Kanban tidak valid.");
  return id;
}

export function decompose(request) {
  const parts = String(request || "")
    .split(/\n(?=\s*(?:\d+[.)]|[-*])\s+)/)
    .map((part) => compact(part.replace(/^\s*(?:\d+[.)]|[-*])\s+/, ""), 180))
    .filter(Boolean);
  return (parts.length > 1 ? parts : [compact(request, 180)]).slice(0, 8);
}

export function routeAgents(request, mode = "balanced", enabled = true) {
  const text = String(request || "");
  const scope = decompose(text).length;
  const complex =
    scope >= 3 ||
    text.length > 450 ||
    /\b(migrat|refactor|security|deploy|database|auth|integrat|arsitektur|keamanan|regresi)\w*/i.test(text);
  const medium = complex || scope > 1 || text.length > 180;
  const specialists =
    !enabled || mode === "economy" || !medium
      ? []
      : mode === "maximum" || complex
        ? ["architecture", "risks"]
        : ["architecture"];
  return {
    specialists,
    workers: 1 + specialists.length,
    complexity: complex ? "large" : medium ? "medium" : "small",
  };
}

async function relevantContext(project, request, mode, memory) {
  const budget = { economy: 900, balanced: 2400, maximum: 4800 }[mode] || 2400;
  const words = new Set(
    (String(request).toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || []).filter((x) => x.length > 3),
  );
  const candidates = [];
  for (const folder of ["", "src", "server", "app", "pages"]) {
    let names = [];
    try {
      names = await fs.readdir(path.join(project.path, folder), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const item of names)
      if (
        item.isFile() &&
        !privateName(item.name) &&
        /\.(?:md|json|js|mjs|ts|tsx|py)$/.test(item.name) &&
        item.name !== "package-lock.json"
      )
        candidates.push({
          name: path.join(folder, item.name),
          relevance: words.has(item.name.split(".")[0].toLowerCase()) ? 2 : folder ? 0 : 1,
        });
  }
  candidates.sort((a, b) => b.relevance - a.relevance || a.name.localeCompare(b.name));
  const selected = candidates.slice(0, mode === "economy" ? 1 : mode === "maximum" ? 4 : 2);
  let context = `Kanban memory: ${compact(memory, 700) || "none"}\n`;
  for (const item of selected) {
    if (context.length >= budget) break;
    try {
      const file = path.join(project.path, item.name);
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.size > 64000) continue;
      const content = await fs.readFile(file, "utf8");
      context += `\n${item.name}:\n${content.slice(0, Math.min(900, budget - context.length))}\n`;
    } catch {
      /* binary or changed */
    }
  }
  return context.slice(0, budget);
}

/** Runs one package script without a shell; the whole process group is killed on timeout. */
function runScript(cwd, script, timeout = CHECK_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", script], {
      cwd,
      env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let output = "";
    let timedOut = false;
    const collect = (chunk) => {
      output = (output + chunk.toString()).slice(-CHECK_OUTPUT_LIMIT);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform === "win32") child.kill();
        else process.kill(-child.pid, "SIGKILL");
      } catch {
        /* already exited */
      }
    }, timeout);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, output: error.message });
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        ok: !timedOut && code === 0,
        output: timedOut
          ? `Dihentikan setelah ${Math.round(timeout / 1000)} detik. ${output.slice(-400)}`
          : output || `exit ${code ?? signal}`,
      });
    });
  });
}

export class KanbanManager {
  constructor(dataDir, emit = () => {}, { checkTimeoutMs = CHECK_TIMEOUT_MS } = {}) {
    this.root = path.join(dataDir, "kanban");
    this.emit = emit;
    this.checkTimeoutMs = checkTimeoutMs;
    this.states = new Map();
    this.writes = new Map();
  }

  file(project) {
    return path.join(this.root, `${projectId(project)}.json`);
  }

  async state(project) {
    const id = projectId(project);
    if (this.states.has(id)) return this.states.get(id);
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    let state;
    try {
      const raw = await fs.readFile(this.file(project), "utf8");
      if (raw.length > MAX_STATE_BYTES) throw Error("State Kanban terlalu besar.");
      state = JSON.parse(raw);
      if (!Array.isArray(state?.tasks)) throw Error("State Kanban rusak.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      state = { projectId: id, memory: "", tasks: [] };
    }
    this.states.set(id, state);
    return state;
  }

  async save(project, state) {
    const id = projectId(project);
    const prior = this.writes.get(id) || Promise.resolve();
    const next = prior
      .catch(() => {})
      .then(async () => {
        const serialized = JSON.stringify(state, null, 2);
        if (serialized.length > MAX_STATE_BYTES) throw Error("State Kanban terlalu besar.");
        const file = this.file(project);
        const pending = `${file}.${randomUUID()}.tmp`;
        await fs.writeFile(pending, serialized, { mode: 0o600 });
        await fs.rename(pending, file);
      });
    this.writes.set(id, next);
    await next;
    this.emit("kanban-updated", { projectId: id });
  }

  async list(project) {
    const state = await this.state(project);
    return { ...state, columns: COLUMNS, modes: MODES };
  }

  async create(project, request, mode = "balanced", id = randomUUID()) {
    if (!MODES.includes(mode)) throw Error("Mode Kanban tidak valid.");
    if (typeof request !== "string" || !request.trim() || request.length > MAX_REQUEST)
      throw Error("Deskripsi task tidak valid.");
    const state = await this.state(project);
    if (state.tasks.length >= MAX_TASKS) throw Error("Batas task Kanban tercapai.");
    const plan = decompose(request);
    const task = {
      id,
      title: compact(plan[0], 100),
      request: request.trim(),
      subtasks: plan,
      column: "backlog",
      mode,
      routing: routeAgents(request, mode),
      summary: "",
      checks: null,
      review: null,
      changedFiles: [],
      usage: { inputTokens: 0, outputTokens: 0, estimated: true, costUsd: null, estimatedCostUsd: null },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      buildTaskId: null,
    };
    state.tasks.unshift(task);
    await this.save(project, state);
    return task;
  }

  async get(project, id) {
    const state = await this.state(project);
    const task = state.tasks.find((item) => item.id === id);
    if (!task) throw Error("Task Kanban tidak ditemukan.");
    return { state, task };
  }

  async move(project, id, column) {
    if (!COLUMNS.includes(column)) throw Error("Kolom Kanban tidak valid.");
    const { state, task } = await this.get(project, id);
    if (column === "done") throw Error("Jalankan regression checks sebelum Done.");
    if (task.buildTaskId) throw Error("Task dengan Build aktif dipindahkan otomatis oleh Build dan review.");
    if (column === "in_progress" || column === "review_test")
      throw Error("In Progress dan Review/Test diisi otomatis oleh Build.");
    task.column = column;
    task.updatedAt = Date.now();
    await this.save(project, state);
    return task;
  }

  async remove(project, id) {
    const { state, task } = await this.get(project, id);
    if (task.column === "in_progress") throw Error("Task yang sedang di-Build tidak dapat dihapus.");
    state.tasks = state.tasks.filter((item) => item.id !== id);
    await this.save(project, state);
    return { ok: true };
  }

  /** Binds a Kanban task to one agent run (Activity Center run id). */
  async start(project, id, buildTaskId, { provider, model, enabled = true } = {}) {
    const { state, task } = await this.get(project, id);
    if (task.buildTaskId && task.buildTaskId !== buildTaskId) throw Error("Task sudah memiliki Build.");
    if (task.column === "done") throw Error("Task sudah Done.");
    task.buildTaskId = buildTaskId;
    task.column = "in_progress";
    task.review = null;
    task.checks = null;
    task.provider = compact(provider, 80);
    task.model = compact(model, 160);
    task.routing = routeAgents(task.request, task.mode, enabled);
    // Usage accumulates across re-runs; estimates are replaced once a provider reports real usage.
    if (task.usage.estimated) task.usage.inputTokens += Math.ceil(task.request.length / 4);
    this.estimateCost(task);
    task.updatedAt = Date.now();
    await this.save(project, state);
    return { task, context: await relevantContext(project, task.request, task.mode, state.memory) };
  }

  async finish(project, buildTaskId, { error = null, result = "", files = [] } = {}) {
    if (!buildTaskId) return null;
    const state = await this.state(project);
    const task = state.tasks.find((item) => item.buildTaskId === buildTaskId);
    if (!task || task.column !== "in_progress") return null;
    const changed = (Array.isArray(files) ? files : []).slice(0, 100).map((f) => compact(f?.file || f?.path || f, 300));
    task.changedFiles = changed;
    task.summary = compact(
      error ? `Build gagal: ${error}` : result || `Build selesai. ${changed.length} file berubah.`,
      1000,
    );
    if (task.usage.estimated) task.usage.outputTokens += Math.ceil(String(result || "").length / 4);
    this.estimateCost(task);
    if (error && !changed.length) {
      // Nothing to review: return the task to To Do so it can be built again.
      task.column = "todo";
      task.buildTaskId = null;
    } else {
      task.column = "review_test";
      task.review = changed.length ? "pending" : "no-changes";
    }
    task.updatedAt = Date.now();
    await this.save(project, state);
    return task;
  }

  /** Mirrors checkpoint review (Accept / Undo) onto the bound task. */
  async review(project, buildTaskId, status) {
    if (!buildTaskId || !["accepted", "undone"].includes(status)) return null;
    const state = await this.state(project);
    const task = state.tasks.find((item) => item.buildTaskId === buildTaskId);
    if (!task || task.column === "done") return null;
    if (status === "undone") {
      task.column = "todo";
      task.buildTaskId = null;
      task.review = "undone";
      task.checks = null;
      task.summary = compact(`Perubahan di-undo. ${task.summary}`, 1000);
    } else task.review = "accepted";
    task.updatedAt = Date.now();
    await this.save(project, state);
    return task;
  }

  async recordUsage(project, id, usage = {}) {
    if (!usage || typeof usage !== "object") return;
    const { state, task } = await this.get(project, id);
    const input = Number(usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens);
    const output = Number(usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens);
    const reported = Number.isFinite(input) || Number.isFinite(output);
    if (reported && task.usage.estimated) {
      task.usage.inputTokens = 0;
      task.usage.outputTokens = 0;
      task.usage.estimated = false;
    }
    if (Number.isFinite(input) && input >= 0) task.usage.inputTokens += input;
    if (Number.isFinite(output) && output >= 0) task.usage.outputTokens += output;
    const rawCost = usage.cost ?? usage.cost_usd;
    const cost = Number(rawCost);
    if (rawCost != null && Number.isFinite(cost) && cost >= 0)
      task.usage.costUsd = (task.usage.costUsd || 0) + cost;
    this.estimateCost(task);
    await this.save(project, state);
  }

  estimateCost(task) {
    if (!task.pricing) return;
    task.usage.estimatedCostUsd =
      (task.usage.inputTokens * task.pricing.inputPerMillion +
        task.usage.outputTokens * task.pricing.outputPerMillion) /
      1_000_000;
  }

  async price(project, id, inputPerMillion, outputPerMillion) {
    const rates = [inputPerMillion, outputPerMillion].map(Number);
    if (rates.some((rate) => !Number.isFinite(rate) || rate < 0 || rate > 1_000_000))
      throw Error("Tarif harus angka USD per 1 juta token yang valid.");
    const { state, task } = await this.get(project, id);
    task.pricing = { inputPerMillion: rates[0], outputPerMillion: rates[1] };
    this.estimateCost(task);
    task.updatedAt = Date.now();
    await this.save(project, state);
    return task;
  }

  async verify(project, id) {
    const { state, task } = await this.get(project, id);
    if (task.column !== "review_test" || !task.buildTaskId)
      throw Error("Task harus selesai Build dan masuk Review/Test dahulu.");
    if (!REVIEW_OK.includes(task.review))
      throw Error("Terima (Accept) perubahan di tab Agent sebelum regression checks.");
    const checks = [];
    let scripts = {};
    try {
      const raw = await fs.readFile(path.join(project.path, "package.json"), "utf8");
      if (raw.length > 1_000_000) throw Error("package.json terlalu besar.");
      scripts = JSON.parse(raw).scripts || {};
    } catch (error) {
      if (error.code !== "ENOENT") checks.push({ name: "package.json", ok: false, output: compact(error.message, 600) });
    }
    for (const name of CHECK_SCRIPTS)
      if (typeof scripts[name] === "string" && scripts[name].trim()) {
        const result = await runScript(project.path, name, this.checkTimeoutMs);
        checks.push({ name: `npm run ${name}`, ok: result.ok, output: compact(result.output, 600) });
      }
    if (!checks.some((check) => check.name.startsWith("npm run ")))
      checks.push({
        name: "automated regression",
        ok: false,
        output: "Tambahkan script lint, test, atau build di package.json untuk menyelesaikan task.",
      });
    task.checks = { at: Date.now(), results: checks, passed: checks.every((check) => check.ok) };
    if (task.checks.passed) {
      task.column = "done";
      state.memory = [state.memory, `${task.title}: ${task.summary}`].filter(Boolean).join(" ").slice(-3000);
    }
    task.updatedAt = Date.now();
    await this.save(project, state);
    return task;
  }

  async forget(project) {
    const id = projectId(project);
    await this.writes.get(id)?.catch(() => {});
    this.states.delete(id);
    this.writes.delete(id);
    await fs.rm(this.file(project), { force: true });
  }
}
