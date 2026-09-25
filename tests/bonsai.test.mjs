import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { Bonsai } from "../server/bonsai.mjs";
import { Guide } from "../server/guide.mjs";

const model = "/models/Ternary-Bonsai-2-27B-PQ2_0.gguf";

function stream(parts) {
  return new Response(parts.map((part) => `data: ${JSON.stringify({ choices: [{ delta: part }] })}\n\n`).join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } });
}

test("Bonsai discovers llama.cpp model and performs local Ask with streaming and separate memory", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "forge-bonsai-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const calls = [];
  const events = [];
  const bonsai = new Bonsai((type, payload) => events.push({ type, payload }), dir, async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/models")) return Response.json({ data: [{ id: model }] });
    return stream([{ content: "Halo " }, { content: "lokal" }]);
  });
  await bonsai.select(true, "");
  const project = { id: "demo", path: dir };
  assert.equal((await bonsai.catalog(project)).defaultModel, model);
  await bonsai.turn(project, "ask", "Apa kabar?", model);
  await bonsai.completion;
  assert.equal(JSON.parse(calls.find((call) => call.url.endsWith("/chat/completions")).options.body).model, model);
  assert.equal((await bonsai.memoryEntries(project)).at(-1).content, "Halo lokal");
  assert.ok(events.some((entry) => entry.payload.provider === "bonsai" && entry.payload.method === "item/agentMessage/delta"));
  await bonsai.close();
});

test("Bonsai Build uses the same write approval and sends tool result by call id", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "forge-bonsai-build-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const requests = [];
  let bonsai;
  bonsai = new Bonsai((type, payload) => {
    if (type === "approval") queueMicrotask(() => bonsai.decide(payload.id, true));
  }, dir, async (url, options) => {
    if (url.endsWith("/models")) return Response.json({ data: [{ id: model }] });
    const request = JSON.parse(options.body);
    requests.push(request);
    if (request.messages.some((message) => message.role === "tool"))
      return stream([{ content: "File selesai dibuat." }]);
    return stream([
      { tool_calls: [{ index: 0, id: "call_bonsai", function: { name: "write_file", arguments: '{"file":"hello.txt",' } }] },
      { tool_calls: [{ index: 0, function: { arguments: '"content":"Bonsai aktif"}' } }] },
    ]);
  });
  await bonsai.select(true, model);
  await bonsai.turn({ id: "demo", path: dir }, "build", "Buat hello.txt", model);
  await bonsai.completion;
  assert.equal(await fs.readFile(path.join(dir, "hello.txt"), "utf8"), "Bonsai aktif");
  assert.ok(requests[0].tools.some((tool) => tool.function.name === "write_file"));
  assert.equal(requests[1].messages.find((message) => message.role === "tool").tool_call_id, "call_bonsai");
  await bonsai.close();
});

test("Forge Guide can use Bonsai while keeping its existing local history", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "forge-bonsai-guide-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const bonsai = new Bonsai(() => {}, dir, async (url) =>
    url.endsWith("/models") ? Response.json({ data: [{ id: model }] }) : stream([{ content: "Prompt Bonsai" }]));
  const ollama = {
    guideActive: null, guideEnabled: false,
    setGuideEnabled: async () => {}, clearGuide: (project) => bonsai.clearGuide(project),
    guideScope: () => "demo", guideMessages: (project) => bonsai.guideMessages(project),
  };
  const guide = new Guide(ollama, null, () => {}, bonsai);
  await guide.open("bonsai");
  await guide.chat({ id: "demo" }, "Tolong susun prompt", "bonsai", "", {});
  await bonsai.guideCompletion;
  assert.equal((await bonsai.guideMessages({ id: "demo" })).at(-1).provider, "bonsai");
  await guide.clear({ id: "demo" });
  assert.deepEqual(await bonsai.guideMessages({ id: "demo" }), []);
  await guide.close();
});

test("selecting Bonsai starts a missing local server and stops only the server Forge owns", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "forge-bonsai-start-"));
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const oldDir = process.env.FORGE_BONSAI_DIR;
  const oldUrl = process.env.FORGE_BONSAI_URL;
  process.env.FORGE_BONSAI_DIR = root;
  process.env.FORGE_BONSAI_URL = `http://127.0.0.1:${port}/v1`;
  const script = path.join(root, "scripts", "start_llama_server.sh");
  await fs.mkdir(path.dirname(script));
  await fs.writeFile(path.join(root, "server.mjs"), `import http from "node:http";
http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ data: [{ id: "${model}" }] }));
}).listen(${port}, "127.0.0.1");\n`);
  await fs.writeFile(script, `#!/bin/sh\nexec "${process.execPath}" "${path.join(root, "server.mjs")}"\n`);
  const bonsai = new Bonsai(() => {}, root);
  t.after(async () => {
    bonsai.stopServer();
    if (oldDir === undefined) delete process.env.FORGE_BONSAI_DIR;
    else process.env.FORGE_BONSAI_DIR = oldDir;
    if (oldUrl === undefined) delete process.env.FORGE_BONSAI_URL;
    else process.env.FORGE_BONSAI_URL = oldUrl;
    await fs.rm(root, { recursive: true, force: true });
  });
  await bonsai.select(true, "");
  assert.equal((await bonsai.models())[0].id, model);
  assert.ok(bonsai.ownedServer);
  await bonsai.select(false);
  assert.equal(bonsai.ownedServer, null);
});
