export type Draft = {
  text: string;
  attachments?: { id: string; imageUsage?: "auto" | "asset" | "reference" }[];
  mode?: string;
  provider?: string;
  model?: string;
  tab?: string;
  target?: { captureId: string; index: number } | null;
};
type Request = (route: string, body?: unknown) => Promise<any>;
const cacheKey = "forge-drafts-v1";
function cacheRead(): Record<
  string,
  { revision: number; draft: Draft; time: number; dirty?: boolean }
> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(cacheKey);
    if (!raw || raw.length > 450000) return {};
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  } catch {
    return {};
  }
}
function safe(d: Draft): Draft {
  const target = d.target;
  return {
    text: typeof d.text === "string" ? d.text.slice(0, 40000) : "",
    attachments: Array.isArray(d.attachments)
      ? d.attachments
          .slice(0, 10)
          .filter(
            (a) =>
              typeof a?.id === "string" &&
              /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
                a.id,
              ),
          )
          .map((a) => ({
            id: a.id,
            imageUsage: ["auto", "asset", "reference"].includes(
              a.imageUsage || "",
            )
              ? a.imageUsage
              : "auto",
          }))
      : [],
    mode:
      typeof d.mode === "string" && ["ask", "plan", "build"].includes(d.mode)
        ? d.mode
        : "build",
    provider:
      typeof d.provider === "string" &&
      /^(codex|gemini|ollama|api:[a-zA-Z0-9-]{1,80})$/.test(d.provider)
        ? d.provider
        : "codex",
    model: typeof d.model === "string" ? d.model.slice(0, 120) : "",
    tab:
      typeof d.tab === "string" &&
      [
        "preview",
        "files",
        "history",
        "agent",
        "kanban",
        "deploy",
        "terminal",
        "integrations",
        "security",
        "backend",
        "tests",
        "monitor",
      ].includes(d.tab)
        ? d.tab
        : "preview",
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
export class DraftController {
  projectId: string;
  request: Request;
  revision = 0;
  draft: Draft = { text: "" };
  dirty = false;
  loaded = false;
  conflict = false;
  private serverDraft: Draft = { text: "" };
  private pending: Promise<void> | null = null;
  constructor(projectId: string, request: Request) {
    this.projectId = projectId;
    this.request = request;
  }
  async load() {
    const value = await this.request(`session?projectId=${this.projectId}`);
    this.revision = value.revision;
    const cached = cacheRead()[this.projectId];
    this.serverDraft = safe(value.draft);
    this.conflict =
      !!cached &&
      cached.dirty === true &&
      cached.revision !== value.revision &&
      typeof cached.draft?.text === "string";
    this.draft = safe(
      cached &&
        (cached.revision === value.revision || this.conflict) &&
        typeof cached.draft?.text === "string"
        ? cached.draft
        : value.draft,
    );
    this.dirty =
      JSON.stringify(this.draft) !== JSON.stringify(safe(value.draft));
    this.loaded = true;
    return this.draft;
  }
  discardLocal() {
    this.draft = this.serverDraft;
    this.dirty = false;
    this.conflict = false;
    this.cache();
  }
  edit(draft: Draft) {
    this.draft = safe(draft);
    this.dirty = true;
    this.cache();
  }
  private cache() {
    if (typeof window === "undefined") return;
    try {
      const data = cacheRead();
      data[this.projectId] = {
        revision: this.revision,
        dirty: this.dirty,
        draft: this.draft,
        time: Date.now(),
      };
      const bounded = Object.fromEntries(
        Object.entries(data)
          .sort((a, b) => b[1].time - a[1].time)
          .slice(0, 10),
      );
      localStorage.setItem(cacheKey, JSON.stringify(bounded));
    } catch {
      /* Quota/blocked storage: server persistence still works; UI shows save result. */
    }
  }
  async flush(): Promise<void> {
    if (this.pending) {
      await this.pending;
      return this.flush();
    }
    if (!this.loaded || !this.dirty) return;
    const sent = this.draft;
    this.pending = (async () => {
      const value = await this.request("session", {
        projectId: this.projectId,
        expected: this.revision,
        draft: sent,
      });
      this.revision = value.revision;
      this.dirty = this.draft !== sent;
      this.cache();
    })();
    try {
      await this.pending;
    } finally {
      this.pending = null;
    }
    if (this.dirty) await this.flush();
  }
}
