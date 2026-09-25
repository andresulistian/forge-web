import http from "node:http";
import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { Workspace } from "./workspace.mjs";
import { Agents } from "./agents.mjs";
import { Attachments, attachmentPrompt } from "./attachments.mjs";
import { DeployManager } from "./deploy.mjs";
import { GitHubManager } from "./github.mjs";
import { McpManager } from "./mcp.mjs";
import { Guide } from "./guide.mjs";
import { WebResearch, shouldBrowse } from "./web.mjs";
import { BackupManager } from "./backups.mjs";
import { runBrowserTest } from "./browser-tests.mjs";
import { Monitoring } from "./monitoring.mjs";
import { BackendGuide } from "./backend-guide.mjs";
import { BuildTaskManager } from "./build-tasks.mjs";
import { BuildOrchestrator } from "./orchestrator.mjs";
import { KanbanManager } from "./kanban.mjs";
import { ChatSpace } from "./chat-space.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = process.env.FORGE_DATA_DIR || path.join(root, ".forge");
const ws = new Workspace(
  data,
  process.env.FORGE_PROJECTS_DIR || path.join(data, "projects"),
  path.join(root, "templates/starter"),
);
await ws.init();
const token = randomBytes(32).toString("hex");
const clients = new Set();
const buildProjects = new Set();
const activeBuildTasks = new Map();
const agentProgress = new Map();
let activeOrchestration = null;
let preview = null;
let terminal = null;
let busy = false;
let eventId = 0;
const events = [];
const kanban = new KanbanManager(data, emit);
function emit(type, payload) {
  const event = { id: ++eventId, type, payload, time: Date.now() };
  events.push(event);
  if (events.length > 500) events.shift();
  for (const res of clients) res.write(JSON.stringify(event) + "\n");
  if (type === "agent-progress" && payload.projectId) agentProgress.set(payload.projectId, { ...payload, time: event.time });
  if (type === "deploy-completed" && payload.ok && payload.target === "web" && monitoring.status(payload.projectId).config.enabled)
    setTimeout(() => void monitoring.check(payload.projectId).catch(() => {}), 15000).unref();
  if (type === "codex" && payload.method === "turn/completed" && buildProjects.delete(payload.projectId)) {
    const turn = payload.params?.turn || {};
    emit("build-finished", { projectId: payload.projectId, ok: !turn.error && turn.status !== "failed" });
  }
  if (type === "codex" && payload.method === "turn/completed" && activeBuildTasks.has(payload.projectId)) {
    const binding = activeBuildTasks.get(payload.projectId);
    activeBuildTasks.delete(payload.projectId);
    const turn = payload.params?.turn || {};
    if (turn.usage) void kanban.recordUsage(binding.project, binding.kanbanId, turn.usage).catch(() => {});
    const failure = turn.error || (turn.status === "failed" ? Error("Agent gagal menyelesaikan Build.") : null);
    void buildTasks.finish(binding.project, binding.taskId, failure).then((review) =>
      kanban.finish(binding.project, binding.taskId, {
        error: failure?.message, result: binding.result, files: review.files,
      })).catch((error) =>
      emit("build-task-failed", { projectId: payload.projectId, taskId: binding.taskId, error: error.message }));
  }
  if (type === "codex" && payload.method === "item/completed" && payload.params?.item?.type === "agentMessage") {
    const binding = activeBuildTasks.get(payload.projectId);
    if (binding) binding.result = payload.params.item.text || "";
  }
  if (type === "build-usage" && payload.projectId && payload.taskId)
    void kanban.recordUsage(ws.get(payload.projectId), activeOrchestration?.kanbanId || payload.taskId, payload.usage).catch(() => {});
  if (type === "codex" && payload.projectId && payload.method === "usage/reported") {
    const id = activeBuildTasks.get(payload.projectId)?.kanbanId || activeOrchestration?.kanbanId;
    if (id) void kanban.recordUsage(ws.get(payload.projectId), id, payload.params?.usage).catch(() => {});
  }
  if (type === "codex" && payload.projectId) {
    const method = payload.method;
    const item = payload.params?.item || {};
    if (method === "turn/started") {
      const stage = payload.params?.stage || "inspecting-project";
      const label = payload.params?.label || "Inspecting project";
      progress(payload.projectId, stage, label, stage === "waiting-provider" ? 30 : 45);
    }
    if (method === "item/started") {
      const name = String(item.name || item.type || "");
      if (/write|patch|edit/i.test(name)) progress(payload.projectId, "editing-files", "Editing files", 68);
      else if (/command|exec|terminal/i.test(name)) progress(payload.projectId, "running-build", "Running build", 82);
      else progress(payload.projectId, "inspecting-project", "Inspecting project", 52);
    }
    if (method === "item/completed" && /command|exec|terminal/i.test(String(item.name || item.type || "")))
      progress(payload.projectId, "testing", "Testing", 92);
    if (method === "tool/budgetWarning")
      progress(payload.projectId, "finishing", "Finishing work", 96, "active", payload.params?.message || "");
    if (method === "turn/completed") {
      const ok = !payload.params?.turn?.error && payload.params?.turn?.status !== "failed";
      progress(payload.projectId, ok ? "done" : "failed", ok ? "Done" : "Failed", 100, ok ? "completed" : "failed");
    }
  }
  if (type === "orchestration-agent" && payload.projectId) {
    if (payload.status === "active")
      progress(payload.projectId, `agent-${payload.role}`, payload.label, payload.role === "builder" ? 65 : 30, "active", payload.detail || "");
  }
  if (
    type === "codex" &&
    payload.method === "item/completed" &&
    payload.params?.item?.type === "agentMessage" &&
    payload.projectId
  ) {
    ws.chat(ws.get(payload.projectId), {
      role: "assistant",
      text: payload.params.item.text,
      provider: payload.provider,
    }).catch(() => {});
  }
}
function progress(projectId, stage, label, percent, status = "active", detail = "") {
  emit("agent-progress", { projectId, stage, label, percent, status, detail });
}
const codex = new Agents(emit, path.join(data, "runtime"), data, ws.store);
const buildTasks = new BuildTaskManager(ws, emit);
await buildTasks.init();
const orchestrator = new BuildOrchestrator({
  emit,
  store: ws.store,
  credentials: codex.apiProviders.credentials,
});
const guide = new Guide(codex.ollama, codex.apiProviders, emit, codex.bonsai);
const attachments = new Attachments(data);
const deploy = new DeployManager(data, emit, ws.store);
const monitoring = new Monitoring(ws.store, emit);
const backendGuide = new BackendGuide(ws.store);
const github = new GitHubManager(ws.projectsDir, emit);
const mcp = new McpManager(ws.store, emit);
const web = new WebResearch({ emit, captureDir: path.join(data, "web-captures") });
const chatSpace = new ChatSpace(ws.store, codex.apiProviders, attachments, web, emit);
const backups = new BackupManager(ws);
function stopPreview() {
  if (!preview) return;
  try {
    if (process.platform === "win32") preview.child.kill();
    else process.kill(-preview.child.pid, "SIGTERM");
  } catch {
    /* already exited */
  }
  preview = null;
  emit("preview", { url: null });
}
function stopTerminal() {
  if (!terminal) return;
  try {
    if (process.platform === "win32") terminal.child.kill();
    else process.kill(-terminal.child.pid, "SIGTERM");
  } catch {
    /* already exited */
  }
  terminal = null;
}
async function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}
async function body(req) {
  let input = "";
  for await (const chunk of req) {
    input += chunk;
    if (
      input.length > (req.url === "/api/attachments" ? 20_000_000 : 1_000_000)
    )
      throw Error("Permintaan terlalu besar.");
  }
  return input ? JSON.parse(input) : {};
}
function json(res, value, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}
const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host;
    if (!/^127\.0\.0\.1:\d+$/.test(host || ""))
      return json(res, { error: "Invalid host" }, 403);
    const origin = req.headers.origin;
    const allowed = [
      `http://${host}`,
      "http://localhost:1420",
      "http://127.0.0.1:1420",
    ];
    if (origin && !allowed.includes(origin))
      return json(res, { error: "Origin denied" }, 403);
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (req.method === "OPTIONS") {
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type",
      );
      res.setHeader("Access-Control-Allow-Methods", "GET, POST");
      res.writeHead(204);
      return res.end();
    }
    const url = new URL(req.url, `http://${host}`);
    if (!url.pathname.startsWith("/api/")) {
      let f = path.resolve(
        root,
        "dist",
        "." + decodeURIComponent(url.pathname),
      );
      if (!f.startsWith(path.join(root, "dist") + path.sep))
        f = path.join(root, "dist/index.html");
      try {
        if ((await fs.stat(f)).isDirectory()) f = path.join(f, "index.html");
      } catch {
        f = path.join(root, "dist/index.html");
      }
      res.setHeader(
        "Content-Type",
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
        }[path.extname(f)] || "application/octet-stream",
      );
      return res.end(await fs.readFile(f));
    }
    if (req.headers.authorization !== `Bearer ${token}`)
      return json(
        res,
        { error: "Sesi tidak valid. Buka URL lengkap dari terminal." },
        401,
      );
    if (url.pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      });
      for (const e of events.filter(
        (e) => e.id > Number(url.searchParams.get("after") || 0),
      ))
        res.write(JSON.stringify(e) + "\n");
      clients.add(res);
      const heartbeat = setInterval(() => res.write("\n"), 15000);
      req.on("close", () => {
        clients.delete(res);
        clearInterval(heartbeat);
      });
      return;
    }
    if (url.pathname === "/api/state")
      return json(res, {
        eventId,
        projects: ws.projects,
        projectsDir: ws.projectsDir,
        active: codex.active || activeOrchestration,
        approvals: [...codex.approvals.values()],
        deployment: deploy.active
          ? {
              projectId: deploy.active.projectId,
              target: deploy.active.target,
              operation: deploy.active.operation,
            }
          : null,
        preview: preview
          ? { url: preview.url, projectId: preview.projectId }
          : null,
        progress: Object.fromEntries(agentProgress),
      });
    if (url.pathname === "/api/runtime") {
      const provider = url.searchParams.get("provider") || "codex";
      const projectId = url.searchParams.get("projectId");
      return json(
        res,
        await codex.catalog(provider, projectId ? ws.get(projectId) : null),
      );
    }
    if (url.pathname === "/api/usage") {
      const provider = url.searchParams.get("provider");
      if (provider === "codex") {
        try { return json(res, { provider, windows: await codex.codex.rateLimits() }); }
        catch { return json(res, { provider, windows: [], available: false }); }
      }
      if (provider === "gemini")
        return json(res, { provider, context: codex.gemini.contextUsage(url.searchParams.get("projectId")) });
      return json(res, { error: "Provider usage tidak didukung." }, 400);
    }
    const b =
      req.method === "POST"
        ? await body(req)
        : Object.fromEntries(url.searchParams);
    const p = b.projectId ? ws.get(b.projectId) : null;
    if (req.method === "GET") {
      if (url.pathname === "/api/chat-space/threads") return json(res, chatSpace.list());
      if (url.pathname === "/api/chat-space/messages") return json(res, chatSpace.messages(String(b.threadId || "")));
      if (url.pathname === "/api/files") return json(res, await ws.files(p));
      if (url.pathname === "/api/file")
        return json(res, { text: await ws.read(p, b.file) });
      if (url.pathname === "/api/history")
        return json(res, await ws.history(p));
      if (url.pathname === "/api/messages")
        return json(res, await ws.messages(p));
      if (url.pathname === "/api/guide/messages")
        return json(res, await codex.ollama.guideMessages(p));
      if (url.pathname === "/api/backups")
        return json(res, await backups.list());
      if (url.pathname === "/api/browser/report")
        return json(res, ws.store.setting("browser-report", p.id) || null);
      if (url.pathname === "/api/deploy/inspect")
        return json(res, await deploy.inspect(p));
      if (url.pathname === "/api/deploy/security")
        return json(res, await deploy.security(p, b.target || "web"));
      if (url.pathname === "/api/deploy/releases")
        return json(res, await deploy.releaseHistory(p, b.target || "web"));
      if (url.pathname === "/api/monitor") return json(res, monitoring.status(p.id));
      if (url.pathname === "/api/backend/guide") return json(res, await backendGuide.inspect(p, await deploy.config(p)));
      if (url.pathname === "/api/integrations")
        return json(res, {
          providers: codex.apiProviders.configs(),
          github: await github.projectStatus(p),
          mcp: mcp.list(),
          web: await web.status(),
        });
      if (url.pathname === "/api/build/tasks")
        return json(res, await buildTasks.list(p));
      if (url.pathname === "/api/kanban") return json(res, await kanban.list(p));
      if (url.pathname === "/api/build/review")
        return json(res, await buildTasks.review(p, b.taskId));
      if (url.pathname === "/api/build/diff")
        return json(res, await buildTasks.diff(p, b.taskId, b.file));
    }
    if (req.method !== "POST") return json(res, { error: "Not found" }, 404);
    if (url.pathname === "/api/chat-space/create") return json(res, chatSpace.create());
    if (url.pathname === "/api/chat-space/delete") return json(res, chatSpace.delete(String(b.threadId || "")));
    if (url.pathname === "/api/chat-space/stop") return json(res, chatSpace.stop(String(b.threadId || "")));
    if (url.pathname === "/api/chat-space/send") return json(res, await chatSpace.send(b));
    if (url.pathname === "/api/approve") {
      if (typeof b.accept !== "boolean") throw Error("Invalid approval");
      if (!orchestrator.decide(b.id, b.accept)) codex.decide(b.id, b.accept);
      return json(res, { ok: true });
    }
    if (url.pathname === "/api/projects/clear") {
      if (b.confirmed !== true || b.confirmationText !== "HAPUS WORKSPACE")
        throw Error("Ketik HAPUS WORKSPACE dengan tepat untuk mengonfirmasi penghapusan.");
      if (codex.active || activeOrchestration || guide.active || codex.ollama.guideActive || codex.bonsai.guideActive || deploy.active || busy || terminal)
        throw Error("Hentikan agent, terminal, dan deploy sebelum menghapus Workspace.");
      if ((await Promise.all(ws.projects.map((project) => buildTasks.list(project)))).flat().some((task) => ["active", "review", "failed"].includes(task.status)))
        throw Error("Terapkan atau buang hasil Build yang tertunda sebelum menghapus Workspace.");
      if (preview) stopPreview();
      busy = true;
      try {
        const clearingProjects = [...ws.projects];
        const result = await ws.clear(b.deleteFiles === true);
        await Promise.all(clearingProjects.map((project) => buildTasks.forget(project)));
        await Promise.all(clearingProjects.map((project) => kanban.forget(project)));
        emit("workspace-cleared", { count: result.count, deletedFiles: result.deletedFiles });
        return json(res, result);
      } finally { busy = false; }
    }
    if (url.pathname === "/api/stop") {
      if (activeOrchestration) await orchestrator.stop(activeOrchestration.taskId);
      await codex.stop();
      stopTerminal();
      return json(res, { ok: true });
    }
    if (url.pathname === "/api/guide/open")
      return json(res, await guide.open(String(b.provider || "ollama")));
    if (url.pathname === "/api/guide/close")
      return json(res, await guide.close());
    if (url.pathname === "/api/guide/chat") {
      if (typeof b.text !== "string" || !b.text.trim() || b.text.length > 12000)
        throw Error("Pesan Guide kosong atau terlalu panjang.");
      if (!guide.enabled) throw Error("Buka Forge Guide terlebih dahulu.");
      if (guide.active || codex.ollama.guideActive || codex.bonsai.guideActive)
        throw Error("Forge Guide masih menjawab.");
      const result = await web.prepare(b.text, b.webMode || "auto", { projectId: p?.id });
      return json(res, await guide.chat(p, b.text, String(b.guideProvider || "ollama"), String(b.guideModel || ""), {
        provider: String(b.provider || "").slice(0, 40),
        model: String(b.model || "").slice(0, 100),
        mode: String(b.mode || "").slice(0, 20),
        webContext: result?.context || result?.notice || "",
        webSources: result?.sources || [],
      }));
    }
    if (url.pathname === "/api/guide/clear")
      return json(res, await guide.clear(p));
    if (url.pathname === "/api/deploy/config") {
      if (deploy.active || busy) throw Error("Tunggu operasi selesai sebelum mengubah pengaturan deploy.");
      return json(res, await deploy.save(p, b.config));
    }
    if (url.pathname === "/api/monitor/config") return json(res, monitoring.save(p.id, b.config));
    if (url.pathname === "/api/monitor/check") return json(res, await monitoring.check(p.id));
    if (url.pathname === "/api/backend/guide") return json(res, await backendGuide.save(p, b.config, await deploy.config(p)));
    if (url.pathname === "/api/deploy/run") {
      if (b.confirmed !== true)
        throw Error("Deploy memerlukan persetujuan terakhir.");
      if (codex.active) throw Error("Tunggu agent selesai sebelum deploy.");
      if (deploy.active || busy) throw Error("Tunggu operasi lain selesai sebelum deploy.");
      await ws.checkpoint(
        p,
        `Otomatis sebelum deploy ${String(b.target || "").slice(0, 20)}`,
      );
      return json(res, deploy.run(p, b.target, b.operation));
    }
    if (url.pathname === "/api/deploy/stop")
      return json(res, deploy.stop(p.id));
    if (url.pathname === "/api/deploy/rollback") {
      if (b.confirmed !== true) throw Error("Rollback rilis online memerlukan konfirmasi.");
      if (codex.active || busy || deploy.active) throw Error("Tunggu operasi lain selesai sebelum rollback.");
      busy = true;
      try { return json(res, await deploy.rollback(p, b.id)); }
      finally { busy = false; }
    }
    if (url.pathname === "/api/projects/delete") {
      if (b.confirmed !== true || b.confirmationName !== p.name)
        throw Error("Ketik nama proyek dengan tepat untuk mengonfirmasi penghapusan.");
      if (codex.active || activeOrchestration || guide.active || codex.ollama.guideActive || codex.bonsai.guideActive || deploy.active || busy || terminal?.projectId === p.id)
        throw Error("Hentikan agent, terminal, dan deploy proyek ini sebelum menghapusnya.");
      if ((await buildTasks.list(p)).some((task) => ["active", "review", "failed"].includes(task.status)))
        throw Error("Terapkan atau buang hasil Build yang tertunda sebelum menghapus proyek.");
      if (preview?.projectId === p.id) stopPreview();
      busy = true;
      try {
        const result = await ws.remove(p, b.deleteFiles === true);
        await buildTasks.forget(p);
        await kanban.forget(p);
        emit("project-deleted", { projectId: p.id, deletedFiles: result.deletedFiles });
        return json(res, result);
      } finally { busy = false; }
    }
    if (deploy.active && deploy.active.projectId === p?.id)
      throw Error(
        "Tunggu deploy selesai atau hentikan deploy terlebih dahulu.",
      );
    if (busy) throw Error("Operasi lain masih berlangsung.");
    busy = true;
    try {
      switch (url.pathname) {
        case "/api/kanban/create": return json(res, await kanban.create(p, b.request, b.mode));
        case "/api/kanban/move": return json(res, await kanban.move(p, b.taskId, b.column));
        case "/api/kanban/pricing": return json(res, await kanban.price(p, b.taskId, b.inputPerMillion, b.outputPerMillion));
        case "/api/kanban/verify": {
          if (codex.active || activeOrchestration || deploy.active)
            throw Error("Tunggu agent dan deploy selesai sebelum regression checks.");
          const { task } = await kanban.get(p, b.taskId);
          if ((await buildTasks.get(p, task.buildTaskId)).status !== "applied")
            throw Error("Terapkan semua perubahan di tab Review sebelum Done.");
          return json(res, await kanban.verify(p, b.taskId));
        }
        case "/api/build/apply": {
          if (b.confirmed !== true) throw Error("Menerapkan hasil Build memerlukan konfirmasi.");
          if (codex.active || activeOrchestration || deploy.active)
            throw Error("Tunggu agent dan deploy selesai sebelum menerapkan hasil Build.");
          return json(res, await buildTasks.apply(p, b.taskId, b.files ?? null));
        }
        case "/api/build/discard": {
          if (b.confirmed !== true) throw Error("Membuang hasil Build memerlukan konfirmasi.");
          if (codex.active || activeOrchestration || deploy.active)
            throw Error("Tunggu agent dan deploy selesai sebelum membuang hasil Build.");
          const discarded = await buildTasks.discard(p, b.taskId);
          await kanban.finish(p, b.taskId, { error: "Hasil Build dibuang." });
          return json(res, discarded);
        }
        case "/api/browser/run": {
          if (codex.active) throw Error("Tunggu agent selesai sebelum menguji browser.");
          if (!preview || preview.projectId !== p.id)
            throw Error("Jalankan Preview proyek ini terlebih dahulu.");
          const result = await runBrowserTest(preview.url, b.steps || []);
          ws.store.setSetting("browser-report", p.id, result);
          emit("browser-result", { projectId: p.id, ok: result.ok, failed: result.checks.filter((c) => !c.ok).length, findings: result.findings.length });
          return json(res, result);
        }
        case "/api/backups/create":
          if (codex.active || guide.active || codex.ollama.guideActive || codex.bonsai.guideActive || deploy.active)
            throw Error("Tunggu agent dan deploy selesai sebelum membuat backup.");
          return json(res, await backups.create());
        case "/api/backups/restore": {
          if (b.confirmed !== true) throw Error("Pemulihan perlu konfirmasi.");
          if (codex.active || guide.active || codex.ollama.guideActive || codex.bonsai.guideActive || deploy.active)
            throw Error("Tunggu agent dan deploy selesai sebelum pemulihan.");
          await guide.close();
          stopPreview();
          stopTerminal();
          const result = await backups.restore(b.id);
          emit("backup-restored", { count: result.projects.length });
          return json(res, result);
        }
        case "/api/attachments":
          return json(res, await attachments.add(b.scope === "chat" && !b.projectId ? { id: "chat" } : p, b.item));
        case "/api/gemini/login":
          if (codex.active) throw Error("Tunggu agent selesai sebelum login.");
          return json(res, await codex.gemini.login());
        case "/api/runtime/select":
          if (codex.active)
            throw Error("Tunggu agent selesai sebelum mengganti AI.");
          await codex.ollama.select(b.provider === "ollama", b.provider === "ollama" ? b.model || "" : "");
          return json(res, await codex.bonsai.select(b.provider === "bonsai", b.provider === "bonsai" ? b.model || "" : ""));
        case "/api/ollama/memory/clear":
          return json(res, await codex.ollama.clearMemory(p));
        case "/api/bonsai/memory/clear":
          return json(res, await codex.bonsai.clearMemory(p));
        case "/api/projects/create":
          return json(res, await ws.create(b.name));
        case "/api/projects/open":
          return json(res, await ws.open(b.path));
        case "/api/provider/save":
          return json(res, await codex.apiProviders.save(b));
        case "/api/provider/delete":
          return json(res, await codex.apiProviders.remove(String(b.id || "")));
        case "/api/provider/test":
          return json(res, await codex.apiProviders.test(String(b.id || "")));
        case "/api/provider/discover":
          return json(res, await codex.apiProviders.discover(b));
        case "/api/web/save":
          return json(res, await web.save(b.apiKey));
        case "/api/web/remove":
          return json(res, await web.remove());
        case "/api/web/test":
          return json(res, await web.prepare("Forge web search test", "web"));
        case "/api/github/import": {
          if (b.confirmed !== true)
            throw Error("Import GitHub memerlukan persetujuan.");
          const directory = await github.clone(
            String(b.repository || "").trim(),
            String(b.branch || "").trim(),
          );
          return json(res, await ws.open(directory));
        }
        case "/api/github/backup":
          if (b.confirmed !== true)
            throw Error("Backup GitHub memerlukan persetujuan.");
          return json(res, await github.backup(p, b));
        case "/api/github/pull":
          if (b.confirmed !== true) throw Error("Sync / Pull memerlukan konfirmasi.");
          if (!p) throw Error("Pilih proyek sebelum Sync / Pull.");
          if (codex.active) throw Error("Tunggu agent selesai sebelum Sync / Pull.");
          return json(res, await github.pull(p));
        case "/api/mcp/save":
          return json(res, mcp.save(b));
        case "/api/mcp/delete":
          return json(res, mcp.remove(String(b.id || "")));
        case "/api/mcp/test":
          if (b.confirmed !== true)
            throw Error("Menjalankan MCP server memerlukan persetujuan.");
          return json(res, await mcp.test(String(b.id || ""), p));
        case "/api/terminal/run": {
          if (b.confirmed !== true)
            throw Error("Command terminal memerlukan persetujuan.");
          if (!p) throw Error("Pilih proyek terlebih dahulu.");
          const command = String(b.command || "").trim();
          if (!command || command.length > 2000 || /[\0\r\n]/.test(command))
            throw Error("Command terminal kosong atau tidak valid.");
          if (codex.active || terminal)
            throw Error("Tunggu agent atau command lain selesai.");
          emit("terminal-started", { projectId: p.id, command });
          const shell =
            process.platform === "win32"
              ? {
                  file: process.env.ComSpec || "cmd.exe",
                  args: ["/d", "/s", "/c", command],
                }
              : {
                  file: process.env.SHELL || "/bin/sh",
                  args: ["-lc", command],
                };
          const child = spawn(shell.file, shell.args, {
            cwd: p.path,
            env: { ...process.env, FORCE_COLOR: "0" },
            detached: process.platform !== "win32",
            stdio: ["ignore", "pipe", "pipe"],
          });
          terminal = { child, projectId: p.id, command };
          let output = "";
          for (const [name, stream] of [
            ["stdout", child.stdout],
            ["stderr", child.stderr],
          ])
            stream.on("data", (chunk) => {
              const text = chunk.toString().slice(0, 20000);
              output = (output + text).slice(-1_000_000);
              emit("terminal-output", {
                projectId: p.id,
                stream: name,
                text,
              });
            });
          const result = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              stopTerminal();
              reject(Error("Command dihentikan setelah 5 menit."));
            }, 300000);
            child.once("error", (error) => {
              clearTimeout(timeout);
              reject(error);
            });
            child.once("exit", (code, signal) => {
              clearTimeout(timeout);
              resolve({ code, signal });
            });
          });
          terminal = null;
          const ok = result.code === 0;
          emit("terminal-completed", {
            projectId: p.id,
            command,
            ...result,
            ok,
          });
          if (!ok)
            throw Error(
              `Command gagal (exit ${result.code ?? result.signal}). ${output.slice(-1200)}`,
            );
          return json(res, { ok: true, ...result });
        }
        case "/api/checkpoint":
          if (codex.active) throw Error("Hentikan agent sebelum checkpoint.");
          return json(res, await ws.checkpoint(p));
        case "/api/file/save": {
          if (codex.active)
            throw Error("Tunggu agent selesai sebelum menyimpan kode manual.");
          const result = await ws.write(p, b.file, b.text, b.expected);
          emit("manual-edit", {
            projectId: p.id,
            file: b.file,
            changed: result.changed,
          });
          return json(res, result);
        }
        case "/api/restore":
          if (codex.active) throw Error("Hentikan agent sebelum restore.");
          if (b.confirmed !== true) throw Error("Restore perlu konfirmasi.");
          stopPreview();
          return json(res, await ws.restore(p, b.id));
        case "/api/chat": {
          if (
            typeof b.text !== "string" ||
            !b.text.trim() ||
            b.text.length > 40000
          )
            throw Error("Pesan kosong atau terlalu panjang.");
          if (codex.active || activeOrchestration) throw Error("Agent masih bekerja.");
          if (!["ask", "plan", "build"].includes(b.mode))
            throw Error("Mode tidak valid.");
          const media = await attachments.resolve(p, b.attachments || []);
          const provider = b.provider || "codex";
          const useTeam = b.mode === "build" && b.multiAgent === true &&
            (provider === "codex" || String(provider).startsWith("api:"));
          const enrichedText =
            b.text + (media.length ? "\n\n" + attachmentPrompt(media) : "");
          let runProject = p;
          let buildBinding = null;
          let kanbanRun = null;
          if (b.mode === "build") {
            const pending = (await buildTasks.list(p)).find((task) =>
              ["active", "review", "failed"].includes(task.status),
            );
            if (pending)
              throw Error("Masih ada hasil Build yang perlu diterapkan atau dibuang di tab Review.");
            const boardTask = b.kanbanTaskId
              ? (await kanban.get(p, b.kanbanTaskId)).task
              : await kanban.create(p, b.text, b.orchestrationMode || "balanced");
            if (boardTask.buildTaskId) throw Error("Task Kanban ini sudah memiliki Build.");
            if (boardTask.request !== b.text.trim())
              throw Error("Isi task Kanban berbeda dari pesan Build.");
            const started = await buildTasks.start(p, {
              provider: b.provider || "codex",
              model: b.model,
            });
            runProject = started.project;
            buildBinding = { taskId: started.task.id, project: p };
            kanbanRun = await kanban.start(p, boardTask.id, started.task.id, {
              provider, model: b.model, enabled: useTeam,
            });
            buildBinding.kanbanId = boardTask.id;
            emit("checkpoint", { projectId: p.id, taskId: started.task.id });
          }
          await ws.chat(p, {
            role: "user",
            text: b.text,
            mode: b.mode,
            provider: b.provider || "codex",
            model: b.model,
            attachments: media.map(
              ({ images: _images, audio: _audio, text: _text, ...meta }) =>
                meta,
            ),
          });
          try {
            progress(p.id, "analyzing-request", "Analyzing request", 8);
            if (b.mode === "build" && !useTeam) buildProjects.add(p.id);
            if (b.webMode === "web" || ((b.webMode || "auto") === "auto" && shouldBrowse(b.text)))
              emit("web-research", { projectId: p.id, status: "started", preference: b.webMode || "auto" });
            const research = await web.prepare(b.text, b.webMode || "auto", { projectId: p.id });
            if (research) {
              await ws.chat(p, {
                role: "web",
                text: research.notice || `Pencarian web · ${research.sources.length} sumber`,
                sources: research.sources,
                checkedAt: research.checkedAt,
              });
              emit("web-research", { projectId: p.id, status: "completed", count: research.sources.length });
            }
            if (useTeam) {
              activeOrchestration = { projectId: p.id, taskId: buildBinding.taskId, kanbanId: kanbanRun.task.id };
              const result = await orchestrator.run({
                taskId: buildBinding.taskId,
                project: runProject,
                request: enrichedText,
                provider,
                model: b.model,
                media,
                webContext: research?.context || research?.notice || "",
                strategy: kanbanRun.task.routing,
                context: kanbanRun.context,
              });
              if (result.builder?.text)
                await ws.chat(p, {
                  role: "assistant",
                  text: result.builder.text,
                  provider,
                  model: b.model,
                });
              const review = await buildTasks.finish(p, buildBinding.taskId);
              await kanban.finish(p, buildBinding.taskId, { result: result.builder?.text, files: review.files });
              progress(p.id, "done", "Done", 100, "completed");
            } else {
              if (buildBinding) activeBuildTasks.set(p.id, buildBinding);
              await codex.turn(
                runProject,
                b.mode,
                enrichedText + (kanbanRun ? `\n\nRelevant project context (bounded):\n${kanbanRun.context}` : ""),
                b.provider || "codex",
                b.model,
                media,
                b.text,
                research?.context || research?.notice || "",
              );
            }
          } catch (e) {
            buildProjects.delete(p.id);
            activeBuildTasks.delete(p.id);
            if (buildBinding)
              await buildTasks.finish(p, buildBinding.taskId, e).then((review) =>
                kanban.finish(p, buildBinding.taskId, { error: e.message, files: review.files })).catch(() => {});
            progress(p.id, "failed", "Failed", 100, "failed", e.message);
            await ws.chat(p, { role: "system", text: e.message });
            throw e;
          } finally {
            if (activeOrchestration?.projectId === p.id) activeOrchestration = null;
          }
          return json(res, { ok: true });
        }
        case "/api/preview/inspect": {
          const pkg = JSON.parse(
            await fs.readFile(path.join(p.path, "package.json"), "utf8"),
          );
          if (!pkg.scripts?.dev)
            throw Error("Proyek perlu script npm run dev.");
          return json(res, { script: pkg.scripts.dev });
        }
        case "/api/preview/start": {
          if (b.confirmed !== true)
            throw Error("Menjalankan kode proyek perlu persetujuan.");
          stopPreview();
          const port = await freePort();
          const child = spawn(
            process.platform === "win32" ? "npm.cmd" : "npm",
            ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port)],
            {
              cwd: p.path,
              env: { ...process.env, PORT: String(port) },
              detached: process.platform !== "win32",
              stdio: ["ignore", "pipe", "pipe"],
            },
          );
          const url = `http://127.0.0.1:${port}`;
          preview = { child, url, projectId: p.id };
          for (const stream of [child.stdout, child.stderr])
            stream.on("data", (c) =>
              emit("preview-log", {
                projectId: p.id,
                text: c.toString().slice(0, 10000),
              }),
            );
          child.on("error", (e) => {
            emit("runtime-warning", { message: e.message });
            if (preview?.child === child) preview = null;
          });
          child.on("exit", () => {
            if (preview?.child === child) {
              preview = null;
              emit("preview", { url: null });
            }
          });
          let ready = false;
          for (let i = 0; i < 80; i++) {
            if (child.exitCode !== null) break;
            try {
              const r = await fetch(url, { signal: AbortSignal.timeout(300) });
              await r.body?.cancel();
              ready = true;
              break;
            } catch {
              await new Promise((r) => setTimeout(r, 200));
            }
          }
          if (!ready) {
            stopPreview();
            throw Error(
              "Preview belum siap. Periksa log; jalankan npm install melalui Build jika dependensi belum terpasang.",
            );
          }
          emit("preview", { url, projectId: p.id });
          return json(res, { url });
        }
        case "/api/preview/stop":
          stopPreview();
          return json(res, { ok: true });
        default:
          return json(res, { error: "Not found" }, 404);
      }
    } finally {
      busy = false;
    }
  } catch (e) {
    json(res, { error: e.message }, 400);
  }
});
server.listen(Number(process.env.FORGE_PORT || 0), "127.0.0.1", () => {
  const url = `http://127.0.0.1:${server.address().port}`;
  console.log(JSON.stringify({ url, token }));
  if (!process.env.FORGE_DESKTOP)
    console.error(`\nForge siap: ${url}/#token=${token}\n`);
  void backups.ensureDaily().catch((error) => console.error(`Backup otomatis gagal: ${error.message}`));
  void monitoring.tick();
});
const monitoringTimer = setInterval(() => void monitoring.tick(), 60000);
monitoringTimer.unref();
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(monitoringTimer);
  stopPreview();
  stopTerminal();
  if (deploy.active)
    try {
      deploy.stop(deploy.active.projectId);
    } catch {
      /* already stopped */
    }
  await codex.close();
  ws.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
if (process.env.FORGE_DESKTOP) {
  process.stdin.resume();
  process.stdin.on("end", shutdown);
}
