import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runProjectChecks, checkEnvironment, redactCheckOutput } from "../server/workflow-checks.mjs";
const fixture = async (t, scripts) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "forge-checks-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts }));
  return { id: "checks", path: root };
};
test("actual npm test exit status is captured; lint/test/build run in order", async (t) => {
  const project = await fixture(t, { lint: 'node -e "process.exit(0)"', test: 'node -e "console.log(123)"', build: 'node -e "process.exit(0)"' });
  const result = await runProjectChecks(project, { approve: async ({ command }) => { assert.equal(command, "npm run lint && npm run test && npm run build"); return true; } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.results.map(({ name }) => name), ["lint", "test", "build"]);
  assert.match(result.results[1].output, /123/);
});
test("actual failing npm test is not reported as a pass", async (t) => {
  const project = await fixture(t, { test: 'node -e "process.exit(7)"' });
  const result = await runProjectChecks(project, { approve: async () => true });
  assert.equal(result.ok, false);
  assert.notEqual(result.results[0].exitCode, 0);
});
test("missing tests block without asking to run a build-only script", async (t) => {
  const project = await fixture(t, { build: 'node -e "process.exit(0)"' });
  let called = false;
  const result = await runProjectChecks(project, { approve: async () => { called = true; return true; } });
  assert.equal(result.blocked, true);
  assert.equal(called, false);
});
test("declined approval does not execute project code", async (t) => {
  const project = await fixture(t, { test: 'node -e "require(\'fs\').writeFileSync(\'sentinel\',\'ran\')"' });
  const result = await runProjectChecks(project, { approve: async () => false });
  assert.equal(result.blocked, true);
  await assert.rejects(fs.stat(path.join(project.path, "sentinel")), { code: "ENOENT" });
});
test("a changed manifest after approval blocks execution", async (t) => {
  const project = await fixture(t, { test: 'node -e "process.exit(0)"' });
  const result = await runProjectChecks(project, { approve: async () => { await fs.writeFile(path.join(project.path, "package.json"), '{"scripts":{"test":"echo changed"}}'); return true; } });
  assert.equal(result.blocked, true);
  assert.equal(result.results[0].name, "manifest");
});
test("timeout terminates the npm process group and blocks retries", async (t) => {
  const project = await fixture(t, { test: 'node -e "setInterval(()=>{},100)"' });
  const result = await runProjectChecks(project, { approve: async () => true, timeoutMs: 500 });
  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.equal(result.results[0].timedOut, true);
});
test("abort interrupts an unanswered approval instead of hanging", async (t) => {
  const project = await fixture(t, { test: 'node -e "process.exit(0)"' });
  const controller = new AbortController();
  const pending = runProjectChecks(project, { signal: controller.signal, approve: () => new Promise(() => {}) });
  setTimeout(() => controller.abort(), 20);
  assert.equal((await pending).blocked, true);
});
test("missing/invalid/symlink manifests are rejected", async (t) => {
  const project = await fixture(t, {});
  await fs.writeFile(path.join(project.path, "package.json"), "bad");
  assert.equal((await runProjectChecks(project, { approve: async () => true })).blocked, true);
  await fs.rename(path.join(project.path, "package.json"), path.join(project.path, "other.json"));
  await fs.symlink("other.json", path.join(project.path, "package.json"));
  assert.equal((await runProjectChecks(project, { approve: async () => true })).blocked, true);
});
test("child environment does not forward credentials or Node injection settings", () => {
  const result = checkEnvironment({ PATH: "/usr/bin", HOME: "/tmp", OPENAI_API_KEY: "x", FORGE_BRAVE_SEARCH_API_KEY: "x", NODE_OPTIONS: "--require evil.js", npm_config_registry: "bad", VERCEL_TOKEN: "x" });
  assert.deepEqual(result, { CI: "1", FORCE_COLOR: "0", PATH: "/usr/bin", HOME: "/tmp" });
});
test("obvious tokens in test output are redacted before handoff", () => {
  const output = redactCheckOutput("Bearer abcdefghijklmnop api_key=privatevalue sk-abcdefghijklmnopqrst ghp_abcdefghijklmnopqrst");
  assert.doesNotMatch(output, /abcdefghijkl|privatevalue/);
  assert.match(output, /redacted/);
});
