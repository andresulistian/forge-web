import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../server/workspace.mjs";
import { BuildTaskManager } from "../server/build-tasks.mjs";

async function fixture(t) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "forge-build-task-"));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const ws = new Workspace(
    path.join(tmp, "data"),
    path.join(tmp, "projects"),
    path.resolve("templates/starter"),
  );
  await ws.init();
  t.after(() => ws.close());
  const project = await ws.create("Task project");
  const events = [];
  const builds = new BuildTaskManager(ws, (type, payload) => events.push({ type, payload }));
  await builds.init();
  return { tmp, ws, project, builds, events };
}

test("Build uses an isolated worktree and exposes a structured review", async (t) => {
  const { project, builds, events } = await fixture(t);
  const original = await fs.readFile(path.join(project.path, "index.html"), "utf8");
  const started = await builds.start(project, { provider: "codex", model: "test" });
  t.after(() => builds.discard(project, started.task.id).catch(() => {}));

  assert.notEqual(started.project.path, project.path);
  assert.equal(started.project.id, project.id);
  assert.match(started.project.agentSessionKey, /^build:/);
  assert.equal(await fs.readFile(path.join(started.project.path, "index.html"), "utf8"), original);

  await fs.writeFile(path.join(started.project.path, "index.html"), original + "\n<!-- isolated -->\n");
  await fs.writeFile(path.join(started.project.path, "file with space.txt"), "new\nfile\n");
  await fs.unlink(path.join(started.project.path, "README.md"));
  assert.equal(await fs.readFile(path.join(project.path, "index.html"), "utf8"), original);

  const review = await builds.finish(project, started.task.id);
  assert.equal(review.task.status, "review");
  assert.deepEqual(
    review.files.map(({ path: name, status }) => [name, status]).sort(),
    [
      ["README.md", "D"],
      ["file with space.txt", "A"],
      ["index.html", "M"],
    ],
  );
  const diff = await builds.diff(project, started.task.id, "index.html");
  assert.match(diff.patch, /isolated/);
  assert.equal(diff.truncated, false);
  assert.ok(events.some((event) => event.type === "build-review-ready"));
});

test("selected changes apply safely, checkpoint, and leave the rest for review", async (t) => {
  const { project, builds, ws } = await fixture(t);
  const original = await fs.readFile(path.join(project.path, "index.html"), "utf8");
  const { task, project: isolated } = await builds.start(project);
  t.after(() => builds.discard(project, task.id).catch(() => {}));
  await fs.writeFile(path.join(isolated.path, "index.html"), original + "\nselected\n");
  await fs.writeFile(path.join(isolated.path, "later.txt"), "later");
  await builds.finish(project, task.id);

  let review = await builds.apply(project, task.id, ["index.html"]);
  assert.equal(review.task.status, "review");
  assert.match(await fs.readFile(path.join(project.path, "index.html"), "utf8"), /selected/);
  await assert.rejects(() => fs.access(path.join(project.path, "later.txt")));
  assert.equal(review.files.find((file) => file.path === "index.html").applied, true);
  assert.match((await ws.history(project))[0].label, /Terapkan Build/);

  review = await builds.apply(project, task.id);
  assert.equal(review.task.status, "applied");
  assert.equal(await fs.readFile(path.join(project.path, "later.txt"), "utf8"), "later");
  await assert.rejects(() => fs.access(isolated.path));
  const archived = await builds.diff(project, task.id, "index.html");
  assert.match(archived.patch, /selected/);
  assert.equal(archived.unavailable, false);

  await fs.rm(path.join(builds.reviews, task.id), { recursive: true, force: true });
  const legacy = await builds.diff(project, task.id, "index.html");
  assert.equal(legacy.unavailable, true);
  assert.match(legacy.patch, /Build lama/);
});

test("apply rejects workspace conflicts and discard removes only the isolated worktree", async (t) => {
  const { project, builds } = await fixture(t);
  const original = await fs.readFile(path.join(project.path, "index.html"), "utf8");
  const { task, project: isolated } = await builds.start(project);
  await fs.writeFile(path.join(isolated.path, "index.html"), original + "\nagent\n");
  await builds.finish(project, task.id);
  await fs.writeFile(path.join(project.path, "index.html"), original + "\nexternal\n");

  await assert.rejects(
    () => builds.apply(project, task.id),
    /berubah sejak Build dimulai/,
  );
  const discarded = await builds.discard(project, task.id);
  assert.equal(discarded.task.status, "discarded");
  assert.match(await fs.readFile(path.join(project.path, "index.html"), "utf8"), /external/);
  await assert.rejects(() => fs.access(isolated.path));
  await assert.rejects(() => builds.diff(project, task.id, "../../outside"));
});

test("task ids are project scoped", async (t) => {
  const { ws, project, builds } = await fixture(t);
  const other = await ws.create("Other project");
  const { task } = await builds.start(project);
  t.after(() => builds.discard(project, task.id).catch(() => {}));
  await assert.rejects(() => builds.get(other, task.id), /tidak ditemukan/);
});

test("failed Build snapshots partial changes for review and optional apply", async (t) => {
  const { project, builds } = await fixture(t);
  const original = await fs.readFile(path.join(project.path, "index.html"), "utf8");
  const { task, project: isolated } = await builds.start(project);
  t.after(() => builds.discard(project, task.id).catch(() => {}));
  await fs.writeFile(path.join(isolated.path, "index.html"), original + "\npartial result\n");

  const failed = await builds.finish(project, task.id, Error("tool budget exhausted"));
  assert.equal(failed.task.status, "failed");
  assert.equal(failed.files.length, 1);
  assert.match((await builds.diff(project, task.id, "index.html")).patch, /partial result/);

  const applied = await builds.apply(project, task.id, ["index.html"]);
  assert.equal(applied.task.status, "applied");
  assert.match(await fs.readFile(path.join(project.path, "index.html"), "utf8"), /partial result/);
});
