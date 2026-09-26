import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Workspace, safeFile } from "../server/workspace.mjs";
import { policy, Codex } from "../server/codex.mjs";
async function fixture(t) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "forge-test-"));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const ws = new Workspace(
    path.join(tmp, "data"),
    path.join(tmp, "projects"),
    path.resolve("templates/starter"),
  );
  await ws.init();
  t.after(() => ws.close());
  const p = await ws.create("Test project");
  return { ws, p, tmp };
}
test("create, reopen, persist projects; reject unsafe project names", async (t) => {
  const { ws, p } = await fixture(t);
  assert.equal((await ws.open(p.path)).id, p.id);
  await ws.chat(p, { role: "user", text: "tersimpan di SQLite" });
  const next = new Workspace(ws.dataDir, ws.projectsDir, ws.template);
  await next.init();
  t.after(() => next.close());
  assert.equal(next.projects.length, 1);
  assert.equal((await next.messages(p))[0].text, "tersimpan di SQLite");
  assert.ok((await fs.stat(path.join(ws.dataDir, "forge.sqlite"))).isFile());
  await assert.rejects(() => fs.access(path.join(ws.dataDir, "projects.json")));
  await assert.rejects(() => ws.create("../escape"));
  await assert.rejects(
    () => ws.create("Test project"),
    /Folder proyek “Test project” masih ada/,
  );
});

test("project removal can keep files or move the exact folder to macOS Trash", async (t) => {
  const { ws, p, tmp } = await fixture(t);
  await ws.chat(p, { role: "user", text: "hapus riwayat" });
  ws.store.addHistory("ollama", p.id, { role: "user", content: "memory" });
  ws.store.setSetting("deploy", p.id, { hosting: "vercel" });
  await ws.checkpoint(p, "Before delete");
  const kept = await ws.remove(p, false);
  assert.equal(kept.deletedFiles, false);
  assert.ok((await fs.stat(p.path)).isDirectory());
  assert.equal(ws.projects.length, 0);
  assert.equal(ws.store.setting("deploy", p.id), null);
  assert.equal(ws.store.history("ollama", p.id).length, 0);

  const reopened = await ws.open(p.path);
  const fakeHome = path.join(tmp, "home");
  await fs.mkdir(path.join(fakeHome, ".Trash"), { recursive: true });
  ws.platform = "darwin";
  ws.homeDir = fakeHome;
  const deleted = await ws.remove(reopened, true);
  assert.equal(deleted.deletedFiles, true);
  await assert.rejects(() => fs.access(reopened.path));
  assert.ok((await fs.stat(deleted.trashedTo)).isDirectory());
  assert.ok(
    deleted.trashedTo.startsWith(path.join(fakeHome, ".Trash") + path.sep),
  );
});

test("workspace removal keeps source folders or moves every exact project to macOS Trash", async (t) => {
  const { ws, p, tmp } = await fixture(t);
  const second = await ws.create("Second project");
  await ws.chat(p, { role: "user", text: "hapus seluruh workspace" });
  ws.store.addHistory("ollama", second.id, { role: "user", content: "memory" });
  ws.store.setSetting("deploy", p.id, { hosting: "vercel" });
  ws.store.setSetting("global", "api-providers", [{ id: "tetap-ada" }]);

  const kept = await ws.clear(false);
  assert.equal(kept.count, 2);
  assert.equal(kept.deletedFiles, false);
  assert.equal(ws.projects.length, 0);
  assert.ok((await fs.stat(p.path)).isDirectory());
  assert.ok((await fs.stat(second.path)).isDirectory());
  assert.equal(ws.store.setting("deploy", p.id), null);
  assert.deepEqual(ws.store.setting("global", "api-providers"), [
    { id: "tetap-ada" },
  ]);

  await ws.open(p.path);
  await ws.open(second.path);
  const fakeHome = path.join(tmp, "home");
  await fs.mkdir(path.join(fakeHome, ".Trash"), { recursive: true });
  ws.platform = "darwin";
  ws.homeDir = fakeHome;
  const deleted = await ws.clear(true);
  assert.equal(deleted.count, 2);
  assert.equal(deleted.deletedFiles, true);
  await assert.rejects(() => fs.access(p.path));
  await assert.rejects(() => fs.access(second.path));
  assert.equal((await fs.readdir(path.join(fakeHome, ".Trash"))).length, 2);
  assert.deepEqual(ws.store.setting("global", "api-providers"), [
    { id: "tetap-ada" },
  ]);
});

test("SQLite migrates legacy project registry and chat without deleting originals", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "forge-migrate-"));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const data = path.join(tmp, "data");
  const projectPath = path.join(tmp, "legacy-project");
  const project = {
    id: "legacy-id",
    name: "Legacy",
    path: projectPath,
    createdAt: 1234,
  };
  await fs.mkdir(data, { recursive: true });
  await fs.mkdir(projectPath);
  await fs.writeFile(
    path.join(data, "projects.json"),
    JSON.stringify([project]),
  );
  await fs.writeFile(
    path.join(data, "legacy-id.jsonl"),
    JSON.stringify({ role: "user", text: "pesan lama", time: 5678 }) + "\n",
  );
  await fs.mkdir(path.join(data, "ollama-memory"));
  await fs.writeFile(
    path.join(data, "ollama-memory", "legacy-id.jsonl"),
    JSON.stringify({ role: "user", content: "memori lokal", time: 6789 }) +
      "\n",
  );
  await fs.mkdir(path.join(data, "guide-memory"));
  await fs.writeFile(
    path.join(data, "guide-memory", "general.jsonl"),
    JSON.stringify({ role: "assistant", text: "riwayat guide", time: 7890 }) +
      "\n",
  );
  const ws = new Workspace(
    data,
    path.join(data, "projects"),
    path.resolve("templates/starter"),
  );
  await ws.init();
  t.after(() => ws.close());
  assert.deepEqual(ws.projects, [project]);
  assert.equal((await ws.messages(project))[0].text, "pesan lama");
  assert.equal(
    ws.store.history("ollama", "legacy-id")[0].content,
    "memori lokal",
  );
  assert.equal(ws.store.history("guide", "general")[0].text, "riwayat guide");
  assert.ok((await fs.stat(path.join(data, "projects.json"))).isFile());
  assert.ok((await fs.stat(path.join(data, "legacy-id.jsonl"))).isFile());
});
test("file read blocks traversal, secrets, and symlinks outside root", async (t) => {
  const { ws, p, tmp } = await fixture(t);
  await fs.writeFile(path.join(tmp, "outside"), "private");
  await fs.writeFile(path.join(p.path, ".env"), "secret");
  await fs.symlink(path.join(tmp, "outside"), path.join(p.path, "link"));
  await assert.rejects(() => safeFile(p.path, "../../outside"));
  await assert.rejects(() => ws.read(p, ".env"));
  await assert.rejects(() => ws.read(p, "link"));
  assert.ok((await ws.read(p, "index.html")).includes("Little Things"));
  assert.ok(!(await ws.files(p)).includes("link"));
});
test("manual edit checkpoints first, detects stale content, and can be restored", async (t) => {
  const { ws, p } = await fixture(t);
  const original = await ws.read(p, "index.html");
  const edited = original + "\n<!-- belajar dengan Forge -->\n";
  const result = await ws.write(p, "index.html", edited, original);
  assert.equal(result.changed, true);
  assert.equal(await ws.read(p, "index.html"), edited);
  assert.match(result.history[0].label, /sebelum edit manual: index\.html/);
  await assert.rejects(
    () => ws.write(p, "index.html", "menimpa", original),
    /berubah sejak dibuka/,
  );
  const unchanged = await ws.write(p, "index.html", edited, edited);
  assert.equal(unchanged.changed, false);
  await ws.restore(p, result.history[0].id);
  assert.equal(await ws.read(p, "index.html"), original);
  await assert.rejects(() => ws.write(p, ".env", "secret", ""));
});
test("restore restores deleted files, removes new files, preserves recovery checkpoint and excludes secrets", async (t) => {
  const { ws, p } = await fixture(t);
  await fs.writeFile(path.join(p.path, ".env"), "secret");
  const initial = await ws.checkpoint(p, "Initial");
  await fs.writeFile(path.join(p.path, "new.txt"), "new content");
  await fs.unlink(path.join(p.path, "index.html"));
  const history = await ws.restore(p, initial[0].id);
  assert.ok(
    (await fs.readFile(path.join(p.path, "index.html"), "utf8")).includes(
      "Little Things",
    ),
  );
  await assert.rejects(() => fs.access(path.join(p.path, "new.txt")));
  assert.equal(await fs.readFile(path.join(p.path, ".env"), "utf8"), "secret");
  const recovery = history.find(
    (h) => h.label === "Cadangan otomatis sebelum restore",
  );
  assert.ok(recovery);
  await ws.restore(p, recovery.id);
  assert.equal(
    await fs.readFile(path.join(p.path, "new.txt"), "utf8"),
    "new content",
  );
  assert.ok(!(await ws.git(p, ["ls-files"])).includes(".env"));
});
test("Ask and Plan enforce read-only; Build restricts writable roots and network", () => {
  assert.equal(policy("ask", "/tmp/p").type, "readOnly");
  assert.equal(policy("plan", "/tmp/p").type, "readOnly");
  assert.deepEqual(policy("build", "/tmp/p").writableRoots, ["/tmp/p"]);
  assert.equal(policy("build", "/tmp/p").networkAccess, false);
  assert.throws(() => policy("danger", "/"));
});
test("approvals are answered once, unknown server requests fail closed", () => {
  const events = [];
  const sent = [];
  const c = new Codex((type, payload) => events.push({ type, payload }));
  c.send = (m) => sent.push(m);
  c.active = { projectId: "p" };
  c.receive({
    id: 42,
    method: "item/fileChange/requestApproval",
    params: { reason: "Write" },
  });
  assert.equal(c.approvals.size, 1);
  c.decide(42, false);
  assert.equal(sent[0].result.decision, "decline");
  assert.throws(() => c.decide(42, true));
  c.receive({ id: 43, method: "unknown/request", params: {} });
  assert.equal(sent[1].error.code, -32601);
});

test("mode changes preserve conversation while changing enforced permissions", async () => {
  const c = new Codex(() => {});
  const calls = [];
  c.connect = async () => ({});
  c.request = async (method, params) => {
    calls.push({ method, params });
    return method === "thread/start"
      ? { thread: { id: "thread-1" } }
      : { turn: { id: "turn-1" } };
  };
  const p = { id: "p", path: "/tmp/project" };
  await c.turn(p, "plan", "Rencanakan fitur");
  c.receive({ method: "turn/completed", params: {} });
  await c.turn(p, "build", "Implementasikan rencana tadi");
  assert.equal(calls.filter((c) => c.method === "thread/start").length, 1);
  const turns = calls.filter((c) => c.method === "turn/start");
  assert.equal(turns[0].params.sandboxPolicy.type, "readOnly");
  assert.equal(turns[1].params.sandboxPolicy.type, "workspaceWrite");
  assert.equal(turns[1].params.approvalPolicy, "on-request");
  assert.equal(turns[0].params.threadId, turns[1].params.threadId);
});
