import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { ChatSpace } from "../server/chat-space.mjs";

test("standalone Chat stores history separately and sends only conversation and web context", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "forge-chat-space-"));
  try {
    const store = await new Store(directory).init();
    const requests = [];
    const events = [];
    const config = { id: "example", type: "openrouter", label: "Example", defaultModel: "example-model", models: ["example-model"], imageModels: [] };
    const providers = {
      find: (id) => { assert.equal(id, "example"); return config; },
      request: async (_config, route, options) => {
        assert.equal(route, "/chat/completions");
        requests.push(JSON.parse(options.body));
        return new Response("data: {\"choices\":[{\"delta\":{\"content\":\"Halo!\"}}]}\n\ndata: [DONE]\n\n");
      },
    };
    const chat = new ChatSpace(store, providers,
      { resolve: async (_scope, ids) => { assert.deepEqual(ids, []); return []; } },
      { prepare: async () => ({ context: "\nSumber: https://example.com", sources: [{ title: "Example", url: "https://example.com" }] }) },
      (type, payload) => events.push({ type, ...payload }));
    const thread = chat.create();
    assert.equal(chat.list().length, 1);
    await chat.send({ threadId: thread.id, text: "Apa kabar?", provider: "api:example", model: "example-model", webMode: "web" });
    await chat.send({ threadId: thread.id, text: "Lanjut", provider: "api:example", model: "example-model", webMode: "off" });
    assert.deepEqual(chat.messages(thread.id).map((item) => item.role), ["user", "assistant", "user", "assistant"]);
    assert.equal(store.projects().length, 0);
    assert.match(requests[0].messages.at(-1).content, /https:\/\/example.com/);
    assert.equal(requests[1].messages.at(-2).content, "Halo!");
    assert.equal(requests[0].tools, undefined);
    assert.ok(events.some((event) => event.kind === "delta"));
    assert.equal(chat.list()[0].title, "Apa kabar?");
    chat.delete(thread.id);
    assert.equal(chat.list().length, 0);
    store.requireDb().close();
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("Chat rejects an unsupported image model before contacting provider", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "forge-chat-image-"));
  try {
    const store = await new Store(directory).init();
    let called = false;
    const chat = new ChatSpace(store,
      { find: () => ({ id: "example", type: "openrouter", defaultModel: "text-only", models: ["text-only"], imageModels: [] }), request: () => { called = true; } },
      { resolve: async () => [{ id: "image", kind: "image", images: [{ mimeType: "image/jpeg", data: "AQID" }] }] },
      { prepare: async () => null }, () => {});
    await assert.rejects(chat.send({ threadId: chat.create().id, text: "Lihat ini", provider: "api:example", attachments: ["image"] }), /input gambar/);
    assert.equal(called, false);
    store.requireDb().close();
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
