import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
test("HTTP auth, origin, project creation, preview process, checkpoint and restore", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "forge-http-"));
  const backupRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "forge-http-backups-"),
  );
  const child = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      FORGE_DATA_DIR: tmp,
      FORGE_BACKUP_DIR: backupRoot,
      FORGE_PORT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((r) => child.once("exit", r));
    }
    await fs.rm(tmp, { recursive: true, force: true });
    await fs.rm(backupRoot, { recursive: true, force: true });
  });
  const { url, token } = await new Promise((resolve, reject) => {
    createInterface({ input: child.stdout }).once("line", (l) =>
      resolve(JSON.parse(l)),
    );
    child.once("error", reject);
    child.once("exit", (code) => reject(Error("Backend exited: " + code)));
    child.stderr.on("data", (c) => {
      if (c.toString().includes("EPERM"))
        reject(Error("Local listener blocked by sandbox"));
    });
  });
  const api = async (route, body) => {
    const res = await fetch(url + "/api/" + route, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    return data;
  };
  assert.equal((await fetch(url + "/api/state")).status, 401);
  assert.equal(
    (
      await fetch(url + "/api/state", {
        headers: {
          Authorization: "Bearer " + token,
          Origin: "https://evil.example",
        },
      })
    ).status,
    403,
  );
  const p = await api("projects/create", { name: "Demo" });
  const boardTask = await api("kanban/create", {
    projectId: p.id,
    request: "1. Add UI\n2. Check layout",
    mode: "economy",
  });
  assert.equal(boardTask.subtasks.length, 2);
  assert.equal((await api("kanban?projectId=" + p.id)).tasks[0].column, "backlog");
  await api("kanban/move", { projectId: p.id, taskId: boardTask.id, column: "todo" });
  assert.equal((await api("kanban?projectId=" + p.id)).tasks[0].column, "todo");
  const unconfirmedVerify = await fetch(url + "/api/kanban/verify", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ projectId: p.id, taskId: boardTask.id }),
  });
  assert.equal(unconfirmedVerify.status, 400);
  assert.match((await unconfirmedVerify.json()).error, /persetujuan/);
  assert.equal(await api("browser/report?projectId=" + p.id), null);
  const noPreview = await fetch(url + "/api/browser/run", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ projectId: p.id, steps: [] }),
  });
  assert.equal(noPreview.status, 400);
  assert.match((await noPreview.json()).error, /Preview/);
  assert.ok((await api("files?projectId=" + p.id)).includes("index.html"));
  const deployment = await api("deploy/inspect?projectId=" + p.id);
  assert.equal(deployment.projectType, "web");
  assert.ok(
    Array.isArray((await api("deploy/releases?projectId=" + p.id)).entries),
  );
  const unconfirmedRollback = await fetch(url + "/api/deploy/rollback", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ projectId: p.id, id: "a".repeat(32) }),
  });
  assert.equal(unconfirmedRollback.status, 400);
  assert.match((await unconfirmedRollback.json()).error, /konfirmasi/);
  const deployConfig = await api("deploy/config", {
    projectId: p.id,
    config: {
      ...deployment.config,
      hosting: "vercel",
      database: "supabase",
    },
  });
  assert.equal(deployConfig.hosting, "vercel");
  assert.equal(deployConfig.database, "supabase");
  const guide = await api("backend/guide", {
    projectId: p.id,
    config: { data: "tasks", auth: true, api: false },
  });
  assert.equal(guide.provider, "supabase");
  assert.match(guide.prompt, /Row Level Security/);
  assert.equal(
    (await api("backend/guide?projectId=" + p.id)).config.data,
    "tasks",
  );
  const monitor = await api("monitor/config", {
    projectId: p.id,
    config: {
      url: "https://example.com/",
      expected: "Ready",
      interval: 15,
      enabled: false,
    },
  });
  assert.equal(monitor.config.enabled, false);
  assert.equal((await api("monitor?projectId=" + p.id)).checks.length, 0);
  assert.ok((await fs.stat(path.join(tmp, "forge.sqlite"))).isFile());
  await assert.rejects(() => fs.access(path.join(tmp, "projects.json")));
  const db = new DatabaseSync(path.join(tmp, "forge.sqlite"), {
    readOnly: true,
  });
  const storedConfig = JSON.parse(
    db
      .prepare("SELECT value FROM settings WHERE scope = ? AND key = ?")
      .get("deploy", p.id).value,
  );
  db.close();
  assert.equal(storedConfig.hosting, "vercel");
  const h = await api("checkpoint", { projectId: p.id });
  assert.equal(h.length, 1);
  const preview = await api("preview/start", {
    projectId: p.id,
    confirmed: true,
  });
  assert.ok(
    (await (await fetch(preview.url)).text()).includes("Little Things"),
  );
  const invalidJourney = await fetch(url + "/api/browser/run", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      projectId: p.id,
      steps: [{ action: "visit", path: "//outside.example" }],
    }),
  });
  assert.equal(invalidJourney.status, 400);
  assert.match((await invalidJourney.json()).error, /path lokal/);
  await api("preview/stop", {});
  await api("restore", { projectId: p.id, id: h[0].id, confirmed: true });
  assert.equal((await api("history?projectId=" + p.id)).length, 3);
  const opened = await api(
    "file?projectId=" + p.id + "&file=" + encodeURIComponent("index.html"),
  );
  const saved = await api("file/save", {
    projectId: p.id,
    file: "index.html",
    expected: opened.text,
    text: opened.text + "\n<!-- edit manual -->\n",
  });
  assert.equal(saved.changed, true);
  assert.equal(saved.history.length, 4);
  assert.match(
    (
      await api(
        "file?projectId=" + p.id + "&file=" + encodeURIComponent("index.html"),
      )
    ).text,
    /edit manual/,
  );
  const snapshot = await api("backups/create", {});
  assert.equal(snapshot.projects, 1);
  assert.equal((await api("backups")).backups[0].id, snapshot.id);
  const rejected = await fetch(url + "/api/backups/restore", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: snapshot.id }),
  });
  assert.equal(rejected.status, 400);
  const recovered = await api("backups/restore", {
    id: snapshot.id,
    confirmed: true,
  });
  assert.equal(recovered.projects[0].id, p.id);
  assert.ok(
    (await api("file?projectId=" + p.id + "&file=index.html")).text.includes(
      "edit manual",
    ),
  );
  const wrongDelete = await fetch(url + "/api/projects/delete", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      projectId: p.id,
      confirmed: true,
      confirmationName: "wrong",
      deleteFiles: false,
    }),
  });
  assert.equal(wrongDelete.status, 400);
  assert.match((await wrongDelete.json()).error, /nama proyek/);
  const removed = await api("projects/delete", {
    projectId: p.id,
    confirmed: true,
    confirmationName: "Demo",
    deleteFiles: false,
  });
  assert.equal(removed.deletedFiles, false);
  assert.equal(removed.projects.length, 0);
  assert.equal((await api("state")).projects.length, 0);
  assert.ok((await fs.stat(recovered.projects[0].path)).isDirectory());
  const first = await api("projects/create", { name: "Workspace One" });
  const second = await api("projects/create", { name: "Workspace Two" });
  const wrongClear = await fetch(url + "/api/projects/clear", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      confirmed: true,
      confirmationText: "wrong",
      deleteFiles: false,
    }),
  });
  assert.equal(wrongClear.status, 400);
  assert.match((await wrongClear.json()).error, /HAPUS WORKSPACE/);
  const cleared = await api("projects/clear", {
    confirmed: true,
    confirmationText: "HAPUS WORKSPACE",
    deleteFiles: false,
  });
  assert.equal(cleared.count, 2);
  assert.equal(cleared.deletedFiles, false);
  assert.equal((await api("state")).projects.length, 0);
  assert.ok((await fs.stat(first.path)).isDirectory());
  assert.ok((await fs.stat(second.path)).isDirectory());
});
