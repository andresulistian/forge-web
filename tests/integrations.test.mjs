import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ApiProviders } from "../server/api-providers.mjs";
import { MemoryCredentialStore } from "../server/credentials.mjs";
import { GitHubManager } from "../server/github.mjs";
import { McpManager } from "../server/mcp.mjs";
import { Guide } from "../server/guide.mjs";
import { Codex } from "../server/codex.mjs";
import { Gemini } from "../server/gemini.mjs";

const runGit = promisify(execFile);

class Settings {
  values = new Map();
  setting(scope, key) {
    return this.values.get(`${scope}:${key}`);
  }
  setSetting(scope, key, value) {
    this.values.set(`${scope}:${key}`, value);
  }
}

const testImage = {
  mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=",
};

test("ViKey uses its OpenAI-compatible endpoint without storing the API key", async () => {
  const store = new Settings();
  const credentials = new MemoryCredentialStore();
  const requests = [];
  const providers = new ApiProviders(store, () => {}, {
    credentials,
    fetchImpl: async (url, options) => {
      assert.equal(options.headers.Authorization, "Bearer vikey-secret");
      requests.push(url);
      if (url === "https://api.vikey.ai/v1/models") return Response.json({ data: [{
        id: "deepseek/deepseek-v4.1-flash",
        supported_parameters: ["tools"],
        architecture: { input_modalities: ["text", "image"] },
      }] });
      assert.equal(url, "https://api.vikey.ai/v1/chat/completions");
      const body = JSON.parse(options.body);
      assert.equal(body.model, "deepseek/deepseek-v4.1-flash");
      assert.equal(body.tools, undefined);
      return new Response('data: {"choices":[{"delta":{"content":"ViKey siap"}}]}\n\ndata: [DONE]\n\n');
    },
  });
  const discovered = await providers.discover({ type: "vikey", apiKey: "vikey-secret" });
  assert.equal(discovered.models[0].tools, true);
  assert.equal(discovered.models[0].vision, true);
  const config = await providers.save({
    type: "vikey",
    apiKey: "vikey-secret",
    defaultModel: discovered.models[0].id,
    models: [discovered.models[0].id],
    toolModels: [discovered.models[0].id],
    imageModels: [discovered.models[0].id],
  });
  assert.equal(config.baseUrl, "https://api.vikey.ai/v1");
  assert.equal(JSON.stringify(store.setting("global", "api-providers")).includes("vikey-secret"), false);
  assert.equal((await providers.catalog(config.id)).capabilities.build, true);
  assert.equal(await providers.turn(
    { id: "vikey-project" },
    "ask",
    "Halo",
    config.id,
    discovered.models[0].id,
  ), "ViKey siap");
  assert.deepEqual(requests, [
    "https://api.vikey.ai/v1/models",
    "https://api.vikey.ai/v1/chat/completions",
  ]);
});

test("custom API provider stores the secret separately and streams Ask", async () => {
  const store = new Settings();
  const credentials = new MemoryCredentialStore();
  const events = [];
  const fetchImpl = async (_url, options) => {
    assert.equal(options.headers.Authorization, "Bearer sk-test");
    if (_url.endsWith("/models"))
      return Response.json({ data: [{ id: "openai/gpt-test", supported_parameters: [] }] });
    const body = JSON.parse(options.body);
    assert.equal(body.model, "openai/gpt-test");
    assert.match(body.messages.at(-1).content, /https:\/\/example.org\/evidence/);
    assert.match(body.messages[0].content, /Forge is the application's name/);
    return new Response(
      'data: {"choices":[{"delta":{"content":"CODEX "}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"OK"}}]}\n\n' +
        "data: [DONE]\n\n",
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  };
  const providers = new ApiProviders(store, (...event) => events.push(event), {
    fetchImpl,
    credentials,
  });
  const config = await providers.save({
    type: "openrouter",
    label: "My Router",
    apiKey: "sk-test",
    defaultModel: "openai/gpt-test",
  });
  assert.equal(config.hasCredential, true);
  assert.equal(JSON.stringify(store.setting("global", "api-providers")).includes("sk-test"), false);
  assert.equal((await providers.catalog(config.id)).capabilities.build, false);
  const answer = await providers.turn(
    { id: "project-1" },
    "ask",
    "test",
    config.id,
    "openai/gpt-test",
    [],
    "\nWeb [1] https://example.org/evidence",
  );
  assert.equal(answer, "CODEX OK");
  assert.ok(events.some(([, payload]) => payload.method === "item/agentMessage/delta"));
  await assert.rejects(
    providers.turn({ id: "project-1" }, "build", "edit", config.id),
    /tidak mengiklankan dukungan tool calling/,
  );
});

test("OpenRouter tool-capable model builds with approval and tool results", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "forge-openrouter-build-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Settings();
  const credentials = new MemoryCredentialStore();
  const requests = [];
  const events = [];
  let providers;
  providers = new ApiProviders(store, (type, payload) => {
    events.push({ type, payload });
    if (type === "approval") queueMicrotask(() => providers.decide(payload.id, true));
  }, {
    credentials,
    fetchImpl: async (url, options) => {
      if (url.endsWith("/models")) return Response.json({ data: [
        { id: "openai/gpt-tools", supported_parameters: ["tools", "tool_choice"] },
      ] });
      const request = JSON.parse(options.body);
      requests.push(request);
      if (request.messages.some((message) => message.role === "tool"))
        return new Response('data: {"choices":[{"delta":{"content":"Build selesai."}}]}\n\ndata: [DONE]\n\n');
      return new Response(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_router","function":{"name":"write_file","arguments":"{\\"file\\":\\"hello.txt\\","}}]}}]}\n\n' +
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"content\\":\\"OpenRouter aktif\\"}"}}]}}]}\n\n' +
        'data: [DONE]\n\n',
      );
    },
  });
  const config = await providers.save({
    type: "openrouter",
    apiKey: "sk-test",
    defaultModel: "openai/gpt-tools",
    models: ["openai/gpt-tools"],
    toolModels: ["openai/gpt-tools"],
  });
  assert.equal((await providers.catalog(config.id)).capabilities.build, true);
  const answer = await providers.turn(
    { id: "project-build", path: dir },
    "build",
    "Buat hello.txt",
    config.id,
    "openai/gpt-tools",
  );
  assert.equal(answer, "Build selesai.");
  assert.equal(await readFile(path.join(dir, "hello.txt"), "utf8"), "OpenRouter aktif");
  assert.ok(requests[0].tools.some((item) => item.function.name === "write_file"));
  assert.equal(
    requests[1].messages.find((message) => message.role === "tool").tool_call_id,
    "call_router",
  );
  assert.ok(events.some((event) => event.type === "approval"));
  assert.ok(events.some((event) => event.payload.method === "turn/completed" && event.payload.params.turn.status === "completed"));
});

test("OpenRouter stops repeated tool loops and returns partial work for review", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "forge-openrouter-loop-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, "index.html"), "start");
  const store = new Settings();
  const credentials = new MemoryCredentialStore();
  const requests = [];
  const events = [];
  const providers = new ApiProviders(store, (type, payload) => events.push({ type, payload }), {
    credentials,
    fetchImpl: async (url, options) => {
      if (url.endsWith("/models")) return Response.json({ data: [
        { id: "deepseek/loop-test", supported_parameters: ["tools"] },
      ] });
      const request = JSON.parse(options.body);
      requests.push(request);
      if (!request.tools)
        return new Response('data: {"choices":[{"delta":{"content":"Pekerjaan parsial dirangkum."}}]}\n\ndata: [DONE]\n\n');
      const id = `call_${requests.length}`;
      return new Response(
        `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"${id}","function":{"name":"list_files","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n`,
      );
    },
  });
  const config = await providers.save({
    type: "openrouter",
    apiKey: "sk-test",
    defaultModel: "deepseek/loop-test",
    models: ["deepseek/loop-test"],
    toolModels: ["deepseek/loop-test"],
  });
  const answer = await providers.turn(
    { id: "loop-project", path: dir },
    "build",
    "Kerjakan perubahan",
    config.id,
    "deepseek/loop-test",
  );
  assert.match(answer, /Pekerjaan parsial dirangkum/);
  assert.match(answer, /Perubahan parsial tersedia di tab Review/);
  assert.equal(requests.length, 4);
  assert.equal(requests.at(-1).tools, undefined);
  assert.ok(events.some((event) => event.payload.method === "tool/budgetWarning" && event.payload.params.forced));
  assert.ok(events.some((event) => event.payload.method === "turn/completed" && event.payload.params.turn.status === "partial"));
});

test("OpenRouter discovers exact model IDs and offers several selected models in chat", async () => {
  const store = new Settings();
  const credentials = new MemoryCredentialStore();
  const seen = [];
  const providers = new ApiProviders(store, () => {}, {
    credentials,
    fetchImpl: async (url, options) => {
      assert.equal(options.headers.Authorization, "Bearer sk-test");
      if (url.endsWith("/models")) return Response.json({ data: [
        { id: "deepseek/deepseek-v4-pro-0813", name: "DeepSeek V4 Pro" },
        { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
      ] });
      seen.push(JSON.parse(options.body).model);
      return new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\n', { status: 200 });
    },
  });
  const discovered = await providers.discover({ type: "openrouter", apiKey: "sk-test" });
  assert.equal(discovered.models[0].id, "deepseek/deepseek-v4-pro-0813");
  const config = await providers.save({
    type: "openrouter", apiKey: "sk-test", defaultModel: discovered.models[0].id,
    models: discovered.models.map((model) => model.id),
  });
  assert.deepEqual((await providers.catalog(config.id)).models.map((model) => model.id),
    discovered.models.map((model) => model.id));
  assert.equal((await providers.test(config.id)).ok, true);
  await providers.turn({ id: "project-1" }, "ask", "Hi", config.id, discovered.models[1].id);
  assert.deepEqual(seen, ["deepseek/deepseek-v4.1-flash"]);
  await assert.rejects(providers.turn({ id: "project-1" }, "ask", "Hi", config.id, "Deepseek v4 pro"), /belum ditambahkan/);
});

test("OpenRouter sends uploaded images as multimodal content and detects vision models", async () => {
  const store = new Settings();
  const credentials = new MemoryCredentialStore();
  const requests = [];
  const providers = new ApiProviders(store, () => {}, {
    credentials,
    fetchImpl: async (url, options) => {
      if (url.endsWith("/models")) return Response.json({ data: [{
        id: "openai/vision-test",
        architecture: { input_modalities: ["text", "image"] },
        supported_parameters: [],
      }] });
      requests.push(JSON.parse(options.body));
      return new Response('data: {"choices":[{"delta":{"content":"Gambar terlihat"}}]}\n\ndata: [DONE]\n\n');
    },
  });
  const config = await providers.save({
    type: "openrouter",
    apiKey: "sk-test",
    defaultModel: "openai/vision-test",
  });
  const answer = await providers.turn(
    { id: "vision-project" },
    "ask",
    "Ini logonya",
    config.id,
    "openai/vision-test",
    [],
    "\nWeb context",
    [{ id: "11111111-1111-1111-1111-111111111111", kind: "image", name: "logo.png", images: [testImage] }],
  );
  assert.equal(answer, "Gambar terlihat");
  const content = requests[0].messages.at(-1).content;
  assert.equal(Array.isArray(content), true);
  assert.match(content[0].text, /Ini logonya/);
  assert.match(content[0].text, /IMAGE: logo.png/);
  assert.match(content[0].text, /Web context/);
  assert.deepEqual(content[1], {
    type: "image_url",
    image_url: { url: `data:image/png;base64,${testImage.data}` },
  });
  assert.equal(
    store.setting("global", "api-providers")[0].imageModels.includes("openai/vision-test"),
    true,
  );
  assert.equal((await providers.catalog(config.id)).models[0].capabilities.image, true);
});

test("OpenRouter rejects an image before chat when the model is text-only", async () => {
  const store = new Settings();
  const credentials = new MemoryCredentialStore();
  let chatRequests = 0;
  const providers = new ApiProviders(store, () => {}, {
    credentials,
    fetchImpl: async (url) => {
      if (url.endsWith("/models")) return Response.json({ data: [{
        id: "deepseek/text-only",
        architecture: { input_modalities: ["text"] },
      }] });
      chatRequests++;
      throw Error("chat should not be called");
    },
  });
  const config = await providers.save({
    type: "openrouter",
    apiKey: "sk-test",
    defaultModel: "deepseek/text-only",
  });
  await assert.rejects(
    providers.turn(
      { id: "text-project" }, "ask", "Lihat", config.id, "deepseek/text-only", [], "",
      [{ id: "22222222-2222-2222-2222-222222222222", kind: "image", name: "logo.png", images: [testImage] }],
    ),
    /tidak mengiklankan dukungan input gambar/,
  );
  assert.equal(chatRequests, 0);
});

test("Anthropic sends uploaded images using native base64 source blocks", async () => {
  const store = new Settings();
  const credentials = new MemoryCredentialStore();
  let request;
  const providers = new ApiProviders(store, () => {}, {
    credentials,
    fetchImpl: async (url, options) => {
      if (url.endsWith("/v1/models"))
        return Response.json({ data: [{ id: "claude-sonnet-test", display_name: "Claude Test" }] });
      assert.equal(options.headers["x-api-key"], "sk-test");
      request = JSON.parse(options.body);
      return new Response('data: {"type":"content_block_delta","delta":{"text":"Logo diterima"}}\n\n');
    },
  });
  const config = await providers.save({
    type: "anthropic",
    apiKey: "sk-test",
    defaultModel: "claude-sonnet-test",
  });
  const answer = await providers.turn(
    { id: "anthropic-project" }, "ask", "Analisis logo", config.id, "claude-sonnet-test", [], "",
    [{ id: "33333333-3333-3333-3333-333333333333", kind: "image", name: "brand.png", images: [testImage] }],
  );
  assert.equal(answer, "Logo diterima");
  assert.deepEqual(request.messages.at(-1).content[1], {
    type: "image",
    source: {
      type: "base64",
      media_type: "image/png",
      data: testImage.data,
    },
  });
});

test("OpenRouter Build can safely copy a current image attachment into the project", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "forge-attachment-copy-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Settings();
  const credentials = new MemoryCredentialStore();
  const attachment = {
    id: "44444444-4444-4444-4444-444444444444",
    kind: "image",
    name: "logo.png",
    images: [testImage],
  };
  let calls = 0;
  let providers;
  providers = new ApiProviders(store, (type, payload) => {
    if (type === "approval") queueMicrotask(() => providers.decide(payload.id, true));
  }, {
    credentials,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      calls++;
      if (calls === 1) {
        assert.ok(body.tools.some((entry) => entry.function.name === "copy_attachment_to_project"));
        return new Response(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"copy_1","function":{"name":"copy_attachment_to_project","arguments":"{\\"attachmentId\\":\\"44444444-4444-4444-4444-444444444444\\",\\"file\\":\\"public/logo.png\\"}"}}]}}]}\n\ndata: [DONE]\n\n',
        );
      }
      return new Response('data: {"choices":[{"delta":{"content":"Logo disalin."}}]}\n\ndata: [DONE]\n\n');
    },
  });
  const config = await providers.save({
    type: "openrouter",
    apiKey: "sk-test",
    defaultModel: "openai/build-vision",
    toolModels: ["openai/build-vision"],
    imageModels: ["openai/build-vision"],
  });
  const answer = await providers.turn(
    { id: "copy-project", path: dir }, "build", "Pakai logo", config.id,
    "openai/build-vision", [], "", [attachment],
  );
  assert.equal(answer, "Logo disalin.");
  assert.deepEqual(await readFile(path.join(dir, "public/logo.png")), Buffer.from(testImage.data, "base64"));
  await assert.rejects(
    providers.runTool(
      { id: "copy-project", path: dir }, "build", config,
      "copy_attachment_to_project", { attachmentId: attachment.id, file: "../escape.png" }, [attachment],
    ),
    /tidak diizinkan|di luar proyek/,
  );
  await assert.rejects(
    providers.runTool(
      { id: "copy-project", path: dir }, "build", config,
      "copy_attachment_to_project", { attachmentId: "missing", file: "public/missing.png" }, [attachment],
    ),
    /tidak ditemukan/,
  );
});

test("Forge Guide switches from local AI to a selected OpenRouter model with shared history", async () => {
  const credentials = new MemoryCredentialStore();
  const requests = [];
  const events = [];
  const providers = new ApiProviders(new Settings(), () => {}, {
    credentials,
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return new Response('data: {"choices":[{"delta":{"content":"Prompt siap salin"}}]}\n\n', { status: 200 });
    },
  });
  const saved = await providers.save({
    type: "openrouter", apiKey: "sk-test", defaultModel: "deepseek/pro",
    models: ["deepseek/pro", "deepseek/flash"],
  });
  const history = [{ role: "user", text: "Ide aplikasi saya" }];
  const ollama = {
    guideEnabled: false,
    guideActive: null,
    guideScope: (project) => project?.id || "general",
    setGuideEnabled: async (enabled) => { ollama.guideEnabled = enabled; },
    guideMessages: async () => history,
    guideRemember: async (_project, entry) => history.push(entry),
    clearGuide: async () => { history.length = 0; },
    guideTurn: async () => { throw Error("Local AI should not be called"); },
  };
  const guide = new Guide(ollama, providers, (...event) => events.push(event));
  await guide.open("ollama");
  assert.equal(ollama.guideEnabled, true);
  await guide.open(`api:${saved.id}`);
  assert.equal(ollama.guideEnabled, false);
  await assert.rejects(
    guide.chat({ id: "project-1" }, "Hello", `api:${saved.id}`, "Deepseek Pro", {}),
    /belum dipilih/,
  );
  await guide.chat({ id: "project-1", name: "Palita" }, "Buat prompt", `api:${saved.id}`, "deepseek/flash", { mode: "build" });
  await guide.completion;
  assert.equal(requests[0].model, "deepseek/flash");
  assert.ok(requests[0].messages.some((message) => message.content === "Ide aplikasi saya"));
  assert.equal(history.at(-1).provider, `api:${saved.id}`);
  assert.equal(events.at(-1)[1].kind, "completed");
  await guide.clear({ id: "project-1" });
  assert.equal(history.length, 0);
  await guide.close();
});

test("API provider rejects insecure endpoints", async () => {
  const providers = new ApiProviders(new Settings(), () => {}, {
    credentials: new MemoryCredentialStore(),
  });
  await assert.rejects(
    providers.save({
      type: "anthropic",
      apiKey: "secret",
      baseUrl: "http://localhost:9000",
      defaultModel: "claude-test",
    }),
    /HTTPS/,
  );
});

test("GitHub import validates owner/repository before invoking gh", async () => {
  let invoked = false;
  const github = new GitHubManager("/tmp/forge-projects", () => {}, {
    exec: async () => {
      invoked = true;
      return { stdout: "", stderr: "" };
    },
  });
  await assert.rejects(github.clone("https://github.com/acme/app"), /owner\/nama/);
  assert.equal(invoked, false);
});

test("GitHub Sync / Pull fast forwards and refuses dirty or diverged work", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "forge-pull-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const git = (...args) => runGit("git", args, { cwd: dir });
  const bare = path.join(dir, "remote.git");
  const first = path.join(dir, "first");
  const second = path.join(dir, "second");
  await git("init", "--bare", bare);
  await git("clone", bare, first);
  const inRepo = (cwd, ...args) => runGit("git", args, { cwd });
  for (const cwd of [first]) {
    await inRepo(cwd, "config", "user.name", "Forge Test");
    await inRepo(cwd, "config", "user.email", "forge@example.test");
  }
  await writeFile(path.join(first, "app.txt"), "v1");
  await inRepo(first, "add", "app.txt");
  await inRepo(first, "commit", "-m", "start");
  await inRepo(first, "push", "origin", "HEAD");
  await git("clone", bare, second);
  await inRepo(second, "config", "user.name", "Forge Test");
  await inRepo(second, "config", "user.email", "forge@example.test");
  await writeFile(path.join(first, "app.txt"), "v2");
  await inRepo(first, "commit", "-am", "update");
  await inRepo(first, "push", "origin", "HEAD");
  const manager = new GitHubManager(dir, () => {});
  const project = { id: "second", path: second };
  await writeFile(path.join(second, "local.txt"), "pending");
  await assert.rejects(manager.pull(project), /belum di-commit/);
  await rm(path.join(second, "local.txt"));
  assert.equal((await manager.pull(project)).commits, 1);
  assert.equal(await readFile(path.join(second, "app.txt"), "utf8"), "v2");
  assert.equal((await manager.pull(project)).commits, 0);
  await writeFile(path.join(second, "app.txt"), "local");
  await inRepo(second, "commit", "-am", "local");
  await writeFile(path.join(first, "app.txt"), "remote");
  await inRepo(first, "commit", "-am", "remote");
  await inRepo(first, "push", "origin", "HEAD");
  await assert.rejects(manager.pull(project), /berbeda/);
  assert.equal(await readFile(path.join(second, "app.txt"), "utf8"), "local");
});

test("usage display uses Codex quota windows and Gemini context updates", async () => {
  const codex = new Codex(() => {});
  codex.connect = async () => {};
  codex.request = async () => ({ rateLimits: {
    limitId: "codex", primary: { usedPercent: 25, windowDurationMins: 60, resetsAt: 1234 },
  } });
  assert.deepEqual(await codex.rateLimits(), [{
    id: "codex", name: "codex", window: "primary", remainingPercent: 75,
    windowDurationMins: 60, resetsAt: 1234,
  }]);
  const gemini = new Gemini(() => {});
  gemini.active = { projectId: "p1", sessionId: "s1", text: "" };
  gemini.receive({ method: "session/update", params: {
    sessionId: "s1", update: { sessionUpdate: "usage_update", size: 1000, used: 300 },
  } });
  assert.deepEqual(gemini.contextUsage("p1"), { used: 300, size: 1000 });
  assert.equal(gemini.contextUsage("p2"), null);
});

test("MCP configuration is scoped and invokes stdio without a shell", async () => {
  const store = new Settings();
  let spawnCall;
  const spawnImpl = (command, args, options) => {
    spawnCall = { command, args, options };
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      write(line) {
        const request = JSON.parse(line);
        if (!request.id) return;
        const result =
          request.method === "tools/list"
            ? { tools: [{ name: "read_docs", description: "Read docs" }] }
            : request.method === "resources/list"
              ? { resources: [] }
              : request.method === "prompts/list"
                ? { prompts: [] }
                : { protocolVersion: "2025-06-18", capabilities: {} };
        queueMicrotask(() =>
          child.stdout.emit(
            "data",
            Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n"),
          ),
        );
      },
    };
    child.kill = () => true;
    return child;
  };
  const mcp = new McpManager(store, () => {}, { spawnImpl });
  const saved = mcp.save({
    name: "Docs",
    command: "npx",
    args: ["-y", "@example/docs-mcp"],
    scope: "project",
    projectId: "project-1",
  });
  await assert.rejects(mcp.test(saved.id, { id: "other", path: "/tmp" }), /hanya tersedia/);
  const tested = await mcp.test(saved.id, { id: "project-1", path: "/tmp" });
  assert.equal(spawnCall.command, "npx");
  assert.equal(spawnCall.options.shell, false);
  assert.deepEqual(tested.capabilities.tools.map((tool) => tool.name), ["read_docs"]);
});
