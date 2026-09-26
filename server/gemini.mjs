import { imageInputs, audioInputs } from "./attachments.mjs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function geminiBinary() {
  return (
    process.env.FORGE_GEMINI_BIN ||
    [
      "/usr/local/bin/gemini",
      "/opt/homebrew/bin/gemini",
      path.join(os.homedir(), ".local/bin/gemini"),
    ].find((p) => fs.existsSync(p)) ||
    "gemini"
  );
}
// The CLI resolves these official aliases to models available to the Google account.
export const GEMINI_MODELS = [
  { id: "flash", name: "Gemini Flash" },
  { id: "pro", name: "Gemini Pro" },
];
export class Gemini {
  constructor(emit, runtimeDir = process.cwd()) {
    this.runtimeDir = runtimeDir;
    this.emit = emit;
    this.seq = 0;
    this.pending = new Map();
    this.approvals = new Map();
    this.sessions = new Map();
    this.usage = new Map();
    this.active = null;
  }
  async connect() {
    if (!this.ready)
      this.ready = this.start().catch((e) => {
        this.ready = null;
        throw e;
      });
    return this.ready;
  }
  async start() {
    fs.mkdirSync(this.runtimeDir, { recursive: true });
    const child = spawn(
      geminiBinary(),
      ["--acp", "--approval-mode", "default"],
      {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: this.runtimeDir,
        detached: process.platform !== "win32",
      },
    );
    this.child = child;
    child.stderr.on("data", () => {}); // Do not expose OAuth/credential diagnostics to the frontend.
    child.stdin.on("error", () => {});
    child.on("error", (e) =>
      this.fail(
        Error(
          `Gemini CLI tidak tersedia: ${e.code || "startup gagal"}. Periksa FORGE_GEMINI_BIN.`,
        ),
        child,
      ),
    );
    child.on("exit", () =>
      this.fail(
        Error(
          "Gemini CLI berhenti. Hubungkan ulang; jika belum login, klik Login Google.",
        ),
        child,
      ),
    );
    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        this.receive(JSON.parse(line));
      } catch {
        /* Ignore CLI non-protocol output. */
      }
    });
    const info = await this.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "forge", version: "0.8.0" },
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
    });
    this.info = info;
    return info;
  }
  fail(error, child = this.child) {
    if (child !== this.child) return;
    this.ready = null;
    this.sessions.clear();
    this.usage.clear();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    this.approvals.clear();
    const wasActive = this.active;
    this.active = null;
    this.emit(wasActive ? "runtime-error" : "provider-status", {
      provider: "gemini",
      message: error.message,
    });
  }
  send(value) {
    if (!this.child?.stdin.writable) throw Error("Gemini tidak tersambung.");
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + "\n");
  }
  request(method, params, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(`Gemini timeout (${method}). Coba hubungkan ulang.`));
        this.killTree();
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  receive(msg) {
    if (msg.id !== undefined && !msg.method) {
      const p = this.pending.get(msg.id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(msg.id);
        if (msg.error) p.reject(Error(msg.error.message || "Gemini gagal"));
        else p.resolve(msg.result);
      }
      return;
    }
    if (msg.id !== undefined) {
      if (msg.method === "session/request_permission") {
        const a = msg.params;
        // Never allow approval to escape Ask/Plan or an unrelated session.
        if (
          !this.active ||
          this.active.sessionId !== a.sessionId ||
          this.active.mode !== "build"
        ) {
          this.send({
            id: msg.id,
            result: { outcome: { outcome: "cancelled" } },
          });
          return;
        }
        const id = `gemini:${msg.id}`;
        this.approvals.set(id, {
          ...a,
          id,
          rpcId: msg.id,
          provider: "gemini",
          projectId: this.active.projectId,
          reason: a.toolCall?.title,
          command: JSON.stringify(a.toolCall, null, 2),
        });
        this.emit("approval", this.approvals.get(id));
      } else
        this.send({
          id: msg.id,
          error: {
            code: -32601,
            message: "Unsupported client capability; denied.",
          },
        });
      return;
    }
    if (
      msg.method === "session/update" &&
      this.active?.sessionId === msg.params.sessionId
    ) {
      const u = msg.params.update;
      if (
        u.sessionUpdate === "usage_update" &&
        Number.isFinite(u.size) &&
        Number.isFinite(u.used)
      ) {
        this.usage.set(this.active.projectId, { used: u.used, size: u.size });
      }
      if (
        u.sessionUpdate === "agent_message_chunk" &&
        u.content?.type === "text"
      ) {
        this.active.text += u.content.text;
        this.event("item/agentMessage/delta", { delta: u.content.text });
      } else this.event("gemini/" + u.sessionUpdate, u);
    }
  }
  event(method, params) {
    this.emit("codex", {
      provider: "gemini",
      projectId: this.active?.projectId,
      method,
      params,
    });
  }
  contextUsage(projectId) {
    return projectId ? this.usage.get(projectId) || null : null;
  }
  async session(project) {
    await this.connect();
    if (!this.sessions.has(project.id)) {
      const s = await this.request("session/new", {
        cwd: project.path,
        mcpServers: [],
      });
      this.sessions.set(project.id, s);
    }
    return this.sessions.get(project.id);
  }
  async login() {
    const info = await this.connect();
    const method = info.authMethods?.find((m) => m.id === "oauth-personal");
    if (!method)
      throw Error(
        "Login Google tidak ditawarkan Gemini CLI ini. Jalankan gemini di Terminal.",
      );
    await this.request("authenticate", { methodId: method.id }, 300000);
    this.sessions.clear();
    this.usage.clear();
    return { connected: true };
  }
  async turn(project, mode, text, model = "flash", media = []) {
    if (this.active) throw Error("Gemini masih bekerja.");
    if (
      !["ask", "plan", "build"].includes(mode) ||
      !GEMINI_MODELS.some((m) => m.id === model)
    )
      throw Error("Mode/model Gemini tidak valid.");
    this.active = { projectId: project.id, mode, sessionId: null, text: "" };
    this.cancelled = false;
    try {
      const session = await this.session(project);
      if (
        media.some((i) => i.audio) &&
        this.info &&
        this.info.agentCapabilities?.promptCapabilities?.audio !== true
      )
        throw Error(
          "Gemini CLI ini tidak mendukung input audio ACP. Perbarui CLI; audio tidak akan diabaikan.",
        );
      this.active.sessionId = session.sessionId;
      const modeId = mode === "build" ? "default" : "plan";
      if (!session.modes?.availableModes?.some((m) => m.id === modeId))
        throw Error(
          "Gemini CLI tidak menyediakan mode aman yang diminta. Perbarui CLI; Ask/Plan tidak akan dijalankan dengan akses tulis.",
        );
      await this.request("session/set_mode", {
        sessionId: session.sessionId,
        modeId,
      });
      await this.request("session/set_model", {
        sessionId: session.sessionId,
        modelId: model,
      });
      if (this.cancelled) {
        this.event("turn/completed", { turn: { status: "interrupted" } });
        this.active = null;
        return;
      }
      this.event("turn/started", { turn: { id: session.sessionId }, model });
      // Keep the HTTP request short; ACP prompt resolves only after the whole turn.
      this.completion = this.request(
        "session/prompt",
        {
          sessionId: session.sessionId,
          prompt: [
            {
              type: "text",
              text: `Respond in Indonesian. Forge mode: ${mode}. ${mode === "build" ? "Implement and test the requested work." : "Inspect and explain only; do not modify files. Do not leave Plan mode."}\n\n${text}`,
            },
            ...imageInputs(media, "gemini"),
            ...audioInputs(media, "gemini"),
          ],
        },
        1800000,
      )
        .then((result) => {
          if (this.active?.text)
            this.event("item/completed", {
              item: {
                type: "agentMessage",
                text: this.active.text,
                provider: "gemini",
                model,
              },
            });
          this.event("turn/completed", {
            turn: {
              status:
                result.stopReason === "cancelled" ? "interrupted" : "completed",
            },
          });
        })
        .catch((e) => {
          this.event("turn/completed", {
            turn: { status: "failed", error: { message: e.message } },
          });
        })
        .finally(() => {
          this.active = null;
          this.approvals.clear();
        });
    } catch (e) {
      this.active = null;
      throw e;
    }
  }
  decide(id, accept) {
    const a = this.approvals.get(id);
    if (!a) throw Error("Approval Gemini sudah berakhir.");
    const option = a.options?.find((o) => o.kind === "allow_once");
    if (accept && !option)
      throw Error("Gemini tidak menawarkan izin sekali. Tolak permintaan ini.");
    this.send({
      id: a.rpcId,
      result: {
        outcome: accept
          ? { outcome: "selected", optionId: option.optionId }
          : { outcome: "cancelled" },
      },
    });
    this.approvals.delete(id);
    this.emit("approval-resolved", { id });
  }
  async stop() {
    this.cancelled = true;
    for (const id of [...this.approvals.keys()]) this.decide(id, false);
    const active = this.active;
    if (this.active?.sessionId)
      this.send({
        method: "session/cancel",
        params: { sessionId: this.active.sessionId },
      });
    if (active)
      setTimeout(() => {
        if (this.active === active) this.killTree();
      }, 10000).unref();
  }
  killTree() {
    try {
      if (this.child?.pid) {
        if (process.platform === "win32") this.child.kill();
        else process.kill(-this.child.pid, "SIGTERM");
      }
    } catch {
      /* already exited */
    }
  }
  close() {
    this.killTree();
  }
}
