import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../server/workspace.mjs";
import { BackupManager } from "../server/backups.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "forge-backups-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = new Workspace(path.join(root, "installation", ".forge"),
    path.join(root, "installation", ".forge", "projects"), path.resolve("templates/starter"));
  await workspace.init();
  t.after(() => workspace.close());
  const backups = new BackupManager(workspace, path.join(root, "persistent-backups"));
  return { root, workspace, backups };
}

test("backup restores project files, chat, settings and attachments after a fresh install", async (t) => {
  const { root, workspace, backups } = await fixture(t);
  const external = path.join(root, "separate-project");
  await fs.mkdir(external);
  await fs.writeFile(path.join(external, "app.txt"), "sebelum perubahan");
  await fs.mkdir(path.join(external, "node_modules"));
  await fs.writeFile(path.join(external, "node_modules", "cache"), "tidak disalin");
  const original = await workspace.open(external);
  await workspace.chat(original, { role: "user", text: "riwayat penting" });
  workspace.store.setSetting("global", "mcp-servers", [{ id: "demo" }]);
  const attachments = path.join(workspace.dataDir, "attachments", original.id);
  await fs.mkdir(attachments, { recursive: true });
  await fs.writeFile(path.join(attachments, "image.txt"), "lampiran");
  const first = await backups.create();
  assert.equal(first.projects, 1);
  assert.equal((await backups.list()).backups[0].id, first.id);
  await fs.writeFile(path.join(external, "app.txt"), "sesudah perubahan");
  await workspace.chat(original, { role: "user", text: "pesan baru" });
  const extra = await workspace.create("Proyek baru");
  const restored = await backups.restore(first.id);
  assert.equal(restored.projects.length, 1);
  assert.equal(restored.projects[0].id, original.id);
  assert.notEqual(restored.projects[0].path, external);
  assert.equal(await fs.readFile(path.join(external, "app.txt"), "utf8"), "sesudah perubahan");
  assert.equal(await fs.readFile(path.join(restored.projects[0].path, "app.txt"), "utf8"), "sebelum perubahan");
  await assert.rejects(() => fs.access(path.join(restored.projects[0].path, "node_modules")));
  assert.equal((await workspace.messages(restored.projects[0]))[0].text, "riwayat penting");
  assert.equal((await workspace.messages(restored.projects[0])).length, 1);
  assert.deepEqual(workspace.store.setting("global", "mcp-servers"), [{ id: "demo" }]);
  assert.equal(await fs.readFile(path.join(workspace.dataDir, "attachments", original.id, "image.txt"), "utf8"), "lampiran");
  assert.equal((await backups.list()).backups.length, 2);
  assert.ok((await backups.list()).backups.some((item) => item.label.includes("sebelum pemulihan")));
  assert.ok(extra.id);

  const freshData = path.join(root, "new-install", ".forge");
  const fresh = new Workspace(freshData, path.join(freshData, "projects"), workspace.template);
  await fresh.init();
  t.after(() => fresh.close());
  const recovery = new BackupManager(fresh, backups.root);
  assert.equal((await recovery.list()).backups.length, 2);
  await recovery.restore(first.id);
  assert.equal(fresh.projects.length, 1);
  assert.equal((await fresh.messages(fresh.projects[0]))[0].text, "riwayat penting");
});

test("altered backup fails validation without changing current data", async (t) => {
  const { root, workspace, backups } = await fixture(t);
  const project = await workspace.create("Keep Me");
  const backup = await backups.create();
  await fs.writeFile(path.join(backups.root, backup.id, "projects", "p00001", "index.html"), "corrupt");
  await assert.rejects(backups.restore(backup.id), /berubah atau rusak/);
  assert.equal(workspace.projects[0].id, project.id);
  assert.equal((await backups.list()).backups.length, 1);
  await assert.rejects(backups.restore("../../other"), /tidak valid/);
  await fs.symlink(path.join(root, "outside"), path.join(backups.root, backup.id, "data", "link"));
  await assert.rejects(backups.restore(backup.id), /tautan simbolik/);
});

test("restored project paths remain canonical through macOS-style directory aliases", async (t) => {
  const container = await fs.mkdtemp(path.join(os.tmpdir(), "forge-alias-"));
  t.after(() => fs.rm(container, { recursive: true, force: true }));
  const physical = path.join(container, "private-var");
  await fs.mkdir(physical);
  const root = path.join(container, "var");
  await fs.symlink(physical, root);
  const actual = path.join(root, "actual");
  await fs.mkdir(actual);
  await fs.symlink(actual, path.join(root, "alias"));
  const data = path.join(root, "alias", ".forge");
  const ws = new Workspace(data, path.join(data, "projects"), path.resolve("templates/starter"));
  await ws.init();
  t.after(() => ws.close());
  const project = await ws.create("Aliased");
  const backups = new BackupManager(ws, path.join(root, "backups"));
  const snapshot = await backups.create();
  await backups.restore(snapshot.id);
  assert.equal(ws.projects[0].id, project.id);
  assert.ok(ws.projects[0].path.startsWith((await fs.realpath(actual)) + path.sep));
  assert.match(await ws.read(ws.projects[0], "index.html"), /Little Things/);
});
