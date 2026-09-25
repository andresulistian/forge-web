import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { privateName, safeFile } from "./workspace.mjs";

const exec = promisify(execFile);
const DEFAULT_MODEL = "qwen3.5:9b-mlx";

function ollamaUrl() {
  const value = process.env.FORGE_OLLAMA_URL || "http://127.0.0.1:11434";
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/"
  )
    throw Error("FORGE_OLLAMA_URL harus berupa alamat HTTP loopback lokal.");
  return url.href.replace(/\/$/, "");
}

export function ollamaBinary() {
  const candidates = [
    process.env.FORGE_OLLAMA_BIN,
    "/usr/local/bin/ollama",
    "/opt/homebrew/bin/ollama",
    path.join(os.homedir(), ".local/bin/ollama"),
    "ollama",
  ].filter(Boolean);
  return candidates.find((candidate) =>
    candidate.includes(path.sep) ? existsSync(candidate) : true,
  );
}

function schemas(mode) {
  const read = [
    tool(
      "list_files",
      "List project files. Use before reading unfamiliar projects.",
      {},
    ),
    tool(
      "read_file",
      "Read one UTF-8 project file, excluding secrets and dependencies.",
      {
        file: { type: "string", description: "Project-relative file path" },
      },
      ["file"],
    ),
  ];
  if (mode !== "build") return read;
  return [
    ...read,
    tool(
      "write_file",
      "Create or replace one project file after user approval.",
      {
        file: { type: "string", description: "Project-relative file path" },
        content: {
          type: "string",
          description: "Complete new UTF-8 file content",
        },
      },
      ["file", "content"],
    ),
    tool(
      "run_command",
      "Run a shell command in the project after user approval.",
      {
        command: {
          type: "string",
          description: "Shell command to run in the project",
        },
      },
      ["command"],
    ),
  ];
}

function tool(name, description, properties, required = []) {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties, required },
    },
  };
}

async function writableFile(root, relative) {
  if (
    typeof relative !== "string" ||
    !relative ||
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/).some(privateName)
  )
    throw Error("File tidak diizinkan.");
  const destination = path.resolve(root, relative);
  const rel = path.relative(root, destination);
  if (rel.startsWith("..") || path.isAbsolute(rel))
    throw Error("File berada di luar proyek.");
  let current = root;
  for (const segment of path.dirname(rel).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if ((await fs.lstat(current)).isSymbolicLink())
        throw Error("Folder symlink tidak dapat ditulis.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  try {
    if ((await fs.lstat(destination)).isSymbolicLink())
      throw Error("File symlink tidak dapat ditulis.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return destination;
}

export class Ollama {
  constructor(emit, dataDir, fetchImpl = globalThis.fetch, store = null) {
    this.emit = emit;
    this.fetch = fetchImpl;
    this.store = store;
    this.base = ollamaUrl();
    this.memoryDir = path.join(
      dataDir || path.join(os.tmpdir(), "forge-agent-runtime"),
      "ollama-memory",
    );
    this.guideDir = path.join(
      dataDir || path.join(os.tmpdir(), "forge-agent-runtime"),
      "guide-memory",
    );
    this.active = null;
    this.guideActive = null;
    this.guideEnabled = false;
    this.approvals = new Map();
    this.selected = false;
    this.selectedModel = DEFAULT_MODEL;
    this.usedModels = new Set();
    this.ownedServer = null;
  }

  event(method, params = {}) {
    this.emit("codex", {
      provider: "ollama",
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
        signal: options.signal || AbortSignal.timeout(10000),
      });
    } catch (error) {
      throw Error(
        `Ollama lokal tidak dapat dihubungi di ${this.base}. Buka Ollama atau jalankan ollama serve. ${error.message}`,
      );
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw Error(
        `Ollama gagal (HTTP ${response.status}). ${detail.slice(0, 500)}`,
      );
    }
    return response;
  }

  async startServer() {
    try {
      await this.request("/api/tags");
      return;
    } catch {
      /* Start an Ollama server only when Local AI is explicitly selected. */
    }
    if (!this.selected && !this.guideEnabled)
      throw Error("Aktifkan Local AI atau buka Forge Guide terlebih dahulu.");
    const child = spawn(ollamaBinary(), ["serve"], {
      detached: process.platform !== "win32",
      stdio: ["ignore", "ignore", "pipe"],
    });
    this.ownedServer = child;
    let diagnostic = "";
    child.stderr.on("data", (chunk) => {
      diagnostic = (diagnostic + chunk).slice(-1000);
    });
    child.on("exit", () => {
      if (this.ownedServer === child) this.ownedServer = null;
    });
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      try {
        await this.request("/api/tags");
        return;
      } catch {
        if (child.exitCode !== null) break;
      }
    }
    this.stopServer();
    throw Error(
      `Ollama gagal dimulai. ${diagnostic || "Jalankan ollama serve di Terminal."}`,
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
      /* already stopped */
    }
  }

  async select(selected, model = DEFAULT_MODEL) {
    if (this.active)
      throw Error("Tunggu Local AI selesai sebelum mengganti AI.");
    const previous = this.selectedModel;
    this.selected = selected;
    this.selectedModel = model || DEFAULT_MODEL;
    if (selected) {
      await this.startServer();
      if (!model) this.selectedModel = await this.defaultGuideModel();
      if (previous !== this.selectedModel && this.usedModels.has(previous))
        await this.unload(previous);
      return { selected: true };
    }
    if (!this.guideEnabled) {
      await this.unloadAll();
      this.stopServer();
    }
    return { selected: false };
  }

  async setGuideEnabled(enabled) {
    this.guideEnabled = Boolean(enabled);
    if (this.guideEnabled) {
      await this.startServer();
      return { enabled: true };
    }
    await this.stopGuide();
    await this.guideCompletion?.catch(() => {});
    if (!this.selected && !this.guideEnabled) {
      await this.unloadAll();
      this.stopServer();
    }
    return { enabled: false };
  }

  async catalog(project) {
    if (!this.selected) throw Error("Aktifkan Local AI pada pemilih AI.");
    await this.startServer();
    const [tags, running] = await Promise.all([
      this.request("/api/tags").then((r) => r.json()),
      this.request("/api/ps")
        .then((r) => r.json())
        .catch(() => ({ models: [] })),
    ]);
    const loaded = new Set(
      (running.models || []).map((m) => m.model || m.name),
    );
    return {
      provider: "ollama",
      connected: true,
      local: true,
      models: (tags.models || []).map((model) => ({
        id: model.model || model.name,
        name: model.model || model.name,
        loaded: loaded.has(model.model || model.name),
      })),
      defaultModel: this.preferredModel(tags.models || []),
      loaded: [...loaded],
      memoryCount: project ? await this.memoryCount(project) : 0,
    };
  }

  preferredModel(models) {
    const names = models.map((item) => item.model || item.name);
    return [DEFAULT_MODEL, "qwen3.5:9b", "gemma4:12b"].find((name) => names.includes(name)) || names[0];
  }

  async defaultGuideModel() {
    await this.startServer();
    const tags = await this.request("/api/tags").then((response) => response.json());
    const model = this.preferredModel(tags.models || []);
    if (!model) throw Error("Belum ada model Ollama lokal. Instal model melalui ollama pull.");
    return model;
  }

  memoryFile(project) {
    return path.join(this.memoryDir, project.id + ".jsonl");
  }

  async remember(project, entry) {
    if (this.store) {
      this.store.addHistory("ollama", project.id, entry);
      return;
    }
    await fs.mkdir(this.memoryDir, { recursive: true });
    await fs.appendFile(
      this.memoryFile(project),
      JSON.stringify({ ...entry, time: Date.now() }) + "\n",
      { mode: 0o600 },
    );
  }

  async memoryEntries(project) {
    if (this.store) return this.store.history("ollama", project.id, 10000);
    try {
      return (await fs.readFile(this.memoryFile(project), "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async memory(project, query = "") {
    const entries = await this.memoryEntries(project);
    const terms = new Set(
      query.toLocaleLowerCase("id").match(/[\p{L}\p{N}_-]{4,}/gu) || [],
    );
    const scored = entries
      .map((entry, index) => ({
        index,
        score: [...terms].reduce(
          (score, term) =>
            score +
            (entry.content || "").toLocaleLowerCase("id").includes(term),
          0,
        ),
      }))
      .filter((item) => item.score)
      .sort((a, b) => b.score - a.score || b.index - a.index)
      .slice(0, 4)
      .map((item) => item.index);
    const candidates = new Set([
      ...entries
        .slice(-6)
        .map((_entry, offset) => Math.max(0, entries.length - 6) + offset),
      ...scored,
    ]);
    const selected = [];
    let size = 0;
    for (const index of [...candidates]
      .filter((i) => i >= 0)
      .sort((a, b) => b - a)) {
      const item = entries[index];
      const length = item.content?.length || 0;
      if (selected.length >= 10 || size + length > 8000) continue;
      size += length;
      selected.push({ index, role: item.role, content: item.content });
    }
    return selected
      .sort((a, b) => a.index - b.index)
      .map(({ role, content }) => ({ role, content }));
  }

  async memoryCount(project) {
    return (await this.memoryEntries(project)).length;
  }

  async clearMemory(project) {
    if (this.active)
      throw Error("Tunggu Local AI selesai sebelum menghapus memori.");
    if (this.store) this.store.clearHistory("ollama", project.id);
    else await fs.rm(this.memoryFile(project), { force: true });
    return { ok: true };
  }

  async chat(
    payload,
    signal,
    onDelta = (delta) =>
      this.event("item/agentMessage/delta", {
        delta,
      }),
  ) {
    const response = await this.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        stream: true,
        keep_alive: "5m",
        options: { num_ctx: 8192, ...(payload.options || {}) },
      }),
      signal,
    });
    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .getReader();
    let buffer = "";
    const message = {
      role: "assistant",
      content: "",
      thinking: "",
      tool_calls: [],
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const chunk = JSON.parse(line);
        if (chunk.error) throw Error(chunk.error);
        if (chunk.message?.content) {
          message.content += chunk.message.content;
          onDelta(chunk.message.content);
        }
        if (chunk.message?.thinking) message.thinking += chunk.message.thinking;
        if (chunk.message?.tool_calls?.length)
          message.tool_calls.push(...chunk.message.tool_calls);
      }
    }
    return message;
  }

  guideScope(project) {
    return project?.id || "general";
  }

  guideFile(project) {
    return path.join(this.guideDir, this.guideScope(project) + ".jsonl");
  }

  async guideMessages(project) {
    if (this.store)
      return this.store.history("guide", this.guideScope(project), 200);
    try {
      return (await fs.readFile(this.guideFile(project), "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse)
        .slice(-200);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async guideRemember(project, entry) {
    if (this.store) {
      this.store.addHistory("guide", this.guideScope(project), entry);
      return;
    }
    await fs.mkdir(this.guideDir, { recursive: true });
    await fs.appendFile(
      this.guideFile(project),
      JSON.stringify({ ...entry, time: Date.now() }) + "\n",
      { mode: 0o600 },
    );
  }

  async clearGuide(project) {
    if (this.guideActive?.scope === this.guideScope(project))
      throw Error("Tunggu Forge Guide selesai sebelum menghapus riwayat.");
    if (this.store) this.store.clearHistory("guide", this.guideScope(project));
    else await fs.rm(this.guideFile(project), { force: true });
    return { ok: true };
  }

  async guideTurn(project, text, context = {}, model = DEFAULT_MODEL) {
    if (!this.guideEnabled) throw Error("Buka Forge Guide terlebih dahulu.");
    if (this.guideActive) throw Error("Forge Guide masih menjawab.");
    if (typeof text !== "string" || !text.trim() || text.length > 12000)
      throw Error("Pesan Guide kosong atau terlalu panjang.");
    await this.startServer();
    const tags = await this.request("/api/tags").then((response) =>
      response.json(),
    );
    if (
      !(tags.models || []).some((item) => (item.model || item.name) === model)
    )
      throw Error(`Model ${model} belum terpasang di Ollama.`);
    const controller = new AbortController();
    const scope = this.guideScope(project);
    this.guideActive = { scope, controller, model };
    this.usedModels.add(model);
    this.emit("guide", { scope, kind: "started", model, provider: "ollama" });
    this.guideCompletion = this.runGuide(
      project,
      text.trim(),
      context,
      model,
      controller,
    );
  }

  async runGuide(project, text, context, model, controller) {
    const scope = this.guideScope(project);
    try {
      const history = (await this.guideMessages(project))
        .slice(-16)
        .filter(({ role }) => role === "user" || role === "assistant")
        .map(({ role, text: content }) => ({ role, content }));
      let size = 0;
      const bounded = history
        .slice()
        .reverse()
        .filter((item) => {
          size += item.content?.length || 0;
          return size <= 10000;
        })
        .reverse();
      const response = await this.chat(
        {
          model,
          think: false,
          messages: [
            {
              role: "system",
              content:
                "Anda adalah Forge Guide, pendamping ramah untuk pengguna pemula. Tugas Anda: (1) mengubah ide kasar menjadi prompt yang jelas dan siap disalin ke agent Build, (2) membantu diagnosis kendala teknis dengan langkah kecil dan aman, dan (3) menjelaskan istilah tanpa jargon yang tidak perlu. Bila membuat prompt, berikan blok PROMPT SIAP SALIN yang memuat tujuan, konteks, batasan, hasil yang diharapkan, dan cara verifikasi. Ajukan pertanyaan klarifikasi hanya bila jawabannya benar-benar mengubah solusi. Anda tidak memiliki akses file atau tool dan tidak boleh mengaku sudah mengubah proyek. Percakapan ini terpisah dari agent pembangun aplikasi. Jawab dalam Bahasa Indonesia.",
            },
            {
              role: "system",
              content: `Konteks UI saat ini: proyek ${project?.name || "belum dipilih"}; agent ${context.provider || "belum dipilih"}; model ${context.model || "belum dipilih"}; mode ${context.mode || "belum dipilih"}.`,
            },
            ...bounded,
            { role: "user", content: text + (context.webContext || "") },
          ],
        },
        controller.signal,
        (delta) => this.emit("guide", { scope, kind: "delta", delta }),
      );
      const answer =
        response.content.trim() ||
        "Saya belum mendapat jawaban. Coba kirim ulang dengan sedikit konteks tambahan.";
      await this.guideRemember(project, { role: "user", text });
      if (context.webSources?.length || context.webContext) await this.guideRemember(project, {
        role: "web", text: context.webSources?.length ? `Pencarian web · ${context.webSources.length} sumber` : context.webContext,
        sources: context.webSources || [],
      });
      await this.guideRemember(project, { role: "assistant", text: answer, provider: "ollama", model });
      this.emit("guide", { scope, kind: "completed", message: answer, model, provider: "ollama" });
    } catch (error) {
      this.emit("guide", {
        scope,
        kind: "error",
        message:
          error.name === "AbortError"
            ? "Jawaban Forge Guide dihentikan."
            : error.message,
      });
    } finally {
      this.guideActive = null;
    }
  }

  async stopGuide() {
    this.guideActive?.controller.abort();
  }

  async turn(
    project,
    mode,
    text,
    model = DEFAULT_MODEL,
    media = [],
    rawText = text,
  ) {
    if (!this.selected) throw Error("Pilih Local AI sebelum mengirim pesan.");
    if (this.active) throw Error("Local AI masih bekerja.");
    if (media.some((item) => item.audio))
      throw Error(
        "Qwen3.5 lokal mendukung teks dan gambar, tetapi tidak mendukung audio melalui Ollama. Pilih Gemini Flash/Pro untuk audio; suara tidak akan dibuang.",
      );
    const catalog = await this.catalog(project);
    if (!catalog.models.some((item) => item.id === model))
      throw Error(
        `Model ${model} belum terpasang di Ollama. Jalankan ollama pull ${model}.`,
      );
    const controller = new AbortController();
    this.active = { projectId: project.id, mode, controller, model };
    this.usedModels.add(model);
    this.event("turn/started", { turn: { id: randomUUID() } });
    this.completion = this.runTurn(
      project,
      mode,
      text,
      model,
      media,
      rawText,
      controller,
    );
  }

  async runTurn(project, mode, text, model, media, rawText, controller) {
    const memory = await this.memory(project, rawText);
    const messages = [
      {
        role: "system",
        content:
          `Anda adalah Forge Local AI, asisten coding untuk pemula. Jawab dalam Bahasa Indonesia. Root proyek: ${project.path}. ` +
          (mode === "build"
            ? "Mode Build: periksa proyek, implementasikan permintaan, dan uji seperlunya. Penulisan file dan command selalu meminta izin pengguna."
            : `Mode ${mode}: hanya baca dan jelaskan. Jangan mengubah file atau menjalankan command.`) +
          " Riwayat berikut adalah memori lokal percakapan sebelumnya; perlakukan sebagai konteks yang mungkin sudah usang. Gunakan tools beberapa kali bila perlu.",
      },
      ...memory,
      {
        role: "user",
        content: text,
        ...(media.some((item) => item.images?.length)
          ? {
              images: media.flatMap((item) =>
                (item.images || []).map((image) => image.data),
              ),
            }
          : {}),
      },
    ];
    let answer = "";
    try {
      for (let step = 0; step < 12; step++) {
        const response = await this.chat(
          { model, messages, tools: schemas(mode), think: true },
          controller.signal,
        );
        messages.push(response);
        answer += response.content || "";
        if (!response.tool_calls?.length) break;
        for (const call of response.tool_calls) {
          const name = call.function?.name;
          this.event("item/started", {
            item: { type: "localTool", name },
          });
          let result;
          try {
            result = await this.runTool(
              project,
              mode,
              name,
              call.function?.arguments || {},
            );
          } catch (error) {
            result = "ERROR: " + error.message;
          }
          messages.push({ role: "tool", tool_name: name, content: result });
          this.event("item/completed", {
            item: { type: "localTool", name, result: result.slice(0, 10000) },
          });
        }
        if (step === 11)
          throw Error("Local AI mencapai batas 12 langkah tool.");
      }
      if (!answer.trim())
        answer = "Selesai. Periksa Aktivitas untuk hasil langkah Local AI.";
      await this.remember(project, {
        role: "user",
        content: rawText.slice(0, 40000),
      });
      await this.remember(project, {
        role: "assistant",
        content: answer.slice(0, 60000),
      });
      this.event("item/completed", {
        item: { type: "agentMessage", text: answer },
      });
      this.event("turn/completed", { turn: { status: "completed" } });
    } catch (error) {
      const message =
        error.name === "AbortError" ? "Local AI dihentikan." : error.message;
      this.event("turn/completed", {
        turn: { status: "failed", error: { message } },
      });
    } finally {
      this.active = null;
      for (const [id, approval] of this.approvals) {
        approval.resolve(false);
        this.approvals.delete(id);
        this.emit("approval-resolved", { id });
      }
    }
  }

  async runTool(project, mode, name, args) {
    if (name === "list_files") {
      const files = [];
      const walk = async (dir, depth) => {
        if (depth > 5 || files.length >= 400) return;
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
          if (privateName(entry.name) || entry.isSymbolicLink()) continue;
          const file = path.join(dir, entry.name);
          if (entry.isDirectory()) await walk(file, depth + 1);
          else files.push(path.relative(project.path, file));
        }
      };
      await walk(project.path, 0);
      return files.sort().join("\n").slice(0, 30000);
    }
    if (name === "read_file") {
      const file = await safeFile(project.path, args.file);
      return (await fs.readFile(file, "utf8")).slice(0, 100000);
    }
    if (mode !== "build")
      throw Error("Tool perubahan tidak tersedia dalam Ask/Plan.");
    if (name === "write_file") {
      if (typeof args.content !== "string" || args.content.length > 1_000_000)
        throw Error("Isi file harus berupa teks maksimal 1 MB.");
      const destination = await writableFile(project.path, args.file);
      if (
        !(await this.approve(
          `Local AI ingin menulis ${args.file}.`,
          `Tulis file: ${args.file}`,
        ))
      )
        return "Pengguna menolak penulisan file.";
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, args.content, "utf8");
      return `Berhasil menulis ${args.file} (${Buffer.byteLength(args.content)} byte).`;
    }
    if (name === "run_command") {
      if (
        typeof args.command !== "string" ||
        !args.command.trim() ||
        args.command.length > 2000
      )
        throw Error("Command kosong atau terlalu panjang.");
      if (
        !(await this.approve(
          "Local AI ingin menjalankan command di proyek.",
          args.command,
        ))
      )
        return "Pengguna menolak command.";
      const { stdout, stderr } = await exec("/bin/zsh", ["-lc", args.command], {
        cwd: project.path,
        timeout: 120000,
        maxBuffer: 1_000_000,
        signal: this.active?.controller.signal,
      });
      return `STDOUT:\n${stdout}\nSTDERR:\n${stderr}`.slice(0, 100000);
    }
    throw Error("Tool Local AI tidak dikenal.");
  }

  approve(reason, command) {
    return new Promise((resolve) => {
      const id = "ollama:" + randomUUID();
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

  decide(id, accept) {
    const approval = this.approvals.get(id);
    if (!approval) throw Error("Persetujuan Local AI tidak ditemukan.");
    this.approvals.delete(id);
    approval.resolve(Boolean(accept));
    this.emit("approval-resolved", { id });
  }

  async stop() {
    if (!this.active) return;
    this.active.controller.abort();
    for (const id of [...this.approvals.keys()]) this.decide(id, false);
  }

  async unload(model) {
    if (!model) return;
    try {
      await this.request("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, keep_alive: 0 }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      this.emit("runtime-warning", {
        provider: "ollama",
        message: `Model lokal belum dapat dilepas: ${error.message}`,
      });
    }
    this.usedModels.delete(model);
  }

  async unloadAll() {
    await Promise.all([...this.usedModels].map((model) => this.unload(model)));
  }

  async close() {
    await this.stop();
    await this.stopGuide();
    await this.guideCompletion?.catch(() => {});
    try {
      await this.unloadAll();
    } finally {
      this.stopServer();
    }
  }
}

export { DEFAULT_MODEL };
