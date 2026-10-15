import path from "node:path";
import { randomUUID } from "node:crypto";
import { Agents as ProviderAgents } from "./provider-agents.mjs";
import { planSpecialists } from "./workflow-plan.mjs";
import { activeWorkflow } from "./workflow-bindings.mjs";
import { coordinateSpecialists } from "./specialist-coordinator.mjs";
import { runProjectChecks } from "./workflow-checks.mjs";

const errorOf = (value) => value instanceof Error ? value : Error(String(value?.message || value || "Workflow gagal."));
const LABELS = { explorer: "Explorer", frontend: "Frontend Specialist", backend: "Backend Specialist", fullstack: "Full-stack Specialist", builder: "Builder", reviewer: "Independent Reviewer", qa: "QA: actual project checks" };

// The previous provider facade is retained byte-for-byte in provider-agents.mjs.
// One parent lifecycle wraps all stages, so sub-agent completion cannot close a
// Kanban task, lose progress, or create duplicate assistant chat messages.
export class Agents extends ProviderAgents {
  constructor(emit, runtimeDir, dataDir = runtimeDir, store = null) {
    const state = { run: null, retiredIds: new Set() };
    super((type, payload = {}) => {
      if (payload.projectId && state.retiredIds.has(payload.projectId)) return;
      return state.run ? state.run.bridge(type, payload) : emit(type, payload);
    }, runtimeDir, dataDir, store);
    this.workflowState = state;
    this.workflowEmit = emit;
    this.workflowDataDir = path.resolve(dataDir || runtimeDir || ".forge");
  }
  get active() { return this.workflowState?.run?.publicState || super.active; }
  get approvals() {
    const run = this.workflowState?.run;
    return new Map([...super.approvals, ...(run?.approvals || [])].map(([id, approval]) =>
      [id, run ? { ...approval, projectId: run.project.id } : approval]));
  }

  assertWorkflowProvider(provider) {
    if (provider.startsWith("api:") && this.apiProviders.find(provider.slice(4)).type === "vikey")
      throw Error("ViKey tetap dinonaktifkan. Pilih provider yang masih digunakan.");
  }
  async catalog(provider, project) {
    this.assertWorkflowProvider(provider);
    return super.catalog(provider, project);
  }
  async turn(project, mode, text, provider = "codex", model, media = [], rawText = text, webContext = "", multiAgent = false) {
    if (this.active) throw Error("Agent masih bekerja.");
    this.assertWorkflowProvider(provider);
    if (!multiAgent || mode !== "build") return super.turn(project, mode, text, provider, model, media, rawText, webContext, false);
    if (provider !== "codex" && (!provider.startsWith("api:") || this.apiProviders.find(provider.slice(4)).type !== "openrouter"))
      throw Error("Koordinator specialist saat ini mendukung Codex dan OpenRouter. Provider lain tetap dapat memakai Single Agent.");
    // Pin one explicitly available model for the whole workflow. Never switch
    // provider/model during a repair, and preserve existing modality checks.
    if (provider === "codex") {
      const models = await this.codex.models();
      model ||= models.find((item) => item.isDefault)?.model;
      const selected = models.find((item) => item.model === model);
      if (!selected) throw Error("Model ini tidak tersedia pada runtime Codex Anda.");
      if (media.some((item) => item.audio) && !selected.inputModalities?.includes("audio"))
        throw Error("Model Codex ini tidak mengiklankan dukungan audio; audio tidak akan dibuang.");
      if (media.some((item) => item.images?.length) && selected.inputModalities && !selected.inputModalities.includes("image"))
        throw Error("Model ini tidak mendukung gambar.");
    } else model ||= this.apiProviders.find(provider.slice(4)).defaultModel;
    const binding = activeWorkflow(this.workflowDataDir, project.id);
    const plan = binding?.plan || planSpecialists(rawText, "balanced", true);
    const run = {
      id: binding?.runId || randomUUID(), project, provider, plan,
      publicState: { projectId: project.id, turnId: null },
      controller: new AbortController(), approvals: new Map(), stage: null, reportedTokens: 0,
    };
    run.bridge = (type, payload) => this.workflowEvent(run, type, payload);
    this.workflowState.run = run;
    const emit = (type, payload = {}) => this.workflowEmit(type, { ...payload, projectId: project.id, provider, runId: run.id });
    run.emit = emit;
    emit("codex", { method: "turn/started", params: { stage: "planning-specialists", label: "Menyiapkan specialist" } });
    emit("agent-team", { role: "lead", status: "started", detail: `Rute: ${plan.roles.join(" → ")}. Satu penulis aktif; provider tetap ${provider}.` });
    let outcome;
    try {
      outcome = await coordinateSpecialists({
        plan, request: rawText,
        context: (text.startsWith(rawText) ? text.slice(rawText.length) : text) + webContext,
        signal: run.controller.signal,
        runAgent: (stage) => this.runWorkflowStage(run, stage, model, media),
        verify: ({ signal }) => runProjectChecks(project, { signal, approve: (request) => this.workflowApproval(run, request) }),
        emit: ({ role, status, attempt, detail = "" }) => emit("agent-team", {
          role: ["frontend", "backend", "fullstack"].includes(role) ? "builder" : role === "qa" ? "reviewer" : role,
          specialist: role, status, attempt, detail: `${LABELS[role] || role} · ronde ${attempt + 1}${detail ? ` · ${detail}` : ""}`,
        }),
      });
      if (binding) await binding.record(outcome);
      const latest = outcome.reports.filter((report) => plan.builders.includes(report.role) && report.attempt === outcome.attempts - 1);
      const summary = latest.map((report) => `${LABELS[report.role]}:\n${report.text}`).join("\n\n") +
        `\n\nQA: ${outcome.checks.results.map((check) => `${check.name}: ${check.ok ? "PASS" : "FAIL"}`).join(", ")}.\nReviewer: ${outcome.review.verdict}. ${outcome.review.reason}\n` +
        (outcome.ok ? "Pemeriksaan workflow lulus. Perubahan tetap perlu Accept dan regression checks Kanban sebelum Done." : "Hasil belum lolos. Jangan tandai Done atau deploy sebelum temuan diselesaikan.");
      emit("codex", { method: "item/completed", params: { item: { type: "agentMessage", text: summary } } });
      emit("codex", { method: "turn/completed", params: { turn: outcome.ok ? { status: "completed" } : { status: "failed", error: { message: outcome.review.reason || "QA/review belum lolos." } } } });
      emit("agent-team", { role: "lead", status: outcome.ok ? "completed" : "failed", detail: `${outcome.calls} pemanggilan agent; ${outcome.attempts} ronde. ${outcome.ok ? "Siap untuk review pengguna." : "Masih ada temuan."}` });
      return summary;
    } catch (error) {
      const failure = { ok: false, reason: error.message, checks: outcome?.checks || null, review: outcome?.review || null };
      if (binding) await binding.record(failure).catch(() => {});
      emit("codex", { method: "turn/completed", params: { turn: { status: run.controller.signal.aborted ? "interrupted" : "failed", error: { message: error.message } } } });
      emit("agent-team", { role: "lead", status: "failed", detail: error.message });
      throw error;
    } finally {
      for (const approval of run.approvals.values()) approval.resolve(false);
      run.approvals.clear();
      if (this.codex.active) {
        this.codex.close();
        this.codex.fail(Error("Sesi specialist ditutup."));
      }
      if (this.apiProviders.active) this.apiProviders.stop();
      this.workflowState.run = null;
    }
  }

  workflowEvent(run, type, payload) {
    const stage = run.stage;
    if (type === "runtime-error") { stage?.reject(errorOf(payload.message)); return run.emit(type, payload); }
    if (type === "project-files-changed") return;
    if (type !== "codex") return run.emit(type, payload);
    if (!stage || (payload.projectId && payload.projectId !== stage.project.id && payload.projectId !== run.project.id)) return;
    const method = payload.method;
    const params = payload.params || {};
    if (method === "item/completed" && params.item?.type === "agentMessage") { stage.text = params.item.text || stage.text; return; }
    if (method === "turn/completed") {
      const turn = params.turn || {};
      if (turn.error || ["failed", "cancelled", "interrupted"].includes(turn.status)) stage.reject(errorOf(turn.error || turn.status));
      else stage.resolve();
      return;
    }
    if (method === "turn/started" || method === "item/agentMessage/delta") return;
    let usage = method === "usage" ? params : null;
    if (method === "thread/tokenUsage/updated") {
      const total = params.tokenUsage?.total;
      if (total && Number.isFinite(total.inputTokens) && Number.isFinite(total.outputTokens)) {
        usage = { input_tokens: Math.max(0, total.inputTokens - stage.inputTokens), output_tokens: Math.max(0, total.outputTokens - stage.outputTokens) };
        stage.inputTokens = total.inputTokens;
        stage.outputTokens = total.outputTokens;
      }
    }
    if (usage) {
      const input = Number(usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens);
      const output = Number(usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens);
      run.reportedTokens += (Number.isFinite(input) && input > 0 ? input : 0) + (Number.isFinite(output) && output > 0 ? output : 0);
      run.emit("codex", { method: "usage", params: usage, specialist: stage.role, agentId: stage.id });
      if (run.reportedTokens > run.plan.maxReportedTokens) {
        stage.reject(Error("Batas token yang dilaporkan provider tercapai. Workflow dihentikan; tidak beralih provider."));
        void this.stop().catch(() => {});
      }
      return;
    }
    run.emit(type, { ...payload, specialist: stage.role, agentId: stage.id });
  }

  async runWorkflowStage(run, specification, model, media) {
    if (run.controller.signal.aborted) throw Error("Workflow dihentikan.");
    let resolve;
    let reject;
    const completion = new Promise((yes, no) => { resolve = yes; reject = no; });
    completion.catch(() => {});
    const id = randomUUID();
    const stage = { ...specification, id, project: { ...run.project, id: `workflow-${id}` }, text: "", inputTokens: 0, outputTokens: 0, resolve, reject };
    run.stage = stage;
    const cancel = () => reject(Error("Workflow dihentikan."));
    run.controller.signal.addEventListener("abort", cancel, { once: true });
    // A stalled provider may not emit completion. Approval waits are bounded too.
    const timer = setTimeout(() => { reject(Error("Batas waktu specialist tercapai.")); void this.stop().catch(() => {}); }, 20 * 60 * 1000);
    try {
      const execution = run.provider === "codex"
        ? this.codex.turn(stage.project, specification.mode, specification.prompt, model, media, false)
        : this.apiProviders.turn(stage.project, specification.mode, specification.prompt, run.provider.slice(4), model, [], "", media, specification.prompt, false);
      const direct = await Promise.race([execution, completion.then(() => null)]);
      if (run.provider === "codex") await completion;
      else if (typeof direct === "string") stage.text = direct;
      else await execution;
      if (!stage.text.trim()) throw Error(`${specification.role} tidak memberikan laporan.`);
      return { text: stage.text };
    } finally {
      clearTimeout(timer);
      run.controller.signal.removeEventListener("abort", cancel);
      this.codex.threads?.delete(stage.project.id);
      this.workflowState.retiredIds.add(stage.project.id);
      if (this.workflowState.retiredIds.size > 512) this.workflowState.retiredIds.delete(this.workflowState.retiredIds.values().next().value);
      run.stage = null;
    }
  }

  workflowApproval(run, request) {
    if (run.controller.signal.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
      const id = `workflow:${randomUUID()}`;
      const approval = { id, projectId: run.project.id, ...request, resolve };
      run.approvals.set(id, approval);
      run.emit("approval", { id, projectId: run.project.id, ...request });
    });
  }
  decide(id, accept) {
    const run = this.workflowState?.run;
    const approval = run?.approvals.get(String(id));
    if (!approval) return super.decide(id, accept);
    run.approvals.delete(String(id));
    approval.resolve(accept === true);
    run.emit("approval-resolved", { id: String(id) });
  }
  async stop() {
    const run = this.workflowState?.run;
    if (run) {
      run.controller.abort();
      for (const approval of [...run.approvals.values()]) this.decide(approval.id, false);
    }
    try { return await super.stop(); }
    catch (error) { if (!run) throw error; return { stopped: true }; }
  }
  async close() { if (this.workflowState?.run) await this.stop(); return super.close(); }
}
