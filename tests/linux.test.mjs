import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { CredentialStore } from "../server/credentials.mjs";
import { Ollama } from "../server/ollama.mjs";

test("Linux API keys enter secret-tool through stdin, never process arguments", async () => {
  const secret = "sk-test-sensitive";
  let received = "";
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      received += chunk.toString();
      callback();
    },
    final(callback) {
      queueMicrotask(() => child.emit("close", 0));
      callback();
    },
  });
  const credentials = new CredentialStore({
    platform: "linux",
    spawnImpl: (_command, args) => {
      assert.equal(args.join(" ").includes(secret), false);
      return child;
    },
    exec: async (_command, args) => {
      if (args[0] === "lookup") return { stdout: secret + "\n" };
      return { stdout: "" };
    },
  });
  await credentials.set("openrouter", secret);
  assert.equal(received, secret);
  assert.equal(await credentials.get("openrouter"), secret);
  await credentials.delete("openrouter");
});

test("Ollama chooses installed Nobara model when Mac model is absent", () => {
  const ollama = new Ollama(() => {});
  const models = [{ name: "gemma4:12b" }, { model: "qwen3.5:9b" }];
  assert.equal(ollama.preferredModel(models), "qwen3.5:9b");
  assert.equal(ollama.preferredModel([models[0]]), "gemma4:12b");
});
