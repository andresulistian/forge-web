import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Ollama } from "./ollama.mjs";

function bonsaiUrl() {
  const url = new URL(
    process.env.FORGE_BONSAI_URL || "http://127.0.0.1:8080/v1",
  );
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !["/v1", "/v1/"].includes(url.pathname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error(
      "FORGE_BONSAI_URL harus berupa http://127.0.0.1:PORT/v1 pada komputer ini.",
    );
  return url.href.replace(/\/$/, "");
}

function toOpenAiMessages(messages) {
  const ids = new Map();
  return messages.map((entry) => {
    if (entry.role === "tool") {
      const id = ids.get(entry.tool_name)?.shift();
      if (!id)
        throw Error("Respons tool Bonsai kehilangan identitas panggilan.");
      return { role: "tool", tool_call_id: id, content: entry.content };
    }
    if (entry.tool_calls?.length) {
      return {
        role: "assistant",
        content: entry.content || null,
        tool_calls: entry.tool_calls.map((call) => {
          const id = call.id || `call_${randomUUID()}`;
          const name = call.function?.name;
          if (!ids.has(name)) ids.set(name, []);
          ids.get(name).push(id);
          return {
            id,
            type: "function",
            function: {
              name,
              arguments:
                typeof call.function?.arguments === "string"
                  ? call.function.arguments
                  : JSON.stringify(call.function?.arguments || {}),
            },
          };
        }),
      };
    }
    if (entry.images?.length) {
      return {
        role: entry.role,
        content: [
          { type: "text", text: entry.content || "" },
          ...entry.images.map((data) => ({
            type: "image_url",
            image_url: {
              url: `data:${data.startsWith("/9j/") ? "image/jpeg" : "image/png"};base64,${data}`,
            },
          })),
        ],
      };
    }
    return { role: entry.role, content: entry.content || "" };
  });
}

export class Bonsai extends Ollama {
  constructor(emit, dataDir, fetchImpl = globalThis.fetch, store = null) {
    super(
      (type, payload) =>
        emit(type, {
          ...payload,
          ...(payload.provider === "ollama" ? { provider: "bonsai" } : {}),
        }),
      dataDir,
      fetchImpl,
      store,
    );
    this.base = bonsaiUrl();
    this.memoryDir = path.join(dataDir || os.tmpdir(), "bonsai-memory");
  }

  event(method, params = {}) {
    this.emit("codex", {
      provider: "bonsai",
      projectId: this.active?.projectId,
      method,
      params,
    });
  }

  async request(route, options = {}) {
    let response;
    try {
      response = await this.fetch(this.base + route, {
        ...options,
        redirect: "error",
        signal: options.signal || AbortSignal.timeout(10000),
      });
    } catch (error) {
      throw Error(
        `Server Bonsai tidak terhubung di ${this.base}. Jalankan skrip Bonsai-demo yang menampilkan localhost:8080. ${error.message}`,
      );
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw Error(`Server Bonsai (${response.status}): ${detail}`);
    }
    return response;
  }

  async models(signal) {
    const response = await this.request("/models", signal ? { signal } : {});
    const data = await response.json();
    return (data.data || []).filter(
      (item) => typeof item.id === "string" && item.id,
    );
  }

  async startServer() {
    try {
      await this.models();
      return;
    } catch {
      // Start the demo only after the user selects Bonsai or opens its Guide.
    }
    if (!this.selected && !this.guideEnabled)
      throw Error("Pilih Bonsai atau buka Forge Guide terlebih dahulu.");
    if (this.starting) return this.starting;
    this.starting = this.launchServer();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async launchServer() {
    const root = path.resolve(
      process.env.FORGE_BONSAI_DIR || path.join(os.homedir(), "Bonsai-demo"),
    );
    const script = path.join(root, "scripts", "start_llama_server.sh");
    if (!fs.existsSync(script))
      throw Error(
        `Server Bonsai belum aktif. Skrip tidak ditemukan di ${script}. Atur FORGE_BONSAI_DIR atau jalankan server Bonsai manual.`,
      );
    const child = spawn("bash", [script], {
      cwd: root,
      detached: process.platform !== "win32",
      stdio: ["ignore", "ignore", "pipe"],
    });
    this.ownedServer = child;
    let diagnostic = "";
    child.stderr.on("data", (chunk) => {
      diagnostic = (diagnostic + chunk).slice(-1200);
    });
    child.on("error", (error) => {
      diagnostic = error.message;
    });
    child.on("exit", () => {
      if (this.ownedServer === child) this.ownedServer = null;
    });
    for (let attempt = 0; attempt < 90; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        await this.models(AbortSignal.timeout(1200));
        return;
      } catch {
        if (child.exitCode !== null) break;
      }
    }
    this.stopServer();
    throw Error(
      `Bonsai gagal dimulai. ${diagnostic || `Periksa ${script} dan port ${new URL(this.base).port}.`}`,
    );
  }

  stopServer() {
    const child = this.ownedServer;
    this.ownedServer = null;
    if (!child) return;
    try {
      if (process.platform === "win32") child.kill();
      else process.kill(-child.pid, "SIGTERM");
    } catch {
      /* process already stopped */
    }
  }
  async unload(model) {
    this.usedModels.delete(model);
  }

  async catalog(project) {
    if (!this.selected) throw Error("Pilih Bonsai pada pemilih AI.");
    const models = await this.models();
    return {
      provider: "bonsai",
      connected: true,
      local: true,
      models: models.map((m) => ({ id: m.id, name: path.basename(m.id) })),
      defaultModel: models[0]?.id,
      loaded: models.map((m) => m.id),
      memoryCount: project ? await this.memoryCount(project) : 0,
    };
  }

  async defaultGuideModel() {
    const model = (await this.models())[0]?.id;
    if (!model)
      throw Error(
        "Server Bonsai belum menyediakan model. Periksa llama-server di port 8080.",
      );
    return model;
  }

  async guideRemember(project, entry) {
    return super.guideRemember(project, {
      ...entry,
      ...(entry.provider === "ollama" ? { provider: "bonsai" } : {}),
    });
  }

  async remember(project, entry) {
    if (this.store) {
      this.store.addHistory("bonsai", project.id, entry);
      return;
    }
    return super.remember(project, entry);
  }

  async memoryEntries(project) {
    if (this.store) return this.store.history("bonsai", project.id, 10000);
    return super.memoryEntries(project);
  }

  async clearMemory(project) {
    if (this.active)
      throw Error("Tunggu Bonsai selesai sebelum menghapus memori.");
    if (this.store) {
      this.store.clearHistory("bonsai", project.id);
      return { ok: true };
    }
    return super.clearMemory(project);
  }

  async turn(project, mode, text, model, media = [], rawText = text) {
    if (media.some((item) => item.audio))
      throw Error(
        "Bonsai melalui llama.cpp belum mendukung input audio di Forge. Pilih Gemini untuk audio.",
      );
    if (!(await this.models()).some((item) => item.id === model))
      throw Error(
        `Model ${model} tidak tersedia di server Bonsai. Periksa /v1/models.`,
      );
    return super.turn(project, mode, text, model, media, rawText);
  }

  approve(reason, command) {
    return new Promise((resolve) => {
      const id = `bonsai:${randomUUID()}`;
      const approval = {
        id,
        projectId: this.active.projectId,
        reason,
        command,
        resolve,
      };
      this.approvals.set(id, approval);
      this.emit("approval", {
        id,
        projectId: approval.projectId,
        reason,
        command,
      });
    });
  }

  async guideTurn(project, text, context, model) {
    if (!this.guideEnabled) throw Error("Buka Forge Guide terlebih dahulu.");
    if (this.guideActive) throw Error("Forge Guide masih menjawab.");
    if (typeof text !== "string" || !text.trim() || text.length > 12000)
      throw Error("Pesan Guide kosong atau terlalu panjang.");
    if (!(await this.models()).some((item) => item.id === model))
      throw Error(`Model ${model} tidak tersedia di server Bonsai.`);
    const controller = new AbortController();
    const scope = this.guideScope(project);
    this.guideActive = { scope, controller, model };
    this.emit("guide", { scope, kind: "started", model, provider: "bonsai" });
    this.guideCompletion = this.runGuide(
      project,
      text.trim(),
      context,
      model,
      controller,
    );
  }

  async chat(
    payload,
    signal,
    onDelta = (delta) => this.event("item/agentMessage/delta", { delta }),
  ) {
    const response = await this.request("/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: payload.model,
        messages: toOpenAiMessages(payload.messages),
        ...(payload.tools?.length ? { tools: payload.tools } : {}),
        stream: true,
      }),
      signal,
    });
    if (response.headers.get("content-type")?.includes("application/json")) {
      const result = await response.json();
      const message = result.choices?.[0]?.message;
      if (!message) throw Error("Server Bonsai tidak mengembalikan pesan.");
      if (message.content) onDelta(message.content);
      return this.normalize(message);
    }
    const message = { role: "assistant", content: "", tool_calls: [] };
    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .getReader();
    let buffer = "";
    let completed = false;
    while (!completed) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer = (buffer + value).replace(/\r\n/g, "\n");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of event.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") {
            completed = true;
            break;
          }
          const chunk = JSON.parse(data);
          if (chunk.error)
            throw Error(chunk.error.message || JSON.stringify(chunk.error));
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.content) {
            message.content += delta.content;
            onDelta(delta.content);
          }
          for (const part of delta.tool_calls || []) {
            const index = part.index ?? 0;
            const call = (message.tool_calls[index] ||= {
              id: "",
              type: "function",
              function: { name: "", arguments: "" },
            });
            if (part.id) call.id = part.id;
            if (part.function?.name) call.function.name += part.function.name;
            if (part.function?.arguments)
              call.function.arguments += part.function.arguments;
          }
        }
      }
    }
    return this.normalize(message);
  }

  normalize(message) {
    return {
      role: "assistant",
      content: typeof message.content === "string" ? message.content : "",
      tool_calls: (message.tool_calls || []).filter(Boolean).map((call) => {
        let args;
        try {
          args =
            typeof call.function?.arguments === "string"
              ? JSON.parse(call.function.arguments)
              : call.function?.arguments;
        } catch {
          throw Error(
            `Argumen tool Bonsai tidak valid: ${call.function?.name || "unknown"}`,
          );
        }
        return {
          id: call.id,
          type: "function",
          function: { name: call.function?.name, arguments: args || {} },
        };
      }),
    };
  }
}
