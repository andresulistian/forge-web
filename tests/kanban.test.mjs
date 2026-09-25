import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { KanbanManager, decompose, routeAgents } from "../server/kanban.mjs";
const exec = promisify(execFile);

test("routing keeps small work on one agent and scales complex work by mode", () => {
  assert.equal(routeAgents("Fix button color", "maximum").workers, 1);
  assert.equal(routeAgents("Add search and filter for the existing product catalog", "balanced").workers, 1);
  assert.equal(routeAgents("1. Refactor auth\n2. Migrate database\n3. Add regression tests", "economy").workers, 1);
  assert.deepEqual(routeAgents("1. Refactor auth\n2. Migrate database\n3. Add regression tests", "maximum").specialists, ["architecture", "risks"]);
  assert.deepEqual(decompose("1. Update schema\n2. Add tests"), ["Update schema", "Add tests"]);
});

test("board persists, carries bounded context, and gates Done on regression checks", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "forge-kanban-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = { id: "test-project", path: path.join(root, "app") };
  await fs.mkdir(project.path);
  await exec("git", ["init", "-q", project.path]);
  await fs.writeFile(path.join(project.path, "README.md"), "Project uses a small UI.");
  await fs.writeFile(path.join(project.path, "package.json"), JSON.stringify({ scripts: { test: "node -e 'process.exit(1)'" } }));
  const board = new KanbanManager(root);
  const created = await board.create(project, "1. Improve button\n2. Test behavior", "balanced");
  assert.equal(created.column, "backlog");
  assert.equal(created.subtasks.length, 2);
  const started = await board.start(project, created.id, "build-1", { provider: "codex", enabled: true });
  assert.equal(started.task.column, "in_progress");
  assert.match(started.context, /README.md/);
  assert.ok(started.context.length <= 2400);
  await board.recordUsage(project, created.id, { prompt_tokens: 80, completion_tokens: 20 });
  await board.price(project, created.id, 2, 8);
  await board.finish(project, "build-1", { result: "Improved button and added a test.", files: [{ path: "src/button.tsx" }] });
  await assert.rejects(board.move(project, created.id, "done"), /regression checks/);
  const failed = await board.verify(project, created.id);
  assert.equal(failed.column, "review_test");
  assert.equal(failed.checks.passed, false);
  await fs.writeFile(path.join(project.path, "package.json"), JSON.stringify({ scripts: { test: "node -e 'process.exit(0)'" } }));
  const passed = await board.verify(project, created.id);
  assert.equal(passed.column, "done");
  assert.equal(passed.usage.estimated, false);
  assert.equal(passed.usage.costUsd, null);
  assert.equal(passed.usage.estimatedCostUsd, 0.00032);
  assert.match((await new KanbanManager(root).list(project)).memory, /Improved button/);
});
