import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const cleanList = (value) =>
  Array.isArray(value)
    ? value
        .map((item) => String(item).slice(0, 500))
        .filter(Boolean)
        .slice(0, 30)
    : [];

export class McpManager {
  constructor(store, emit, { spawnImpl = spawn } = {}) {
    this.store = store;
    this.emit = emit;
    this.spawn = spawnImpl;
  }

  list() {
    return this.store.setting("global", "mcp-servers") || [];
  }

  save(input) {
    const existing = this.list().find((item) => item.id === input.id);
    const config = {
      id: existing?.id || randomUUID(),
      name: String(input.name || "")
        .trim()
        .slice(0, 60),
      transport: "stdio",
      command: String(input.command || "")
        .trim()
        .slice(0, 500),
      args: cleanList(input.args),
      scope: input.scope === "project" ? "project" : "global",
      projectId: input.scope === "project" ? String(input.projectId || "") : "",
      enabled: input.enabled !== false,
      trust: input.trust === "approved" ? "approved" : "untrusted",
      capabilities: existing?.capabilities || {
        tools: [],
        resources: [],
        prompts: [],
      },
      updatedAt: Date.now(),
    };
    if (!config.name || !config.command)
      throw Error("Nama dan command MCP wajib diisi.");
    if (/[\n\r\0]/.test(config.command))
      throw Error("Command MCP tidak valid.");
    if (config.scope === "project" && !config.projectId)
      throw Error("Pilih proyek untuk MCP scope Project.");
    const next = this.list().filter((item) => item.id !== config.id);
    next.push(config);
    this.store.setSetting("global", "mcp-servers", next);
    return config;
  }

  remove(id) {
    this.store.setSetting(
      "global",
      "mcp-servers",
      this.list().filter((item) => item.id !== id),
    );
    return { ok: true };
  }

  async test(id, project) {
    const config = this.list().find((item) => item.id === id);
    if (!config || !config.enabled) throw Error("MCP server tidak tersedia.");
    if (config.scope === "project" && config.projectId !== project?.id)
      throw Error("MCP server ini hanya tersedia untuk proyek yang dipilih.");
    this.emit("mcp", {
      serverId: id,
      server: config.name,
      action: "connect",
      status: "started",
    });
    const child = this.spawn(config.command, config.args, {
      cwd: project?.path || process.cwd(),
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    child.on("error", (error) => {
      this.emit("mcp", {
        serverId: id,
        server: config.name,
        action: "connect",
        status: "error",
        message: error.message || String(error),
      });
    });
    child.stdin.on("error", () => {});
    let buffer = "";
    let stderr = "";
    let sequence = 0;
    const pending = new Map();
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve, reject });
        child.stdin.write(
          JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
        );
      });
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let split;
      while ((split = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, split).trim();
        buffer = buffer.slice(split + 1);
        if (!line) continue;
        try {
          const message = JSON.parse(line);
          const request = pending.get(message.id);
          if (!request) continue;
          pending.delete(message.id);
          if (message.error)
            request.reject(Error(message.error.message || "MCP error"));
          else request.resolve(message.result || {});
        } catch {
          /* Ignore non-protocol process output. */
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    const close = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already stopped */
      }
    };
    const withTimeout = (promise) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error(`MCP timeout. ${stderr}`.trim())),
          10000,
        );
        promise.then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (error) => {
            clearTimeout(timer);
            reject(error);
          },
        );
      });
    try {
      await withTimeout(
        send("initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "Forge", version: "0.1.0" },
        }),
      );
      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
          params: {},
        }) + "\n",
      );
      const optional = async (method) => {
        try {
          return await withTimeout(send(method));
        } catch {
          return {};
        }
      };
      const [tools, resources, prompts] = await Promise.all([
        optional("tools/list"),
        optional("resources/list"),
        optional("prompts/list"),
      ]);
      const capabilities = {
        tools: (tools.tools || []).map((item) => ({
          name: item.name,
          description: item.description,
        })),
        resources: (resources.resources || []).map((item) => ({
          name: item.name,
          uri: item.uri,
        })),
        prompts: (prompts.prompts || []).map((item) => ({
          name: item.name,
          description: item.description,
        })),
      };
      const updated = { ...config, capabilities, lastTestedAt: Date.now() };
      this.store.setSetting(
        "global",
        "mcp-servers",
        this.list().map((item) => (item.id === id ? updated : item)),
      );
      this.emit("mcp", {
        serverId: id,
        server: config.name,
        action: "discover",
        status: "completed",
        counts: {
          tools: capabilities.tools.length,
          resources: capabilities.resources.length,
          prompts: capabilities.prompts.length,
        },
      });
      return updated;
    } finally {
      close();
    }
  }
}
