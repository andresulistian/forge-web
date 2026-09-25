import test from "node:test";
import assert from "node:assert/strict";
import { Codex } from "../server/codex.mjs";
import { Gemini } from "../server/gemini.mjs";
import { Agents } from "../server/agents.mjs";
import { Ollama } from "../server/ollama.mjs";
import { Store } from "../server/store.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("Codex switches Astra to Sol on the same conversation", async () => {
  const c = new Codex(() => {}),
    calls = [];
  c.connect = async () => ({});
  c.request = async (method, params) => {
    calls.push({ method, params });
    return method === "thread/start"
      ? { thread: { id: "t" } }
      : { turn: { id: "x" } };
  };
  const p = { id: "p", path: "/tmp/project" };
  await c.turn(p, "build", "one", "gpt-6-astra");
  c.active = null;
  await c.turn(p, "build", "two", "gpt-5.6-sol");
  const turns = calls.filter((c) => c.method === "turn/start");
  assert.equal(turns[0].params.model, "gpt-6-astra");
  assert.equal(turns[1].params.model, "gpt-5.6-sol");
  assert.equal(turns[0].params.threadId, turns[1].params.threadId);
});
test("Codex general Ask answers directly while project Ask permits read-only inspection", async () => {
  const c = new Codex(() => {}), calls = [];
  c.connect = async () => ({});
  c.request = async (method, params) => {
    calls.push({ method, params });
    return method === "thread/start" ? { thread: { id: "t" } } : { turn: { id: "x" } };
  };
  const project = { id: "p", path: "/tmp/project" };
  await c.turn(project, "ask", "Apakah layanan ini bekerja?", "gpt-5.6-sol");
  c.active = null;
  await c.turn(project, "ask", "Periksa error pada file app.ts", "gpt-5.6-sol");
  const prompts = calls.filter((call) => call.method === "turn/start")
    .map((call) => call.params.input[0].text);
  assert.match(prompts[0], /Do not inspect project files/);
  assert.match(prompts[1], /Use read-only tools/);
});
test("Gemini switches Flash/Pro, streams output, and retains session", async () => {
  const events = [],
    calls = [],
    g = new Gemini((type, payload) => events.push({ type, payload }));
  g.connect = async () => ({});
  g.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "session/new")
      return {
        sessionId: "s",
        modes: { availableModes: [{ id: "default" }, { id: "plan" }] },
      };
    if (method === "session/prompt") {
      g.receive({
        method: "session/update",
        params: {
          sessionId: "s",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Hello" },
          },
        },
      });
      return { stopReason: "end_turn" };
    }
    return {};
  };
  const p = { id: "p", path: "/tmp/project" };
  await g.turn(p, "ask", "hi", "flash");
  await g.completion;
  await g.turn(p, "build", "code", "pro");
  await g.completion;
  assert.equal(calls.filter((c) => c.method === "session/new").length, 1);
  assert.deepEqual(
    calls
      .filter((c) => c.method === "session/set_model")
      .map((c) => c.params.modelId),
    ["flash", "pro"],
  );
  assert.deepEqual(
    calls
      .filter((c) => c.method === "session/set_mode")
      .map((c) => c.params.modeId),
    ["plan", "default"],
  );
  assert.equal(
    events.filter((e) => e.payload.method === "item/completed").length,
    2,
  );
  assert.equal(g.active, null);
  const prompts = calls.filter((call) => call.method === "session/prompt");
  assert.match(prompts[0].params.prompt[0].text, /Do not inspect project files/);
});
test("Gemini read-only fails closed when Plan mode is unavailable", async () => {
  const g = new Gemini(() => {});
  g.session = async () => ({
    sessionId: "s",
    modes: { availableModes: [{ id: "default" }] },
  });
  await assert.rejects(
    () => g.turn({ id: "p" }, "ask", "hi", "flash"),
    /mode aman/,
  );
  assert.equal(g.active, null);
});
test("Gemini accepts only allow_once; refuses Ask permissions and unknown capabilities", () => {
  const g = new Gemini(() => {}),
    sent = [];
  g.send = (m) => sent.push(m);
  g.active = { sessionId: "s", mode: "ask", projectId: "p" };
  const req = {
    id: 1,
    method: "session/request_permission",
    params: {
      sessionId: "s",
      toolCall: { title: "Write" },
      options: [
        { kind: "allow_always", optionId: "always" },
        { kind: "allow_once", optionId: "once" },
      ],
    },
  };
  g.receive(req);
  assert.equal(sent.at(-1).result.outcome.outcome, "cancelled");
  assert.equal(g.approvals.size, 0);
  g.active.mode = "build";
  g.receive({ ...req, id: 2 });
  g.decide("gemini:2", true);
  assert.equal(sent.at(-1).result.outcome.optionId, "once");
  assert.throws(() => g.decide("gemini:2", true));
  g.receive({ id: 3, method: "fs/write_text_file", params: {} });
  assert.equal(sent.at(-1).error.code, -32601);
});
test("provider router rejects unavailable Codex models and dispatches Gemini", async () => {
  const a = new Agents(() => {});
  a.codex.models = async () => [{ model: "gpt-5.6-sol" }];
  await assert.rejects(
    () => a.turn({}, "build", "test", "codex", "gpt-6-astra"),
    /tidak tersedia/,
  );
  let model;
  a.gemini.turn = async (_p, _m, _t, m) => {
    model = m;
  };
  await a.turn({}, "plan", "hi", "gemini", "pro");
  assert.equal(model, "pro");
  await assert.rejects(() => a.turn({}, "ask", "hi", "other"), /Provider/);
});

test("Codex audio is rejected rather than omitted when a model lacks audio support", async () => {
  const a = new Agents(() => {});
  a.codex.models = async () => [
    { model: "gpt-5.6-sol", inputModalities: ["text", "image"] },
  ];
  await assert.rejects(
    () =>
      a.turn({}, "ask", "listen", "codex", "gpt-5.6-sol", [
        { audio: { data: "test" } },
      ]),
    /tidak mengiklankan dukungan audio/,
  );
});

test("Ollama is selected explicitly, remembers locally, sends images, and unloads", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "forge-ollama-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const calls = [],
    events = [];
  const store = await new Store(dir).init();
  t.after(() => store.close());
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/api/tags"))
      return Response.json({ models: [{ model: "qwen3.5:9b-mlx" }] });
    if (url.endsWith("/api/ps")) return Response.json({ models: [] });
    if (url.endsWith("/api/generate")) return Response.json({ done: true });
    if (url.endsWith("/api/chat"))
      return new Response(
        JSON.stringify({ message: { content: "Jawaban lokal" }, done: true }) +
          "\n",
      );
    return new Response("missing", { status: 404 });
  };
  const ollama = new Ollama(
    (type, payload) => events.push({ type, payload }),
    dir,
    fakeFetch,
    store,
  );
  await assert.rejects(
    () => ollama.turn({ id: "p" }, "ask", "hi"),
    /Pilih Local AI/,
  );
  await ollama.select(true, "qwen3.5:9b-mlx");
  const project = { id: "p", path: dir };
  await ollama.turn(project, "ask", "lihat gambar", "qwen3.5:9b-mlx", [
    { images: [{ data: "aW1hZ2U=" }] },
  ]);
  await ollama.completion;
  const chat = calls.find((call) => call.url.endsWith("/api/chat"));
  const body = JSON.parse(chat.options.body);
  assert.deepEqual(body.messages.at(-1).images, ["aW1hZ2U="]);
  assert.equal(await ollama.memoryCount(project), 2);
  await ollama.remember(project, {
    role: "user",
    content: "Preferensi penting: gunakan warna ungu untuk tombol utama.",
  });
  for (let index = 0; index < 12; index++)
    await ollama.remember(project, {
      role: index % 2 ? "assistant" : "user",
      content: `Percakapan umum nomor ${index}.`,
    });
  const recalled = await ollama.memory(project, "Apa preferensi warna tombol?");
  assert.ok(recalled.length <= 10);
  assert.ok(recalled.some((item) => item.content.includes("warna ungu")));
  assert.ok(
    events.some(
      (event) =>
        event.payload.method === "item/completed" &&
        event.payload.params.item.text === "Jawaban lokal",
    ),
  );
  await ollama.select(false);
  const unload = calls.find((call) => call.url.endsWith("/api/generate"));
  assert.equal(JSON.parse(unload.options.body).keep_alive, 0);
});

test("Ollama Build requires one-time approval to write and rejects audio", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "forge-ollama-tools-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const ollama = new Ollama(
    () => {},
    dir,
    async (url) => {
      if (url.endsWith("/api/tags"))
        return Response.json({ models: [{ model: "qwen3.5:9b-mlx" }] });
      if (url.endsWith("/api/ps")) return Response.json({ models: [] });
      return Response.json({ done: true });
    },
  );
  await ollama.select(true);
  await assert.rejects(
    () =>
      ollama.turn({ id: "p", path: dir }, "ask", "dengar", undefined, [
        { audio: { data: "audio" } },
      ]),
    /tidak mendukung audio/,
  );
  ollama.active = {
    projectId: "p",
    mode: "build",
    controller: new AbortController(),
  };
  const writing = ollama.runTool(
    { id: "p", path: dir },
    "build",
    "write_file",
    { file: "hello.txt", content: "aman" },
  );
  for (let i = 0; i < 20 && !ollama.approvals.size; i++)
    await new Promise((resolve) => setTimeout(resolve, 2));
  const approval = [...ollama.approvals.keys()][0];
  assert.match(approval, /^ollama:/);
  ollama.decide(approval, true);
  await writing;
  assert.equal(await fs.readFile(path.join(dir, "hello.txt"), "utf8"), "aman");
  await assert.rejects(
    () =>
      ollama.runTool({ id: "p", path: dir }, "ask", "write_file", {
        file: "no.txt",
        content: "no",
      }),
    /tidak tersedia/,
  );
});

test("Forge Guide keeps separate local history and unloads only after closing", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "forge-guide-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = await new Store(dir).init();
  t.after(() => store.close());
  const calls = [],
    events = [];
  const ollama = new Ollama(
    (type, payload) => events.push({ type, payload }),
    dir,
    async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith("/api/tags"))
        return Response.json({ models: [{ model: "qwen3.5:9b-mlx" }] });
      if (url.endsWith("/api/generate")) return Response.json({ done: true });
      if (url.endsWith("/api/chat"))
        return new Response(
          JSON.stringify({
            message: { content: "PROMPT SIAP SALIN: Buat halaman profil." },
            done: true,
          }) + "\n",
        );
      return Response.json({ models: [] });
    },
    store,
  );
  const project = { id: "guide-project", name: "Palita" };
  await ollama.setGuideEnabled(true);
  await ollama.guideTurn(project, "Rapikan prompt saya", {
    provider: "codex",
    model: "gpt-6-astra",
    mode: "build",
  });
  await ollama.guideCompletion;
  assert.deepEqual(
    (await ollama.guideMessages(project)).map((message) => message.role),
    ["user", "assistant"],
  );
  assert.equal((await ollama.memoryEntries(project)).length, 0);
  const chatBody = JSON.parse(
    calls.find((call) => call.url.endsWith("/api/chat")).options.body,
  );
  assert.equal(chatBody.tools, undefined);
  assert.match(chatBody.messages[0].content, /tidak memiliki akses file/);
  assert.ok(
    events.some(
      (event) => event.type === "guide" && event.payload.kind === "completed",
    ),
  );
  await ollama.select(false);
  assert.equal(
    calls.filter((call) => call.url.endsWith("/api/generate")).length,
    0,
  );
  await ollama.setGuideEnabled(false);
  assert.equal(
    calls.filter((call) => call.url.endsWith("/api/generate")).length,
    1,
  );
  await ollama.clearGuide(project);
  assert.deepEqual(await ollama.guideMessages(project), []);
});
