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
import { Skills } from "./skills.mjs";
import { ProjectMemory } from "./project-memory.mjs";
import { ActivityCenter } from "./activity.mjs";
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
const multiAgentProjects = new Set();
let preview = null;
let terminal = null;
let busy = false;
let eventId = 0;
const events = [];
let activity = null;
function emit(type, payload) {
  const event = { id: ++eventId, type, payload, time: Date.now() };
  events.push(event);
  if (events.length > 500) events.shift();
  for (const res of clients) res.write(JSON.stringify(event) + "\n");
  if (activity && payload?.projectId) {
    let project = null;
    try {
      project = ws.get(payload.projectId);
    } catch {
      /* Project may have been removed while a late event was in flight. */
    }
    void activity.observe(type, payload, project).catch(() => {});
  }
  if (
    type === "deploy-completed" &&
    payload.ok &&
    payload.target === "web" &&
    monitoring.status(payload.projectId).config.enabled
  )
    setTimeout(
      () => void monitoring.check(payload.projectId).catch(() => {}),
      15000,
    ).unref();
  if (
    type === "codex" &&
    payload.method === "turn/completed" &&
    buildProjects.delete(payload.projectId)
  )
    emit("build-finished", {
      projectId: payload.projectId,
      ok: payload.params?.turn?.status === "completed",
    });
  if (
    type === "codex" &&
    payload.method === "turn/completed" &&
    multiAgentProjects.delete(payload.projectId)
  )
    emit("agent-team", {
      projectId: payload.projectId,
      role: "lead",
      status: payload.params?.turn?.error ? "failed" : "completed",
      detail: payload.params?.turn?.error
        ? payload.params.turn.error.message
        : "Multi-agent selesai",
    });
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
const codex = new Agents(emit, path.join(data, "runtime"), data, ws.store);
const guide = new Guide(codex.ollama, codex.apiProviders, emit, codex.bonsai);
const attachments = new Attachments(data);
const deploy = new DeployManager(data, emit, ws.store);
const monitoring = new Monitoring(ws.store, emit);
const backendGuide = new BackendGuide(ws.store);
const github = new GitHubManager(ws.projectsDir, emit);
const mcp = new McpManager(ws.store, emit);
const web = new WebResearch();
const backups = new BackupManager(ws);
const skills = new Skills(ws.store);
const projectMemory = new ProjectMemory(ws.store);
activity = new ActivityCenter(ws.store, ws);
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
      input.length > (req.url === "/api/attachments" ? 30_000_000 : 1_000_000)
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
        active: codex.active,
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
        try {
          return json(res, {
            provider,
            windows: await codex.codex.rateLimits(),
          });
        } catch {
          return json(res, { provider, windows: [], available: false });
        }
      }
      if (provider === "gemini")
        return json(res, {
          provider,
          context: codex.gemini.contextUsage(url.searchParams.get("projectId")),
        });
      return json(res, { error: "Provider usage tidak didukung." }, 400);
    }
    const b =
      req.method === "POST"
        ? await body(req)
        : Object.fromEntries(url.searchParams);
    const p = b.projectId ? ws.get(b.projectId) : null;
    if (req.method === "GET") {
      if (url.pathname === "/api/files") return json(res, await ws.files(p));
      if (url.pathname === "/api/file")
        return json(res, { text: await ws.read(p, b.file) });
      if (url.pathname === "/api/history")
        return json(res, await ws.history(p));
      if (url.pathname === "/api/messages")
        return json(res, await ws.messages(p));
      if (url.pathname === "/api/agent-center") {
        let memory = projectMemory.get(p.id);
        if (!memory.updatedAt) memory = await projectMemory.refresh(p);
        return json(res, {
          ...activity.view(p.id),
          memory,
          skills: skills.list(p.id).map(({ prompt: _prompt, ...skill }) => skill),
        });
      }
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
      if (url.pathname === "/api/monitor")
        return json(res, monitoring.status(p.id));
      if (url.pathname === "/api/backend/guide")
        return json(res, await backendGuide.inspect(p, await deploy.config(p)));
      if (url.pathname === "/api/integrations")
        return json(res, {
          providers: codex.apiProviders.configs(),
          github: await github.projectStatus(p),
          mcp: mcp.list(),
          web: await web.status(),
        });
    }
    if (req.method !== "POST") return json(res, { error: "Not found" }, 404);
    if (url.pathname === "/api/approve") {
      if (typeof b.accept !== "boolean") throw Error("Invalid approval");
      codex.decide(b.id, b.accept);
      return json(res, { ok: true });
    }
    if (url.pathname === "/api/projects/clear") {
      if (b.confirmed !== true || b.confirmationText !== "HAPUS WORKSPACE")
        throw Error(
          "Ketik HAPUS WORKSPACE dengan tepat untuk mengonfirmasi penghapusan.",
        );
      if (
        codex.active ||
        guide.active ||
        codex.ollama.guideActive ||
        codex.bonsai.guideActive ||
        deploy.active ||
        busy ||
        terminal
      )
        throw Error(
          "Hentikan agent, terminal, dan deploy sebelum menghapus Workspace.",
        );
      if (preview) stopPreview();
      busy = true;
      try {
        const result = await ws.clear(b.deleteFiles === true);
        emit("workspace-cleared", {
          count: result.count,
          deletedFiles: result.deletedFiles,
        });
        return json(res, result);
      } finally {
        busy = false;
      }
    }
    if (url.pathname === "/api/stop") {
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
      const result = await web.prepare(b.text, b.webMode || "auto");
      return json(
        res,
        await guide.chat(
          p,
          b.text,
          String(b.guideProvider || "ollama"),
          String(b.guideModel || ""),
          {
            provider: String(b.provider || "").slice(0, 40),
            model: String(b.model || "").slice(0, 100),
            mode: String(b.mode || "").slice(0, 20),
            webContext: result?.context || result?.notice || "",
            webSources: result?.sources || [],
          },
        ),
      );
    }
    if (url.pathname === "/api/guide/clear")
      return json(res, await guide.clear(p));
    if (url.pathname === "/api/deploy/config") {
      if (deploy.active || busy)
        throw Error(
          "Tunggu operasi selesai sebelum mengubah pengaturan deploy.",
        );
      return json(res, await deploy.save(p, b.config));
    }
    if (url.pathname === "/api/monitor/config")
      return json(res, monitoring.save(p.id, b.config));
    if (url.pathname === "/api/monitor/check")
      return json(res, await monitoring.check(p.id));
    if (url.pathname === "/api/backend/guide")
      return json(
        res,
        await backendGuide.save(p, b.config, await deploy.config(p)),
      );
    if (url.pathname === "/api/deploy/run") {
      if (b.confirmed !== true)
        throw Error("Deploy memerlukan persetujuan terakhir.");
      if (codex.active) throw Error("Tunggu agent selesai sebelum deploy.");
      if (deploy.active || busy)
        throw Error("Tunggu operasi lain selesai sebelum deploy.");
      await ws.checkpoint(
        p,
        `Otomatis sebelum deploy ${String(b.target || "").slice(0, 20)}`,
      );
      return json(res, deploy.run(p, b.target, b.operation));
    }
    if (url.pathname === "/api/deploy/stop")
      return json(res, deploy.stop(p.id));
    if (url.pathname === "/api/deploy/rollback") {
      if (b.confirmed !== true)
        throw Error("Rollback rilis online memerlukan konfirmasi.");
      if (codex.active || busy || deploy.active)
        throw Error("Tunggu operasi lain selesai sebelum rollback.");
      busy = true;
      try {
        return json(res, await deploy.rollback(p, b.id));
      } finally {
        busy = false;
      }
    }
    if (url.pathname === "/api/projects/delete") {
      if (b.confirmed !== true || b.confirmationName !== p.name)
        throw Error(
          "Ketik nama proyek dengan tepat untuk mengonfirmasi penghapusan.",
        );
      if (
        codex.active ||
        guide.active ||
        codex.ollama.guideActive ||
        codex.bonsai.guideActive ||
        deploy.active ||
        busy ||
        terminal?.projectId === p.id
      )
        throw Error(
          "Hentikan agent, terminal, dan deploy proyek ini sebelum menghapusnya.",
        );
      if (preview?.projectId === p.id) stopPreview();
      busy = true;
      try {
        const result = await ws.remove(p, b.deleteFiles === true);
        emit("project-deleted", {
          projectId: p.id,
          deletedFiles: result.deletedFiles,
        });
        return json(res, result);
      } finally {
        busy = false;
      }
    }
    if (deploy.active && deploy.active.projectId === p?.id)
      throw Error(
        "Tunggu deploy selesai atau hentikan deploy terlebih dahulu.",
      );
    if (busy) throw Error("Operasi lain masih berlangsung.");
    busy = true;
    try {
      switch (url.pathname) {
        case "/api/browser/run": {
          if (codex.active)
            throw Error("Tunggu agent selesai sebelum menguji browser.");
          if (!preview || preview.projectId !== p.id)
            throw Error("Jalankan Preview proyek ini terlebih dahulu.");
          const result = await runBrowserTest(preview.url, b.steps || []);
          ws.store.setSetting("browser-report", p.id, result);
          emit("browser-result", {
            projectId: p.id,
            ok: result.ok,
            failed: result.checks.filter((c) => !c.ok).length,
            findings: result.findings.length,
          });
          return json(res, result);
        }
        case "/api/backups/create":
          if (
            codex.active ||
            guide.active ||
            codex.ollama.guideActive ||
            codex.bonsai.guideActive ||
            deploy.active
          )
            throw Error(
              "Tunggu agent dan deploy selesai sebelum membuat backup.",
            );
          return json(res, await backups.create());
        case "/api/backups/restore": {
          if (b.confirmed !== true) throw Error("Pemulihan perlu konfirmasi.");
          if (
            codex.active ||
            guide.active ||
            codex.ollama.guideActive ||
            codex.bonsai.guideActive ||
            deploy.active
          )
            throw Error("Tunggu agent dan deploy selesai sebelum pemulihan.");
          await guide.close();
          stopPreview();
          stopTerminal();
          const result = await backups.restore(b.id);
          emit("backup-restored", { count: result.projects.length });
          return json(res, result);
        }
        case "/api/attachments":
          return json(res, await attachments.add(p, b.item));
        case "/api/gemini/login":
          if (codex.active) throw Error("Tunggu agent selesai sebelum login.");
          return json(res, await codex.gemini.login());
        case "/api/runtime/select":
          if (codex.active)
            throw Error("Tunggu agent selesai sebelum mengganti AI.");
          await codex.ollama.select(
            b.provider === "ollama",
            b.provider === "ollama" ? b.model || "" : "",
          );
          return json(
            res,
            await codex.bonsai.select(
              b.provider === "bonsai",
              b.provider === "bonsai" ? b.model || "" : "",
            ),
          );
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
          if (b.confirmed !== true)
            throw Error("Sync / Pull memerlukan konfirmasi.");
          if (!p) throw Error("Pilih proyek sebelum Sync / Pull.");
          if (codex.active)
            throw Error("Tunggu agent selesai sebelum Sync / Pull.");
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
        case "/api/memory/refresh":
          if (codex.active) throw Error("Tunggu agent selesai sebelum memindai ulang proyek.");
          return json(res, await projectMemory.refresh(p));
        case "/api/memory/save":
          return json(res, projectMemory.save(p.id, b.memory || {}));
        case "/api/skills/save":
          return json(res, skills.save(p.id, b.skill || {}));
        case "/api/skills/delete":
          return json(res, skills.remove(p.id, String(b.id || "")));
        case "/api/review/accept": {
          if (codex.active) throw Error("Hentikan agent sebelum menerima perubahan.");
          const run = activity.current(p.id);
          if (!run?.checkpointId || run.reviewStatus !== "ready")
            throw Error("Tidak ada perubahan agent yang menunggu review.");
          const nextHistory = await ws.checkpoint(
            p,
            `Diterima: ${String(run.request || "Perubahan agent").slice(0, 100)}`,
          );
          activity.update(p.id, { reviewStatus: "accepted", acceptedAt: Date.now() });
          activity.record(p.id, "accepted", "Perubahan diterima", run.diff?.stat || "", {
            runId: run.id,
          });
          emit("review-updated", { projectId: p.id, status: "accepted" });
          return json(res, { ok: true, history: nextHistory, ...activity.view(p.id) });
        }
        case "/api/review/undo": {
          if (codex.active) throw Error("Hentikan agent sebelum Undo.");
          if (b.confirmed !== true) throw Error("Undo perlu konfirmasi.");
          const run = activity.current(p.id);
          if (!run?.checkpointId || !["ready", "accepted"].includes(run.reviewStatus))
            throw Error("Tidak ada perubahan agent yang dapat di-undo.");
          stopPreview();
          const nextHistory = await ws.restore(p, run.checkpointId);
          activity.update(p.id, { reviewStatus: "undone", undoneAt: Date.now() });
          activity.record(p.id, "undone", "Perubahan dikembalikan", run.checkpointId, {
            runId: run.id,
          });
          emit("review-updated", { projectId: p.id, status: "undone" });
          return json(res, { ok: true, history: nextHistory, ...activity.view(p.id) });
        }
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
          if (codex.active) throw Error("Agent masih bekerja.");
          if (!["ask", "plan", "build"].includes(b.mode))
            throw Error("Mode tidak valid.");
          const media = await attachments.resolve(p, b.attachments || []);
          const resolvedSkill = skills.resolve(p.id, b.text);
          const memory = await projectMemory.refresh(p);
          let checkpointId = null;
          if (b.mode === "build") {
            const checkpointHistory = await ws.checkpoint(p, "Otomatis sebelum Build");
            checkpointId = checkpointHistory[0]?.id || null;
            emit("checkpoint", { projectId: p.id });
            await attachments.stage(p, media);
          }
          const enrichedText =
            resolvedSkill.text +
            (media.length ? "\n\n" + attachmentPrompt(media) : "") +
            resolvedSkill.instructions +
            projectMemory.prompt(memory);
          await ws.chat(p, {
            role: "user",
            text: b.text,
            mode: b.mode,
            provider: b.provider || "codex",
            model: b.model,
            multiAgent: b.multiAgent === true && b.mode === "build",
            attachments: media.map(
              ({
                images: _images,
                audio: _audio,
                text: _text,
                source: _source,
                entries: _entries,
                ...meta
              }) => meta,
            ),
          });
          try {
            activity.begin(
              p,
              {
                text: b.text,
                mode: b.mode,
                webMode: b.webMode || "auto",
                provider: b.provider || "codex",
                model: b.model || null,
                multiAgent: b.multiAgent === true && b.mode === "build",
                attachments: [],
              },
              checkpointId,
            );
            if (resolvedSkill.skill)
              activity.record(
                p.id,
                "skill",
                `Skill ${resolvedSkill.skill.command} aktif`,
                resolvedSkill.skill.description,
              );
            if (b.mode === "build") buildProjects.add(p.id);
            if (b.multiAgent === true && b.mode === "build") {
              multiAgentProjects.add(p.id);
              emit("agent-team", {
                projectId: p.id,
                role: "lead",
                status: "started",
                detail: "Menyiapkan Explorer, Builder, dan Reviewer",
              });
            }
            if (
              b.webMode === "web" ||
              ((b.webMode || "auto") === "auto" && shouldBrowse(b.text))
            )
              emit("web-research", {
                projectId: p.id,
                status: "started",
                preference: b.webMode || "auto",
              });
            const research = await web.prepare(b.text, b.webMode || "auto");
            if (research) {
              await ws.chat(p, {
                role: "web",
                text:
                  research.notice ||
                  `Pencarian web · ${research.sources.length} sumber`,
                sources: research.sources,
                checkedAt: research.checkedAt,
              });
              emit("web-research", {
                projectId: p.id,
                status: "completed",
                count: research.sources.length,
              });
            }
            await codex.turn(
              p,
              b.mode,
              enrichedText,
              b.provider || "codex",
              b.model,
              media,
              b.text,
              research?.context || research?.notice || "",
              b.multiAgent === true && b.mode === "build",
            );
          } catch (e) {
            buildProjects.delete(p.id);
            multiAgentProjects.delete(p.id);
            if (b.multiAgent === true)
              emit("agent-team", {
                projectId: p.id,
                role: "lead",
                status: "failed",
                detail: e.message,
              });
            await ws.chat(p, { role: "system", text: e.message });
            await activity.finish(p, e.message).catch(() => {});
            throw e;
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
  void backups
    .ensureDaily()
    .catch((error) => console.error(`Backup otomatis gagal: ${error.message}`));
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
