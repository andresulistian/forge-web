const tabs = new Set([
  "preview",
  "files",
  "history",
  "terminal",
  "agent",
  "kanban",
  "deploy",
  "integrations",
  "security",
  "backend",
  "tests",
  "monitor",
  "settings",
]);
export function sanitizeDraft(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("Draft tidak valid.");
  if (typeof input.text !== "string" || input.text.length > 40000)
    throw Error("Draft maksimal 40.000 karakter.");
  const target = input.target;
  const selections = input.attachments ?? [];
  if (!Array.isArray(selections) || selections.length > 10)
    throw Error("Draft maksimal 10 lampiran.");
  const attachments = selections.map((selection) => {
    const id = typeof selection === "string" ? selection : selection?.id;
    const imageUsage =
      typeof selection === "string" || selection?.imageUsage === undefined
        ? "auto"
        : selection.imageUsage;
    if (
      typeof id !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        id,
      ) ||
      !["auto", "asset", "reference"].includes(imageUsage)
    )
      throw Error("Lampiran draft tidak valid.");
    return { id, imageUsage };
  });
  if (new Set(attachments.map((a) => a.id)).size !== attachments.length)
    throw Error("Lampiran draft duplikat.");
  return {
    text: input.text,
    attachments,
    mode: ["ask", "plan", "build"].includes(input.mode) ? input.mode : "build",
    provider:
      typeof input.provider === "string" &&
      /^(codex|gemini|ollama|api:[a-zA-Z0-9-]{1,80})$/.test(input.provider)
        ? input.provider
        : "codex",
    model: typeof input.model === "string" ? input.model.slice(0, 120) : "",
    tab: tabs.has(input.tab) ? input.tab : "preview",
    target:
      target &&
      typeof target.captureId === "string" &&
      /^[a-f0-9-]{36}$/.test(target.captureId) &&
      Number.isInteger(target.index) &&
      target.index >= 0 &&
      target.index < 500
        ? { captureId: target.captureId, index: target.index }
        : null,
  };
}
export class SessionRecovery {
  constructor(store) {
    this.store = store;
  }
  selection() {
    return (
      this.store.setting("session-selection", "app") || { projectId: null }
    );
  }
  get(project) {
    if (!project) throw Error("Pilih proyek.");
    const saved = this.store.setting("session-draft", project.id);
    try {
      return {
        revision: typeof saved?.revision === "number" ? saved.revision : 0,
        draft: sanitizeDraft(saved?.draft || { text: "" }),
      };
    } catch {
      return { revision: 0, draft: sanitizeDraft({ text: "" }) };
    }
  }
  save(project, body) {
    const current = this.get(project);
    if (body.expected !== current.revision)
      throw Error("Draft berubah di sesi lain. Muat ulang sebelum menyimpan.");
    const next = {
      revision: current.revision + 1,
      draft: sanitizeDraft(body.draft),
      savedAt: Date.now(),
    };
    this.store.setSetting("session-draft", project.id, next);
    this.store.setSetting("session-selection", "app", {
      projectId: project.id,
    });
    return next;
  }
}
