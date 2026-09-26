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

test("custom API provider stores the secret separately and streams Ask", async () => {
  const store = new Settings();
  const credentials = new MemoryCredentialStore();
  const events = [];
  const fetchImpl = async (_url, options) => {
    assert.equal(options.headers.Authorization, "Bearer sk-test");
    if (_url.endsWith("/models"))
      return Response.json({
        data: [{ id: "openai/gpt-test", supported_parameters: [] }],
      });
    const body = JSON.parse(options.body);
    assert.equal(body.model, "openai/gpt-test");
    assert.match(
      body.messages.at(-1).content,
      /https:\/\/example.org\/evidence/,
    );
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
  assert.equal(
    JSON.stringify(store.setting("global", "api-providers")).includes(
      "sk-test",
    ),
    false,
  );
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
  assert.ok(
    events.some(([, payload]) => payload.method === "item/agentMessage/delta"),
  );
  await assert.rejects(
    providers.turn({ id: "project-1" }, "build", "edit", config.id),
    /tidak mendukung tool calling/,
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
  providers = new ApiProviders(
    store,
    (type, payload) => {
      events.push({ type, payload });
      if (type === "approval")
        queueMicrotask(() => providers.decide(payload.id, true));
    },
    {
      credentials,
      fetchImpl: async (url, options) => {
        if (url.endsWith("/models"))
          return Response.json({
            data: [
              {
                id: "openai/gpt-tools",
                supported_parameters: ["tools", "tool_choice"],
              },
            ],
          });
        const request = JSON.parse(options.body);
        requests.push(request);
        if (request.messages.some((message) => message.role === "tool"))
          return new Response(
            'data: {"choices":[{"delta":{"content":"Build selesai."}}]}\n\ndata: [DONE]\n\n',
          );
        return new Response(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_router","function":{"name":"write_file","arguments":"{\\"file\\":\\"hello.txt\\","}}]}}]}\n\n' +
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"content\\":\\"OpenRouter aktif\\"}"}}]}}]}\n\n' +
            "data: [DONE]\n\n",
        );
      },
    },
  );
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
  assert.equal(
    await readFile(path.join(dir, "hello.txt"), "utf8"),
    "OpenRouter aktif",
  );
  assert.ok(
    requests[0].tools.some((item) => item.function.name === "write_file"),
  );
  assert.equal(
    requests[1].messages.find((message) => message.role === "tool")
      .tool_call_id,
    "call_router",
  );
  assert.ok(events.some((event) => event.type === "approval"));
  assert.ok(
    events.some(
      (event) =>
        event.payload.method === "turn/completed" &&
        event.payload.params.turn.status === "completed",
    ),
  );
});

test("Vikey is a dedicated provider with API key, model discovery, and Build tools", async () => {
  const store = new Settings();
  const credentials = new MemoryCredentialStore();
  const requests = [];
  const providers = new ApiProviders(store, () => {}, {
    credentials,
    fetchImpl: async (url, options) => {
      assert.match(url, /^https:\/\/api\.vikey\.ai\/v1\//);
      assert.equal(options.headers.Authorization, "Bearer vk-test");
      if (url.endsWith("/models"))
        return Response.json({
          data: [
            {
              id: "deepseek-v3",
              name: "DeepSeek V3",
              architecture: { input_modalities: ["text"] },
            },
          ],
        });
      requests.push(JSON.parse(options.body));
      return new Response(
        'data: {"choices":[{"delta":{"content":"Vikey siap."}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  const discovered = await providers.discover({
    type: "vikey",
    apiKey: "vk-test",
  });
  assert.equal(discovered.models[0].tools, true);
  assert.deepEqual(discovered.models[0].inputModalities, ["text", "image"]);
  const config = await providers.save({
    type: "vikey",
    apiKey: "vk-test",
    defaultModel: "deepseek-v3",
    models: ["deepseek-v3"],
    toolModels: ["deepseek-v3"],
  });
  assert.equal(config.baseUrl, "https://api.vikey.ai/v1");
  assert.equal(config.hasCredential, true);
  assert.equal((await providers.catalog(config.id)).capabilities.build, true);
  await providers.turn(
    { id: "vikey-project", path: tmpdir() },
    "ask",
    "Halo",
    config.id,
    "deepseek-v3",
  );
  assert.ok(
    requests[0].tools.some((item) => item.function.name === "read_file"),
  );
  await providers.turn(
    { id: "vikey-project", path: tmpdir() },
    "build",
    "Gunakan logo ini",
    config.id,
    "deepseek-v3",
    [],
    "",
    [{ images: [{ mimeType: "image/png", data: "bG9nbw==" }] }],
  );
  const multimodal = requests[1].messages.at(-1).content;
  assert.equal(multimodal[0].type, "text");
  assert.equal(multimodal[1].type, "image_url");
  assert.equal(multimodal[1].image_url.url, "data:image/png;base64,bG9nbw==");
  assert.equal(
    JSON.stringify(store.setting("global", "api-providers")).includes(
      "vk-test",
    ),
    false,
  );
});

test("Vikey multi-agent runs separate Explorer, Builder, and Reviewer calls", async () => {
  const store = new Settings();
  const credentials = new MemoryCredentialStore();
  const requests = [];
  const events = [];
  const providers = new ApiProviders(
    store,
    (type, payload) => events.push({ type, payload }),
    {
      credentials,
      fetchImpl: async (url, options) => {
        if (url.endsWith("/models"))
          return Response.json({ data: [{ id: "team-model" }] });
        const request = JSON.parse(options.body);
        requests.push(request);
        const system = request.messages[0].content;
        const answer = system.includes("Explorer sub-agent")
          ? "Explorer report"
          : system.includes("independent Reviewer")
            ? "Reviewer verified"
            : "Builder completed";
        return new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\ndata: [DONE]\n\n`,
        );
      },
    },
  );
  const config = await providers.save({
    type: "vikey",
    apiKey: "vk-team",
    defaultModel: "team-model",
    models: ["team-model"],
    toolModels: ["team-model"],
  });
  const answer = await providers.turn(
    { id: "team-project", path: tmpdir() },
    "build",
    "Perbaiki proyek",
    config.id,
    "team-model",
    [],
    "",
    [],
    "Perbaiki proyek",
    true,
  );
  assert.equal(requests.length, 3);
  assert.match(requests[0].messages[0].content, /Explorer sub-agent/);
  assert.match(
    requests[1].messages[0].content,
    /Builder in a Forge multi-agent team/,
  );
  assert.match(requests[2].messages[0].content, /independent Reviewer/);
  assert.match(answer, /Builder completed/);
  assert.match(answer, /Reviewer verified/);
  assert.ok(
    events.some(
      (event) =>
        event.type === "agent-team" &&
        event.payload.role === "reviewer" &&
        event.payload.status === "completed",
    ),
  );
});

test("OpenRouter forwards images when a compatible catalog under-reports modalities", async () => {
  const store = new Settings();
  const credentials = new MemoryCredentialStore();
  const requests = [];
  const model = "openai/future-model";
  const providers = new ApiProviders(store, () => {}, {
    credentials,
    fetchImpl: async (url, options) => {
      if (url.endsWith("/models"))
        return Response.json({
          data: [
            {
              id: model,
              supported_parameters: ["tools"],
              architecture: { input_modalities: ["text"] },
            },
          ],
        });
      requests.push(JSON.parse(options.body));
      return new Response(
        'data: {"choices":[{"delta":{"content":"Gambar diterima."}}]}\n\ndata: [DONE]\n\n',
      );
    },
  });
  const config = await providers.save({
    type: "openrouter",
    apiKey: "sk-test",
    defaultModel: model,
    models: [model],
  });
  const discovered = await providers.discover(config);
  assert.deepEqual(discovered.models[0].inputModalities, ["text", "image"]);
  await providers.turn(
    { id: "openrouter-image-fallback", path: tmpdir() },
    "build",
    "Gunakan gambar ini",
    config.id,
    model,
    [],
    "",
    [{ images: [{ mimeType: "image/png", data: "aW1hZ2U=" }] }],
  );
  assert.equal(requests[0].messages.at(-1).content[1].type, "image_url");
});

test("OpenRouter Flash Build receives links, images, audio, web context, and agent tools", async () => {
  const store = new Settings();
  const credentials = new MemoryCredentialStore();
  const requests = [];
  const model = "deepseek/deepseek-v4.1-flash";
  const providers = new ApiProviders(store, () => {}, {
    credentials,
    fetchImpl: async (url, options) => {
      if (url.endsWith("/models"))
        return Response.json({
          data: [
            {
              id: model,
              supported_parameters: ["tools", "tool_choice"],
              architecture: { input_modalities: ["text", "image", "audio"] },
            },
          ],
        });
      const request = JSON.parse(options.body);
      requests.push(request);
      return new Response(
        'data: {"choices":[{"delta":{"content":"Siap membangun."}}]}\n\ndata: [DONE]\n\n',
      );
    },
  });
  const config = await providers.save({
    type: "openrouter",
    apiKey: "sk-test",
    defaultModel: model,
    models: [model],
  });
  const discovered = await providers.discover(config);
  assert.equal(discovered.models[0].tools, true);
  assert.deepEqual(discovered.models[0].inputModalities, [
    "text",
    "image",
    "audio",
  ]);
  await providers.turn(
    { id: "project-flash", path: tmpdir() },
    "build",
    "Baca link ini lalu implementasikan.\nREFERENCE LINK: https://example.org/spec",
    config.id,
    model,
    [{ role: "user", text: "Baca link ini lalu implementasikan." }],
    "\nHASIL PENCARIAN WEB: https://example.org/evidence",
    [
      {
        images: [{ mimeType: "image/png", data: "aW1hZ2U=" }],
        audio: { mimeType: "audio/wav", data: "YXVkaW8=" },
      },
    ],
    "Baca link ini lalu implementasikan.",
  );
  const content = requests[0].messages.at(-1).content;
  assert.equal(content[0].type, "text");
  assert.match(content[0].text, /REFERENCE LINK: https:\/\/example.org\/spec/);
  assert.match(content[0].text, /HASIL PENCARIAN WEB/);
  assert.equal(content[1].type, "image_url");
  assert.match(content[1].image_url.url, /^data:image\/png;base64,/);
  assert.deepEqual(content[2], {
    type: "input_audio",
    input_audio: { data: "YXVkaW8=", format: "wav" },
  });
  assert.ok(
    requests[0].tools.some((item) => item.function.name === "write_file"),
  );
  assert.ok(
    requests[0].tools.some((item) => item.function.name === "run_command"),
  );
});

test("OpenRouter discovers exact model IDs and offers several selected models in chat", async () => {
  const store = new Settings();
  const credentials = new MemoryCredentialStore();
  const seen = [];
  const providers = new ApiProviders(store, () => {}, {
    credentials,
    fetchImpl: async (url, options) => {
      assert.equal(options.headers.Authorization, "Bearer sk-test");
      if (url.endsWith("/models"))
        return Response.json({
          data: [
            { id: "deepseek/deepseek-v4-pro-0813", name: "DeepSeek V4 Pro" },
            { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
          ],
        });
      seen.push(JSON.parse(options.body).model);
      return new Response(
        'data: {"choices":[{"delta":{"content":"OK"}}]}\n\n',
        { status: 200 },
      );
    },
  });
  const discovered = await providers.discover({
    type: "openrouter",
    apiKey: "sk-test",
  });
  assert.equal(discovered.models[0].id, "deepseek/deepseek-v4-pro-0813");
  const config = await providers.save({
    type: "openrouter",
    apiKey: "sk-test",
    defaultModel: discovered.models[0].id,
    models: discovered.models.map((model) => model.id),
  });
  assert.deepEqual(
    (await providers.catalog(config.id)).models.map((model) => model.id),
    discovered.models.map((model) => model.id),
  );
  assert.equal((await providers.test(config.id)).ok, true);
  await providers.turn(
    { id: "project-1" },
    "ask",
    "Hi",
    config.id,
    discovered.models[1].id,
  );
  assert.deepEqual(seen, ["deepseek/deepseek-v4.1-flash"]);
  await assert.rejects(
    providers.turn(
      { id: "project-1" },
      "ask",
      "Hi",
      config.id,
      "Deepseek v4 pro",
    ),
    /belum ditambahkan/,
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
      return new Response(
        'data: {"choices":[{"delta":{"content":"Prompt siap salin"}}]}\n\n',
        { status: 200 },
      );
    },
  });
  const saved = await providers.save({
    type: "openrouter",
    apiKey: "sk-test",
    defaultModel: "deepseek/pro",
    models: ["deepseek/pro", "deepseek/flash"],
  });
  const history = [{ role: "user", text: "Ide aplikasi saya" }];
  const ollama = {
    guideEnabled: false,
    guideActive: null,
    guideScope: (project) => project?.id || "general",
    setGuideEnabled: async (enabled) => {
      ollama.guideEnabled = enabled;
    },
    guideMessages: async () => history,
    guideRemember: async (_project, entry) => history.push(entry),
    clearGuide: async () => {
      history.length = 0;
    },
    guideTurn: async () => {
      throw Error("Local AI should not be called");
    },
  };
  const guide = new Guide(ollama, providers, (...event) => events.push(event));
  await guide.open("ollama");
  assert.equal(ollama.guideEnabled, true);
  await guide.open(`api:${saved.id}`);
  assert.equal(ollama.guideEnabled, false);
  await assert.rejects(
    guide.chat(
      { id: "project-1" },
      "Hello",
      `api:${saved.id}`,
      "Deepseek Pro",
      {},
    ),
    /belum dipilih/,
  );
  await guide.chat(
    { id: "project-1", name: "Palita" },
    "Buat prompt",
    `api:${saved.id}`,
    "deepseek/flash",
    { mode: "build" },
  );
  await guide.completion;
  assert.equal(requests[0].model, "deepseek/flash");
  assert.ok(
    requests[0].messages.some(
      (message) => message.content === "Ide aplikasi saya",
    ),
  );
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
  await assert.rejects(
    github.clone("https://github.com/acme/app"),
    /owner\/nama/,
  );
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
  codex.request = async () => ({
    rateLimits: {
      limitId: "codex",
      primary: { usedPercent: 25, windowDurationMins: 60, resetsAt: 1234 },
    },
  });
  assert.deepEqual(await codex.rateLimits(), [
    {
      id: "codex",
      name: "codex",
      window: "primary",
      remainingPercent: 75,
      windowDurationMins: 60,
      resetsAt: 1234,
    },
  ]);
  const gemini = new Gemini(() => {});
  gemini.active = { projectId: "p1", sessionId: "s1", text: "" };
  gemini.receive({
    method: "session/update",
    params: {
      sessionId: "s1",
      update: { sessionUpdate: "usage_update", size: 1000, used: 300 },
    },
  });
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
            Buffer.from(
              JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n",
            ),
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
  await assert.rejects(
    mcp.test(saved.id, { id: "other", path: "/tmp" }),
    /hanya tersedia/,
  );
  const tested = await mcp.test(saved.id, { id: "project-1", path: "/tmp" });
  assert.equal(spawnCall.command, "npx");
  assert.equal(spawnCall.options.shell, false);
  assert.deepEqual(
    tested.capabilities.tools.map((tool) => tool.name),
    ["read_docs"],
  );
});
