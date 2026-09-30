import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as runtime from "../server/codex.mjs";
import { Agents } from "../server/agents.mjs";

test("Forge isolates OpenAI catalog while sharing the existing CLI login", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-codex-home-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceHome = path.join(root, "source");
  fs.mkdirSync(sourceHome);
  fs.writeFileSync(path.join(sourceHome, "auth.json"), "{}");
  fs.writeFileSync(
    path.join(sourceHome, "config.toml"),
    'model_catalog_json = "ollama.json"\n',
  );
  assert.equal(typeof runtime.codexEnvironment, "function");
  const env = runtime.codexEnvironment(path.join(root, "runtime"), {
    HOME: root,
    CODEX_HOME: sourceHome,
    OPENAI_API_KEY: "test-secret",
    PATH: "/bin",
  });
  assert.notEqual(env.CODEX_HOME, sourceHome);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(
    fs.realpathSync(path.join(env.CODEX_HOME, "auth.json")),
    fs.realpathSync(path.join(sourceHome, "auth.json")),
  );
  assert.equal(fs.existsSync(path.join(env.CODEX_HOME, "config.toml")), false);
  assert.match(
    fs.readFileSync(path.join(sourceHome, "config.toml"), "utf8"),
    /ollama/,
  );
  assert.equal(
    runtime.codexEnvironment(path.join(root, "runtime"), {
      CODEX_HOME: sourceHome,
    }).CODEX_HOME,
    env.CODEX_HOME,
  );
});

test("Codex catalog preserves full upstream names and new model IDs", async () => {
  const agents = new Agents(() => {});
  agents.codex.models = async () => [
    { model: "gpt-6.1-sol", displayName: "GPT-6.1-Sol", isDefault: true },
    { model: "gpt-6-sol", displayName: "GPT-6-Sol" },
    { model: "gpt-6-luna", displayName: "GPT-6-Luna" },
    { model: "gpt-5.6-terra" },
  ];
  const catalog = await agents.catalog("codex");
  assert.deepEqual(
    catalog.models.map((m) => m.name),
    ["GPT-6.1-Sol", "GPT-6-Sol", "GPT-6-Luna", "gpt-5.6-terra"],
  );
  assert.equal(catalog.defaultModel, "gpt-6.1-sol");
});

test("Disconnected Codex never advertises obsolete fallback models", async () => {
  const agents = new Agents(() => {});
  agents.codex.models = async () => {
    throw Error("offline");
  };
  const catalog = await agents.catalog("codex");
  assert.equal(catalog.connected, false);
  assert.deepEqual(catalog.models, []);
  assert.equal(catalog.error, "offline");
});

test("Codex picker waits for discovered models instead of hardcoding old IDs", () => {
  const picker = fs.readFileSync(
    new URL("../src/AiPicker.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(picker, /gpt-6-astra|gpt-5\.6-sol/);
  assert.match(picker, /\["ollama", "codex"\]\.includes\(value.provider\)/);
});
