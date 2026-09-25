import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
export const COLUMNS = ["backlog", "todo", "in_progress", "review_test", "done"];
export const MODES = ["economy", "balanced", "maximum"];
const MAX_TASKS = 200;

const compact = (value, limit = 1200) => String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);

export function decompose(request) {
  const parts = String(request || "").split(/\n(?=\s*(?:\d+[.)]|[-*])\s+)/)
    .map((part) => compact(part.replace(/^\s*(?:\d+[.)]|[-*])\s+/, ""), 180))
    .filter(Boolean);
  return (parts.length > 1 ? parts : [compact(request, 180)]).slice(0, 8);
}

export function routeAgents(request, mode = "balanced", enabled = true) {
  const text = String(request || "");
  const scope = decompose(text).length;
  const complex = scope >= 3 || text.length > 450 || /\b(migrat|refactor|security|deploy|database|auth|integrat|arsitektur|keamanan|regresi)\w*/i.test(text);
  const medium = complex || scope > 1 || text.length > 180;
  const specialists = !enabled || mode === "economy" || !medium ? []
    : mode === "maximum" || complex ? ["architecture", "risks"] : ["architecture"];
  return { specialists, workers: 1 + specialists.length, complexity: complex ? "large" : medium ? "medium" : "small" };
}

async function relevantContext(project, request, mode, memory) {
  const budget = { economy: 900, balanced: 2400, maximum: 4800 }[mode] || 2400;
  const words = new Set((request.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || []).filter((x) => x.length > 3));
  const candidates = [];
  for (const folder of ["", "src", "server", "app", "pages"]) {
    let names = [];
    try { names = await fs.readdir(path.join(project.path, folder), { withFileTypes: true }); }
    catch { continue; }
    for (const item of names) if (item.isFile() && !item.name.startsWith(".") &&
      /\.(?:md|json|js|mjs|ts|tsx|py)$/.test(item.name) && item.name !== "package-lock.json")
      candidates.push({ name: path.join(folder, item.name), relevance: words.has(item.name.split(".")[0].toLowerCase()) ? 2 : folder ? 0 : 1 });
  }
  candidates.sort((a, b) => b.relevance - a.relevance || a.name.localeCompare(b.name));
  const selected = candidates
    .slice(0, mode === "economy" ? 1 : mode === "maximum" ? 4 : 2);
  let context = `Project memory: ${compact(memory, 700) || "none"}\n`;
  for (const item of selected) {
    if (context.length >= budget) break;
    try {
      if ((await fs.stat(path.join(project.path, item.name))).size > 64000) continue;
      const content = await fs.readFile(path.join(project.path, item.name), "utf8");
      context += `\n${item.name}:\n${content.slice(0, Math.min(900, budget - context.length))}\n`;
    } catch { /* binary or changed */ }
  }
  return context.slice(0, budget);
}

export class KanbanManager {
  constructor(dataDir, emit = () => {}) {
    this.root = path.join(dataDir, "kanban");
    this.emit = emit;
    this.states = new Map();
    this.writes = new Map();
  }

  async state(project) {
    if (this.states.has(project.id)) return this.states.get(project.id);
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    let state;
    try { state = JSON.parse(await fs.readFile(path.join(this.root, `${project.id}.json`), "utf8")); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      state = { projectId: project.id, memory: "", tasks: [] };
    }
    this.states.set(project.id, state);
    return state;
  }

  async save(project, state) {
    const prior = this.writes.get(project.id) || Promise.resolve();
    const next = prior.catch(() => {}).then(async () => {
      const file = path.join(this.root, `${project.id}.json`);
      const pending = `${file}.${randomUUID()}.tmp`;
      await fs.writeFile(pending, JSON.stringify(state, null, 2), { mode: 0o600 });
      await fs.rename(pending, file);
    });
    this.writes.set(project.id, next);
    await next;
    this.emit("kanban-updated", { projectId: project.id });
  }

  async list(project) {
    const state = await this.state(project);
    return { ...state, columns: COLUMNS, modes: MODES };
  }

  async create(project, request, mode = "balanced", id = randomUUID()) {
    if (!MODES.includes(mode)) throw Error("Mode Kanban tidak valid.");
    if (typeof request !== "string" || !request.trim() || request.length > 40000)
      throw Error("Deskripsi task tidak valid.");
    const state = await this.state(project);
    if (state.tasks.length >= MAX_TASKS) throw Error("Batas task Kanban tercapai.");
    const plan = decompose(request);
    const task = { id, title: compact(plan[0], 100), request: request.trim(), subtasks: plan,
      column: "backlog", mode, routing: routeAgents(request, mode), summary: "", checks: null,
      usage: { inputTokens: 0, outputTokens: 0, estimated: true, costUsd: null, estimatedCostUsd: null },
      createdAt: Date.now(), updatedAt: Date.now(), buildTaskId: null };
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
    if (task.buildTaskId && column === "backlog") throw Error("Build aktif tidak dapat kembali ke Backlog.");
    task.column = column;
    task.updatedAt = Date.now();
    await this.save(project, state);
    return task;
  }

  async start(project, id, buildTaskId, { provider, model, enabled = true } = {}) {
    const { state, task } = await this.get(project, id);
    if (task.buildTaskId && task.buildTaskId !== buildTaskId) throw Error("Task sudah memiliki Build.");
    task.buildTaskId = buildTaskId;
    task.column = "in_progress";
    task.provider = compact(provider, 80);
    task.model = compact(model, 160);
    task.routing = routeAgents(task.request, task.mode, enabled);
    task.usage.inputTokens = Math.ceil(task.request.length / 4);
    this.estimateCost(task);
    task.updatedAt = Date.now();
    await this.save(project, state);
    return { task, context: await relevantContext(project, task.request, task.mode, state.memory) };
  }

  async finish(project, buildTaskId, { error = null, result = "", files = [] } = {}) {
    const state = await this.state(project);
    const task = state.tasks.find((item) => item.buildTaskId === buildTaskId);
    if (!task) return;
    task.column = "review_test";
    task.summary = compact(error ? `Build failed: ${error}` : result || `Build completed. ${files.length} changed files.`, 1000);
    task.changedFiles = files.slice(0, 100).map((f) => f.path || f);
    task.usage.outputTokens ||= Math.ceil(String(result).length / 4);
    this.estimateCost(task);
    task.updatedAt = Date.now();
    await this.save(project, state);
  }

  async recordUsage(project, id, usage = {}) {
    const { state, task } = await this.get(project, id);
    const input = Number(usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens);
    const output = Number(usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens);
    if (task.usage.estimated) {
      task.usage.inputTokens = 0;
      task.usage.outputTokens = 0;
    }
    if (Number.isFinite(input) && input >= 0) task.usage.inputTokens += input;
    if (Number.isFinite(output) && output >= 0) task.usage.outputTokens += output;
    if (Number.isFinite(input) || Number.isFinite(output)) task.usage.estimated = false;
    const cost = Number(usage.cost ?? usage.cost_usd);
    if (Number.isFinite(cost) && cost >= 0 && (usage.cost != null || usage.cost_usd != null))
      task.usage.costUsd = (task.usage.costUsd || 0) + cost;
    this.estimateCost(task);
    await this.save(project, state);
  }

  estimateCost(task) {
    if (!task.pricing) return;
    task.usage.estimatedCostUsd = (task.usage.inputTokens * task.pricing.inputPerMillion +
      task.usage.outputTokens * task.pricing.outputPerMillion) / 1_000_000;
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
    const checks = [];
    const run = async (name, command, args) => {
      try {
        const { stdout, stderr } = await exec(command, args, { cwd: project.path, timeout: 120000, maxBuffer: 256000 });
        checks.push({ name, ok: true, output: compact(stdout + stderr, 600) });
      } catch (error) {
        checks.push({ name, ok: false, output: compact([error.stdout, error.stderr].filter(Boolean).join("\n") || error.message, 600) });
      }
    };
    await run("git diff --check", "git", ["diff", "--check"]);
    let scripts = {};
    try { scripts = JSON.parse(await fs.readFile(path.join(project.path, "package.json"), "utf8")).scripts || {}; }
    catch (error) { if (error.code !== "ENOENT") checks.push({ name: "package.json", ok: false, output: error.message }); }
    for (const name of ["test", "build"]) if (scripts[name]) await run(`npm ${name}`, "npm", ["run", name]);
    if (!scripts.test && !scripts.build)
      checks.push({ name: "automated regression", ok: false, output: "Tambahkan npm test atau npm run build untuk menyelesaikan task." });
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
    await this.writes.get(project.id)?.catch(() => {});
    this.states.delete(project.id);
    await fs.rm(path.join(this.root, `${project.id}.json`), { force: true });
  }
}
