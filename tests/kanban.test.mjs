import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { KanbanManager, decompose, routeAgents } from "../server/kanban.mjs";

const setup = async (t, scripts) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "forge-kanban-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = { id: "test-project", path: path.join(root, "app") };
  await fs.mkdir(project.path);
  await fs.writeFile(path.join(project.path, "README.md"), "Project uses a small UI.");
  await fs.writeFile(path.join(project.path, ".env"), "SECRET=do-not-leak");
  await fs.writeFile(path.join(project.path, "package.json"), JSON.stringify({ scripts }));
  return { root, project };
};

test("routing keeps small work on one agent and scales complex work by mode", () => {
  assert.equal(routeAgents("Fix button color", "maximum").workers, 1);
  assert.equal(routeAgents("Add search and filter for the existing product catalog", "balanced").workers, 1);
  assert.equal(routeAgents("1. Refactor auth\n2. Migrate database\n3. Add regression tests", "economy").workers, 1);
  assert.deepEqual(
    routeAgents("1. Refactor auth\n2. Migrate database\n3. Add regression tests", "maximum").specialists,
    ["architecture", "risks"],
  );
  assert.deepEqual(decompose("1. Update schema\n2. Add tests"), ["Update schema", "Add tests"]);
});

test("board persists, carries bounded context, and gates Done on Accept plus regression checks", async (t) => {
  const { root, project } = await setup(t, { test: "node -e \"process.exit(1)\"" });
  const events = [];
  const board = new KanbanManager(root, (type, payload) => events.push({ type, payload }));
  const created = await board.create(project, "1. Improve button\n2. Test behavior", "balanced");
  assert.equal(created.column, "backlog");
  assert.equal(created.subtasks.length, 2);
  assert.equal(events.at(-1).type, "kanban-updated");
  await board.move(project, created.id, "todo");
  await assert.rejects(board.move(project, created.id, "in_progress"), /otomatis/);
  const started = await board.start(project, created.id, "run-1", { provider: "codex", enabled: true });
  assert.equal(started.task.column, "in_progress");
  assert.match(started.context, /README.md/);
  assert.doesNotMatch(started.context, /do-not-leak/);
  assert.ok(started.context.length <= 2400);
  await board.recordUsage(project, created.id, { prompt_tokens: 80, completion_tokens: 20 });
  await board.price(project, created.id, 2, 8);
  const finished = await board.finish(project, "run-1", {
    result: "Improved button and added a test.",
    files: [{ status: "M", file: "src/button.tsx" }],
  });
  assert.equal(finished.column, "review_test");
  assert.equal(finished.review, "pending");
  assert.deepEqual(finished.changedFiles, ["src/button.tsx"]);
  await assert.rejects(board.move(project, created.id, "done"), /regression checks/);
  await assert.rejects(board.verify(project, created.id), /Accept/);
  await board.review(project, "run-1", "accepted");
  const failed = await board.verify(project, created.id);
  assert.equal(failed.column, "review_test");
  assert.equal(failed.checks.passed, false);
  assert.equal(failed.checks.results[0].name, "npm run test");
  await fs.writeFile(
    path.join(project.path, "package.json"),
    JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"", lint: "node -e \"process.exit(0)\"" } }),
  );
  const passed = await board.verify(project, created.id);
  assert.equal(passed.column, "done");
  assert.deepEqual(passed.checks.results.map((check) => check.name), ["npm run lint", "npm run test"]);
  assert.equal(passed.usage.estimated, false);
  assert.equal(passed.usage.costUsd, null);
  assert.equal(passed.usage.estimatedCostUsd, 0.00032);
  const reloaded = await new KanbanManager(root).list(project);
  assert.match(reloaded.memory, /Improved button/);
  assert.equal(reloaded.tasks[0].column, "done");
  const stored = await fs.stat(path.join(root, "kanban", "test-project.json"));
  assert.equal(stored.mode & 0o777, 0o600);
});

test("Undo and empty failed builds return the task to To Do; reported cost is summed", async (t) => {
  const { root, project } = await setup(t, {});
  const board = new KanbanManager(root);
  const task = await board.create(project, "Add dark mode", "economy");
  await board.start(project, task.id, "run-a");
  await board.recordUsage(project, task.id, { input_tokens: 10, output_tokens: 5, cost: 0.01 });
  await board.recordUsage(project, task.id, { input_tokens: 4, output_tokens: 1, cost: 0.02 });
  await board.finish(project, "run-a", { files: [{ file: "src/App.tsx" }] });
  const undone = await board.review(project, "run-a", "undone");
  assert.equal(undone.column, "todo");
  assert.equal(undone.buildTaskId, null);
  assert.equal(undone.usage.inputTokens, 14);
  assert.equal(undone.usage.outputTokens, 6);
  assert.ok(Math.abs(undone.usage.costUsd - 0.03) < 1e-9);
  await board.start(project, task.id, "run-b");
  const failed = await board.finish(project, "run-b", { error: "provider offline" });
  assert.equal(failed.column, "todo");
  assert.match(failed.summary, /provider offline/);
  await board.start(project, task.id, "run-c");
  const empty = await board.finish(project, "run-c", { result: "Nothing needed." });
  assert.equal(empty.review, "no-changes");
  const noScripts = await board.verify(project, task.id);
  assert.equal(noScripts.column, "review_test");
  assert.match(noScripts.checks.results[0].output, /lint, test, atau build/);
});

test("regression checks are bounded by a timeout", async (t) => {
  const { root, project } = await setup(t, { test: "node -e \"setTimeout(() => {}, 60000)\"" });
  const board = new KanbanManager(root, () => {}, { checkTimeoutMs: 1500 });
  const task = await board.create(project, "Slow task");
  await board.start(project, task.id, "run-slow");
  await board.finish(project, "run-slow", { result: "done" });
  const started = Date.now();
  const result = await board.verify(project, task.id);
  assert.ok(Date.now() - started < 15000);
  assert.equal(result.checks.passed, false);
  assert.match(result.checks.results[0].output, /Dihentikan/);
});

test("project IDs, modes, sizes and task limits are validated", async (t) => {
  const { root, project } = await setup(t, {});
  const board = new KanbanManager(root);
  await assert.rejects(board.list({ id: "../escape", path: project.path }), /tidak valid/);
  await assert.rejects(board.create(project, "x", "turbo"), /Mode/);
  await assert.rejects(board.create(project, "x".repeat(40001)), /tidak valid/);
  await assert.rejects(board.create(project, "   "), /tidak valid/);
  await assert.rejects(board.price(project, "missing", 1, 1), /tidak ditemukan/);
  const task = await board.create(project, "Something");
  await assert.rejects(board.price(project, task.id, -1, 1), /Tarif/);
  await board.remove(project, task.id);
  assert.equal((await board.list(project)).tasks.length, 0);
  await board.forget(project);
  await assert.rejects(fs.stat(path.join(root, "kanban", "test-project.json")), /ENOENT/);
});
