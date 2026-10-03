import { randomUUID } from "node:crypto";

const commandStatus = (command = "", ok) => {
  if (!/(^|\s)(test|vitest|jest|playwright|pytest|cargo test|go test)(\s|$)/i.test(command))
    return null;
  return ok === undefined ? "running" : ok ? "passed" : "failed";
};

export class ActivityCenter {
  constructor(store, workspace) {
    this.store = store;
    this.workspace = workspace;
  }

  record(projectId, phase, label, detail = "", extra = {}) {
    if (!projectId) return null;
    return this.store.addHistory("activity", projectId, {
      phase,
      label,
      detail: String(detail || "").slice(0, 2000),
      ...extra,
    });
  }

  begin(project, request, checkpointId) {
    const run = {
      id: randomUUID(),
      projectId: project.id,
      status: "running",
      startedAt: Date.now(),
      finishedAt: null,
      elapsedMs: 0,
      provider: request.provider,
      model: request.model || null,
      mode: request.mode,
      request: request.text,
      retry: request,
      checkpointId: checkpointId || null,
      testStatus: "not-run",
      buildStatus: "not-run",
      reviewStatus: request.mode === "build" ? "pending" : "not-applicable",
      diff: null,
      usage: null,
    };
    this.store.setSetting("agent-run", project.id, run);
    this.record(project.id, "started", "Agent mulai bekerja", request.text, {
      runId: run.id,
      provider: run.provider,
      model: run.model,
    });
    return run;
  }

  current(projectId) {
    return this.store.setting("agent-run", projectId) || null;
  }

  update(projectId, patch) {
    const run = this.current(projectId);
    if (!run) return null;
    const next = { ...run, ...patch };
    this.store.setSetting("agent-run", projectId, next);
    return next;
  }

  async finish(project, error = null, status = null) {
    const run = this.current(project.id);
    if (!run || run.status !== "running") return run;
    let diff = null;
    if (run.mode === "build" && run.checkpointId)
      diff = await this.workspace.diff(project, run.checkpointId).catch((cause) => ({
        files: [],
        stat: "",
        patch: "",
        error: cause.message,
      }));
    if (this.current(project.id)?.id !== run.id) return this.current(project.id);
    const finishedAt = Date.now();
    const next = this.update(project.id, {
      status: status === "interrupted" ? "interrupted" : error ? "failed" : "completed",
      finishedAt,
      elapsedMs: finishedAt - run.startedAt,
      reviewStatus:
        run.mode === "build" && diff?.files?.length ? "ready" : "no-changes",
      diff,
      error: error ? String(error).slice(0, 2000) : null,
    });
    this.record(
      project.id,
      error ? "error" : "completed",
      error ? "Agent berhenti karena error" : "Agent selesai",
      error || `${Math.round(next.elapsedMs / 1000)} detik`,
      { runId: run.id },
    );
    return next;
  }

  async observe(type, payload, project) {
    const projectId = payload?.projectId;
    if (!projectId) return;
    if (type === "codex") {
      const method = payload.method;
      const item = payload.params?.item || {};
      if (method === "item/started") {
        const raw = `${item.type || ""} ${item.name || ""} ${item.command || ""}`;
        const phase = /read/i.test(raw)
          ? "reading"
          : /search|list/i.test(raw)
            ? "searching"
            : /fileChange|write|edit/i.test(raw)
              ? "editing"
              : /command|tool/i.test(raw)
                ? "running"
                : "working";
        this.record(projectId, phase, this.label(phase), item.command || item.name || item.type);
      }
      if (method === "item/completed" && /command/i.test(item.type || "")) {
        const command = item.command || item.aggregatedOutput || "";
        const ok = item.exitCode === undefined ? undefined : item.exitCode === 0;
        const testStatus = commandStatus(command, ok);
        const buildStatus = /(^|\s)(build|tsc|vite build|cargo build)(\s|$)/i.test(command)
          ? ok === undefined
            ? "running"
            : ok
              ? "passed"
              : "failed"
          : null;
        if (testStatus || buildStatus)
          this.update(projectId, {
            ...(testStatus ? { testStatus } : {}),
            ...(buildStatus ? { buildStatus } : {}),
          });
      }
      if (method === "usage" && payload.params)
        this.update(projectId, { usage: payload.params });
      if (method === "turn/completed" && project)
        await this.finish(project, payload.params?.turn?.error?.message || (["failed", "interrupted"].includes(payload.params?.turn?.status) ? `Run ${payload.params.turn.status}` : null), payload.params?.turn?.status);
    }
    if (type === "terminal-started") {
      this.record(projectId, "running", "Menjalankan command", payload.command);
      const testStatus = commandStatus(payload.command);
      if (testStatus) this.update(projectId, { testStatus });
    }
    if (type === "terminal-completed") {
      const testStatus = commandStatus(payload.command, payload.ok);
      const buildStatus = /(^|\s)(build|tsc|vite build|cargo build)(\s|$)/i.test(payload.command || "")
        ? payload.ok
          ? "passed"
          : "failed"
        : null;
      if (testStatus || buildStatus)
        this.update(projectId, {
          ...(testStatus ? { testStatus } : {}),
          ...(buildStatus ? { buildStatus } : {}),
        });
    }
    if (type === "runtime-error" && project) await this.finish(project, payload.message);
  }

  label(phase) {
    return (
      {
        reading: "Membaca file",
        searching: "Mencari di codebase",
        editing: "Mengedit file",
        running: "Menjalankan tool atau command",
        working: "Memproses langkah agent",
      }[phase] || "Agent bekerja"
    );
  }

  view(projectId) {
    return {
      run: this.current(projectId),
      activities: this.store.history("activity", projectId, 150).reverse(),
    };
  }
}
