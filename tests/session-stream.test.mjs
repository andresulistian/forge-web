import test from "node:test";
import assert from "node:assert/strict";
import { connect, subscribe } from "../src/api.ts";

test("401 stops reconnect with actionable error instead of replaying actions", async () => {
  const previous = {
    fetch: globalThis.fetch,
    location: globalThis.location,
    history: globalThis.history,
    sessionStorage: Object.getOwnPropertyDescriptor(
      globalThis,
      "sessionStorage",
    ),
  };
  globalThis.location = {
    hash: "",
    origin: "http://127.0.0.1:1",
    pathname: "/",
  };
  globalThis.history = { replaceState: () => {} };
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: { getItem: () => "test-only", setItem: () => {} },
  });
  let requests = 0;
  globalThis.fetch = async (_url, options) => {
    requests++;
    assert.equal(options.method, "GET");
    return new Response(JSON.stringify({ error: "expired" }), { status: 401 });
  };
  try {
    await connect();
    await assert.rejects(
      subscribe(
        new AbortController().signal,
        () => {},
        () => {},
      ),
      /401.*launcher/,
    );
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.location) globalThis.location = previous.location;
    else delete globalThis.location;
    if (previous.history) globalThis.history = previous.history;
    else delete globalThis.history;
    if (previous.sessionStorage)
      Object.defineProperty(
        globalThis,
        "sessionStorage",
        previous.sessionStorage,
      );
    else delete globalThis.sessionStorage;
  }
});
