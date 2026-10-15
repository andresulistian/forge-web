import path from "node:path";
import fs from "node:fs/promises";
import { KanbanManager as KanbanStore } from "./kanban-store.mjs";
import { planSpecialists, parseReview } from "./workflow-plan.mjs";
import { bindWorkflow, unbindWorkflow } from "./workflow-bindings.mjs";

// Public routing and execution use one decision function.
export { COLUMNS, MODES, CHECK_SCRIPTS, decompose } from "./kanban-store.mjs";
export const routeAgents = planSpecialists;

export class KanbanManager extends KanbanStore {
  constructor(dataDir, emit = () => {}, options = {}) {
    super(dataDir, emit, options);
    this.workflowDataDir = path.resolve(dataDir);
  }
  async create(project, request, mode = "balanced", id) {
    const task = await super.create(project, request, mode, id);
    task.routing = planSpecialists(request, mode, true);
    await this.save(project, await this.state(project));
    return task;
  }
  async start(project, id, buildTaskId, options = {}) {
    const started = await super.start(project, id, buildTaskId, options);
    const { task } = started;
    task.routing = planSpecialists(task.request, task.mode, options.enabled !== false);
    task.workflow = null;
    await this.save(project, await this.state(project));
    if (task.routing.enabled) bindWorkflow(this.workflowDataDir, project.id, {
      runId: buildTaskId, plan: task.routing,
      record: async (result) => {
        const current = await this.get(project, id);
        if (current.task.buildTaskId !== buildTaskId || current.task.column !== "in_progress") throw Error("Hasil workflow berasal dari run yang sudah tidak aktif.");
        const checksOk = result.checks?.ok === true && result.checks.results?.some((check) => check.name === "test" && check.ok === true) && result.checks.results.every((check) => check.ok === true);
        const reviewOk = !current.task.routing.review || parseReview(JSON.stringify(result.review), current.task.routing.criteria).verdict === "PASS";
        current.task.workflow = {
          ok: result.ok === true && !!checksOk && reviewOk, calls: result.calls || 0, attempts: result.attempts || 0,
          checks: result.checks || null, review: result.review || null,
          reason: String(result.reason || "").slice(0, 2000), at: Date.now(),
        };
        await this.save(project, current.state);
      },
    });
    return started;
  }
  async finish(project, buildTaskId, result) {
    try { return await super.finish(project, buildTaskId, result); }
    finally { unbindWorkflow(this.workflowDataDir, project.id, buildTaskId); }
  }
  async verify(project, id) {
    const { task } = await this.get(project, id);
    const managed = task.routing?.version === 1 && task.routing.enabled;
    if (task.column !== "review_test" || !task.buildTaskId) throw Error("Task harus selesai Build dan masuk Review/Test dahulu.");
    if (!["accepted", "no-changes"].includes(task.review)) throw Error("Terima (Accept) perubahan di tab Agent sebelum regression checks.");
    if (managed && task.workflow?.ok !== true)
      throw Error("Workflow belum lolos QA/review. Selesaikan temuan sebelum Done.");
    if (managed) {
      const scripts = JSON.parse(await fs.readFile(path.join(project.path, "package.json"), "utf8")).scripts;
      if (typeof scripts?.test !== "string" || !scripts.test.trim()) throw Error("Script npm test wajib tersedia sebelum Done.");
    }
    const verified = await super.verify(project, id);
    if (managed && !verified.checks?.results?.some((check) => check.name === "npm run test" && check.ok)) {
      verified.column = "review_test";
      verified.checks.passed = false;
      verified.checks.results.push({ name: "required tests", ok: false, output: "Workflow specialist membutuhkan npm test yang lulus; lint/build saja tidak cukup." });
      await this.save(project, await this.state(project));
    }
    return verified;
  }
  async forget(project) {
    const state = await this.state(project);
    for (const task of state.tasks) if (task.buildTaskId) unbindWorkflow(this.workflowDataDir, project.id, task.buildTaskId);
    return super.forget(project);
  }
}
