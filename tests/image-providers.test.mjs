import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { Ollama } from "../server/ollama.mjs";

function local(info) {
  const calls = [];
  const agent = new Ollama(
    () => {},
    path.join(os.homedir(), ".hermes/cache/scratch"),
    async (url, options) => {
      calls.push({ url, body: options?.body });
      return Response.json(info);
    },
  );
  agent.selected = true;
  agent.catalog = async () => ({ models: [{ id: "fixture-model" }] });
  let dispatched = 0;
  agent.runTurn = async () => {
    dispatched++;
  };
  return { agent, calls, dispatched: () => dispatched };
}
test("Ollama rejects unsupported or unverified vision without dispatching pixels", async () => {
  for (const info of [{ capabilities: ["completion"] }, {}]) {
    const f = local(info);
    await assert.rejects(
      () =>
        f.agent.turn(
          { id: "project", path: "/unused" },
          "ask",
          "describe",
          "fixture-model",
          [{ images: [{ data: "fixture-pixels" }] }],
        ),
      /vision|gambar tidak dikirim/i,
    );
    assert.equal(f.dispatched(), 0);
    assert.equal(f.agent.active, null);
    assert.ok(f.calls.every((c) => !String(c.body).includes("fixture-pixels")));
  }
});
test("Ollama verifies installed vision using metadata only, retaining legacy projector support", async () => {
  for (const info of [
    { capabilities: ["completion", "vision"] },
    { projector_info: { architecture: "clip" } },
    { model_info: { "clip.vision.image_size": 224 } },
  ]) {
    const f = local(info);
    await f.agent.turn(
      { id: "project", path: "/unused" },
      "ask",
      "describe",
      "fixture-model",
      [{ images: [{ data: "fixture-pixels" }] }],
    );
    assert.equal(f.dispatched(), 1);
    assert.ok(f.calls[0].url.endsWith("/api/show"));
    assert.deepEqual(JSON.parse(f.calls[0].body), { model: "fixture-model" });
  }
});
