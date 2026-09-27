import { imageInputs, audioInputs } from "./attachments.mjs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { sanitizeEnv } from "./env.mjs";
import { killProcess } from "./process-kill.mjs";
export function codexBinary() {
  return (
    process.env.FORGE_CODEX_BIN ||
    [
      path.join(os.homedir(), ".local/bin/codex"),
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex",
    ].find((p) => fs.existsSync(p)) ||
    "codex"
  );
}
export function policy(mode, cwd) {
  if (!["ask", "plan", "build"].includes(mode))
    throw Error("Mode tidak valid.");
  return mode === "build"
    ? {
        type: "workspaceWrite",
        writableRoots: [cwd],
        networkAccess: false,
        excludeTmpdirEnvVar: true,
        excludeSlashTmp: true,
      }
    : { type: "readOnly", networkAccess: false };
}
export class Codex {
  constructor(emit) {
    this.emit = emit;
    this.pending = new Map();
    this.approvals = new Map();
    this.seq = 0;
    this.thread = null;
    this.threads = new Map();
    this.active = null;
  }
  async connect() {
    if (this.ready) return this.ready;
    this.ready = this.start().catch((e) => {
      this.ready = null;
      throw e;
    });
    return this.ready;
  }
  async start() {
    this.child = spawn(codexBinary(), ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: sanitizeEnv(),
    });
    this.stderr = "";
    const child = this.child;
    this.child.on("error", (e) => {
      if (this.child === child) this.fail(e);
    });
    this.child.on("exit", () => {
      if (this.child === child)
        this.fail(Error("Codex berhenti. " + this.stderr.slice(-1200)));
    });
    this.child.stderr.on("data", (c) => {
      this.stderr = (this.stderr + c.toString()).slice(-2000);
    });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      try {
        this.receive(JSON.parse(line));
      } catch (e) {
        this.emit("runtime-warning", { message: e.message });
      }
    });
    const result = await this.request("initialize", {
      clientInfo: { name: "forge", title: "Forge", version: "0.9.0" },
      capabilities: { experimentalApi: false },
    });
    this.send({ method: "initialized", params: {} });
    return result;
  }
  fail(error) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
    this.approvals.clear();
    this.ready = null;
    this.thread = null;
    this.threads = new Map();
    this.active = null;
    this.emit("runtime-error", { message: error.message });
  }
  send(message) {
    if (!this.child?.stdin.writable) throw Error("Codex tidak tersambung.");
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }
  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(`Codex timeout: ${method}`));
        this.child?.kill();
      }, 45000);
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
        if (msg.error) p.reject(Error(msg.error.message));
        else p.resolve(msg.result);
      }
      return;
    }
    if (msg.id !== undefined) {
      const approvalMethods = [
        "item/commandExecution/requestApproval",
        "item/fileChange/requestApproval",
        "permissions/requestApproval",
        "mcpServer/elicitation/requestApproval",
      ];
      if (approvalMethods.includes(msg.method)) {
        const request = {
          id: msg.id,
          method: msg.method,
          ...msg.params,
          projectId: this.active?.projectId,
        };
        this.approvals.set(String(msg.id), request);
        this.emit("approval", request);
      } else {
        this.send({
          id: msg.id,
          error: {
            code: -32601,
            message: "Forge does not support this request; denied.",
          },
        });
        this.emit("runtime-warning", {
          message: `Permintaan tidak didukung ditolak: ${msg.method}`,
        });
      }
      return;
    }
    if (msg.method === "turn/completed") {
      this.active = null;
      this.approvals.clear();
    }
    const projectId = this.active?.projectId;
    this.emit("codex", { ...msg, projectId });
    if (msg.method === "turn/completed") {
      this.emit("project-files-changed", { projectId });
    }
  }
  async models() {
    await this.connect();
    const models = [];
    let cursor = null;
    do {
      const page = await this.request("model/list", {
        limit: 100,
        includeHidden: false,
        ...(cursor ? { cursor } : {}),
      });
      models.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    return models;
  }
  async rateLimits() {
    await this.connect();
    const result = await this.request("account/rateLimits/read");
    const buckets =
      result.rateLimitsByLimitId ||
      (result.rateLimits
        ? { [result.rateLimits.limitId || "codex"]: result.rateLimits }
        : {});
    return Object.entries(buckets).flatMap(([id, bucket]) =>
      ["primary", "secondary"].flatMap((window) => {
        const value = bucket?.[window];
        if (!value || !Number.isFinite(value.usedPercent)) return [];
        return [
          {
            id,
            name: bucket.limitName || id,
            window,
            remainingPercent: Math.max(
              0,
              Math.min(100, 100 - value.usedPercent),
            ),
            windowDurationMins: value.windowDurationMins ?? null,
            resetsAt: value.resetsAt ?? null,
          },
        ];
      }),
    );
  }
  async turn(
    project,
    mode,
    text,
    model = process.env.FORGE_MODEL || null,
    media = [],
    multiAgent = false,
  ) {
    if (this.active) throw Error("Tunggu proses aktif selesai.");
    this.active = { projectId: project.id, turnId: null };
    this.stopRequested = false;
    try {
      await this.connect();
      this.active = { projectId: project.id, turnId: null };
      this.thread = this.threads.get(project.id);
      if (!this.thread) {
        const r = await this.request("thread/start", {
          cwd: project.path,
          // Build intentionally uses "on-request" so every risky command or file
          // change is routed through Forge's approval UI before it can run.
          approvalPolicy: mode === "build" ? "on-request" : "never",
          approvalsReviewer: "user",
          sandbox: mode === "build" ? "workspace-write" : "read-only",
          ...(model ? { model } : {}),
          developerInstructions:
            "Respond in Indonesian for a beginner. Follow the Forge mode on each turn: Ask explains and inspects only, Plan produces a plan without modifying files, Build implements and tests requested changes. Never read or send credential files (.env*, credentials.json, service-account*.json, *.pem, *.key, .npmrc, id_rsa, .pgpass, .netrc). Request explicit user approval before running any shell command or modifying files.",
        });
        this.thread = { id: r.thread.id, projectId: project.id };
        this.threads.set(project.id, this.thread);
      }
      const r = await this.request("turn/start", {
        threadId: this.thread.id,
        ...(model ? { model } : {}),
        input: [
          {
            type: "text",
            text: `Forge mode: ${mode}. ${mode === "build" ? "Implement the requested work." : "Do not modify files or execute mutating commands."}${multiAgent && mode === "build" ? "\n\nMulti-agent mode is enabled. Work as the lead agent and use native sub-agent delegation/collaboration tools when available. Delegate project inspection to an Explorer, implementation to a Builder, and independent verification to a Reviewer. Keep every sub-agent inside the selected workspace and preserve the same approval policy. Do not claim delegation occurred unless sub-agent tools actually ran; if native delegation is unavailable, clearly say so and complete the work safely as the lead." : ""}\n\n${text}`,
            text_elements: [],
          },
          ...imageInputs(media, "codex"),
          ...audioInputs(media, "codex"),
        ],
        sandboxPolicy: policy(mode, project.path),
        approvalPolicy: mode === "build" ? "on-request" : "never",
        approvalsReviewer: "user",
      });
      if (this.active) this.active.turnId = r.turn.id;
      if (this.stopRequested) await this.stop();
      return r;
    } catch (e) {
      this.active = null;
      throw e;
    }
  }
  decide(id, accept) {
    const a = this.approvals.get(String(id));
    if (!a) throw Error("Approval sudah tidak aktif.");
    this.send({
      id: a.id,
      result: { decision: accept ? "accept" : "decline" },
    });
    this.approvals.delete(String(id));
    this.emit("approval-resolved", { id: a.id });
  }
  async stop() {
    this.stopRequested = true;
    if (this.active?.turnId && this.thread)
      await this.request("turn/interrupt", {
        threadId: this.thread.id,
        turnId: this.active.turnId,
      });
  }
  close() {
    killProcess(this.child, 3000);
  }
}
