import { randomUUID } from "node:crypto";
import { Codex } from "./codex.mjs";
import { ApiProviders } from "./api-providers.mjs";

const ROLE_LABELS = {
  architecture: "Inspecting architecture",
  risks: "Checking risks and tests",
  builder: "Implementing changes",
};

class Semaphore {
  constructor(limit) {
    this.limit = Math.max(1, Math.min(3, Number(limit) || 3));
    this.running = 0;
    this.waiting = [];
  }

  async use(fn) {
    if (this.running >= this.limit)
      await new Promise((resolve) => this.waiting.push(resolve));
    this.running += 1;
    try {
      return await fn();
    } finally {
      this.running -= 1;
      this.waiting.shift()?.();
    }
  }
}

function completionStatus(payload) {
  const turn = payload?.params?.turn || {};
  if (turn.error) return { status: "failed", error: turn.error.message };
  if (["failed", "interrupted", "cancelled"].includes(turn.status))
    return { status: turn.status, error: turn.error?.message || `Agent ${turn.status}.` };
  return { status: "completed" };
}

function providerWorker({ provider, model, project, store, credentials, emit }) {
  let runner;
  if (provider === "codex") runner = new Codex(emit);
  else if (provider.startsWith("api:"))
    runner = new ApiProviders(store, emit, { credentials });
  else
    throw Error("Multi-agent saat ini tersedia untuk Codex dan provider API kompatibel OpenAI.");

  return {
    async run({ mode, prompt, media = [], webContext = "" }) {
      let answer = "";
      let settled = false;
      let resolveCompletion;
      let rejectCompletion;
      const completion = new Promise((resolve, reject) => {
        resolveCompletion = resolve;
        rejectCompletion = reject;
      });
      const originalEmit = emit.handle;
      emit.handle = (type, payload) => {
        originalEmit(type, payload);
        if (type !== "codex") return;
        if (payload.method === "item/completed" && payload.params?.item?.type === "agentMessage")
          answer = payload.params.item.text || answer;
        if (payload.method === "turn/completed" && !settled) {
          settled = true;
          const result = completionStatus(payload);
          if (result.status === "completed") resolveCompletion();
          else rejectCompletion(Error(result.error));
        }
      };
      try {
        let direct;
        if (provider === "codex")
          direct = await runner.turn(project, mode, prompt + webContext, model, media);
        else
          direct = await runner.turn(
            project,
            mode,
            prompt,
            provider.slice(4),
            model,
            [],
            webContext,
            media,
          );
        if (typeof direct === "string") answer ||= direct;
        if (!settled) await completion;
        return { text: answer, status: "completed" };
      } catch (error) {
        if (!settled) {
          settled = true;
          rejectCompletion(error);
        }
        // Avoid an unhandled rejection when turn() fails before its lifecycle starts.
        await completion.catch(() => {});
        throw error;
      }
    },
    decide(id, accept) {
      runner.decide(id, accept);
    },
    async stop() {
      await runner.stop();
    },
    async close() {
      if (runner instanceof Codex) runner.close();
      else runner.stop();
    },
  };
}

export class BuildOrchestrator {
  constructor({ emit = () => {}, store = null, credentials, maxWorkers = 3, workerFactory } = {}) {
    this.emit = emit;
    this.store = store;
    this.credentials = credentials;
    this.workerFactory = workerFactory;
    this.pool = new Semaphore(maxWorkers);
    this.writer = new Semaphore(1);
    this.tasks = new Map();
    this.approvalOwners = new Map();
  }

  get active() {
    return this.tasks.size > 0;
  }

  event(task, type, payload = {}) {
    this.emit(type, {
      taskId: task.id,
      projectId: task.project.id,
      ...payload,
    });
  }

  lifecycle(task, agent, status, detail = "") {
    this.event(task, "orchestration-agent", {
      agentId: agent.id,
      role: agent.role,
      label: ROLE_LABELS[agent.role] || agent.role,
      provider: task.provider,
      model: task.model,
      status,
      detail,
    });
  }

  makeWorker(task, agent) {
    const bridge = (type, payload = {}) => bridge.handle(type, payload);
    bridge.handle = (type, payload = {}) => {
      if (type === "approval") {
        if (agent.mode !== "build") {
          try { agent.worker?.decide(payload.id, false); } catch { /* fail closed */ }
          this.lifecycle(task, agent, "failed", "Read-only agent requested write access.");
          return;
        }
        this.approvalOwners.set(String(payload.id), {
          worker: agent.worker,
          taskId: task.id,
        });
        this.emit("approval", {
          ...payload,
          taskId: task.id,
          agentId: agent.id,
          role: agent.role,
        });
        return;
      }
      if (type === "approval-resolved") {
        this.approvalOwners.delete(String(payload.id));
        this.emit(type, { ...payload, taskId: task.id, agentId: agent.id, role: agent.role });
        return;
      }
      if (type !== "codex") return;
      const method = payload.method;
      const item = payload.params?.item || {};
      if (method === "usage/reported" && payload.params?.usage)
        this.event(task, "build-usage", { usage: payload.params.usage });
      // Expose action lifecycle only. Agent prose/reasoning remains private to its role result.
      if (method === "item/started" || (method === "item/completed" && item.type !== "agentMessage"))
        this.event(task, "orchestration-action", {
          agentId: agent.id,
          role: agent.role,
          method,
          action: item.name || item.type || "tool",
        });
    };
    const worker = this.workerFactory
      ? this.workerFactory({ task, agent, emit: bridge })
      : providerWorker({
          provider: task.provider,
          model: task.model,
          project: task.project,
          store: this.store,
          credentials: this.credentials,
          emit: bridge,
        });
    agent.worker = worker;
    task.workers.add(worker);
    return worker;
  }

  async runAgent(task, role, mode, prompt) {
    const agent = { id: randomUUID(), role, mode, worker: null };
    this.lifecycle(task, agent, "queued");
    return this.pool.use(async () => {
      if (task.stopped) throw Error("Build task dihentikan.");
      const worker = this.makeWorker(task, agent);
      this.lifecycle(task, agent, "active");
      try {
        const result = await worker.run({
          mode,
          prompt,
          media: mode === "build" ? task.media : [],
          webContext: task.webContext,
        });
        this.lifecycle(task, agent, "completed");
        return { agentId: agent.id, role, text: result?.text || "", status: "completed" };
      } catch (error) {
        this.lifecycle(task, agent, task.stopped ? "stopped" : "failed", error.message);
        throw error;
      } finally {
        await worker.close?.();
        task.workers.delete(worker);
      }
    });
  }

  specialistPrompts(request) {
    return [
      {
        role: "architecture",
        prompt: `You are the read-only architecture specialist. Inspect the project and prepare a concise implementation brief for another coding agent. Identify relevant files, existing patterns to preserve, and a safe change sequence. Do not edit files or request write access.\n\nUser request:\n${request}`,
      },
      {
        role: "risks",
        prompt: `You are the read-only validation specialist. Inspect the project for regression, security, compatibility, and test risks related to this request. Return a concise checklist for the coding agent. Do not edit files or request write access.\n\nUser request:\n${request}`,
      },
    ];
  }

  synthesize(reports) {
    return reports
      .filter((report) => report.text.trim())
      .map((report) => `### ${ROLE_LABELS[report.role] || report.role}\n${report.text.trim()}`)
      .join("\n\n")
      .slice(0, 30000);
  }

  async run({ taskId = randomUUID(), project, request, provider, model, media = [], webContext = "", strategy = null, context = "" }) {
    if (!project?.id || !project?.path) throw Error("Proyek Build tidak valid.");
    if (typeof request !== "string" || !request.trim()) throw Error("Permintaan Build kosong.");
    if ([...this.tasks.values()].some((task) => task.project.id === project.id))
      throw Error("Build lain masih aktif untuk proyek ini.");
    const task = {
      id: taskId,
      project,
      provider,
      model,
      media,
      webContext,
      workers: new Set(),
      stopped: false,
    };
    this.tasks.set(task.id, task);
    const roles = strategy?.specialists || ["architecture", "risks"];
    this.event(task, "orchestration-task", { status: "active", phase: roles.length ? "specialists" : "builder", workers: roles.length + 1 });
    try {
      const prompts = this.specialistPrompts(request + (context ? `\n\nRelevant project context:\n${context}` : ""))
        .filter(({ role }) => roles.includes(role));
      const settled = await Promise.allSettled(
        prompts.map(({ role, prompt }) =>
          this.runAgent(task, role, "plan", prompt),
        ),
      );
      const reports = settled.map((result, index) =>
        result.status === "fulfilled"
          ? result.value
          : {
              role: prompts[index].role,
              text: "",
              status: "failed",
              error: result.reason?.message || "Specialist failed.",
            },
      );
      if (task.stopped) throw Error("Build task dihentikan.");
      const synthesis = this.synthesize(reports);
      this.event(task, "orchestration-task", { status: "active", phase: "builder" });
      const builderPrompt =
        `You are the sole writable builder for this task. Implement the user's request and run relevant tests. ` +
        `The specialist reports below are advisory and may be incomplete; verify them against the project.\n\n` +
        `User request:\n${request}\n\nRelevant project context:\n${context || "none"}\n\nSpecialist reports:\n${synthesis || "No specialist report was needed."}`;
      const builder = await this.writer.use(() =>
        this.runAgent(task, "builder", "build", builderPrompt),
      );
      this.event(task, "orchestration-task", { status: "completed", phase: "done" });
      return { taskId: task.id, reports, synthesis, builder };
    } catch (error) {
      this.event(task, "orchestration-task", {
        status: task.stopped ? "stopped" : "failed",
        phase: task.stopped ? "stopped" : "failed",
        error: error.message,
      });
      throw error;
    } finally {
      this.tasks.delete(task.id);
      for (const [id, owner] of this.approvalOwners)
        if (owner.taskId === task.id) this.approvalOwners.delete(id);
    }
  }

  decide(id, accept) {
    const owner = this.approvalOwners.get(String(id));
    if (!owner) return false;
    owner.worker.decide(id, accept);
    if (!accept) this.approvalOwners.delete(String(id));
    return true;
  }

  async stop(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    task.stopped = true;
    await Promise.allSettled([...task.workers].map((worker) => worker.stop?.()));
    return true;
  }
}
