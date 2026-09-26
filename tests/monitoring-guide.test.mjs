import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import {
  Monitoring,
  probePublicSite,
  validateMonitor,
} from "../server/monitoring.mjs";
import { BackendGuide, validateGuide } from "../server/backend-guide.mjs";

function store() {
  const values = new Map();
  return {
    setting: (scope, key) => values.get(`${scope}/${key}`) || null,
    setSetting: (scope, key, value) => values.set(`${scope}/${key}`, value),
    settingKeys: (scope) =>
      [...values.keys()]
        .filter((key) => key.startsWith(`${scope}/`))
        .map((key) => key.slice(scope.length + 1)),
  };
}

test("monitor rejects private endpoints and pins public DNS while checking content", async () => {
  assert.throws(() =>
    validateMonitor({
      url: "http://example.com",
      enabled: true,
      expected: "",
      interval: 15,
    }),
  );
  assert.throws(() =>
    validateMonitor({
      url: "https://example.com/?token=x",
      enabled: true,
      expected: "",
      interval: 15,
    }),
  );
  await assert.rejects(
    () =>
      probePublicSite("https://example.com", "", async () => [
        { address: "127.0.0.1" },
      ]),
    /publik/,
  );
  let pinned;
  const request = (_url, options, callback) => {
    options.lookup("example.com", {}, (_error, ip) => {
      pinned = ip;
    });
    const req = new EventEmitter();
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      callback(res);
      queueMicrotask(() => {
        res.emit("data", Buffer.from("<h1>Ready</h1>"));
        res.emit("end");
      });
    };
    return req;
  };
  const result = await probePublicSite(
    "https://example.com/",
    "Ready",
    async () => [{ address: "8.8.8.8" }],
    request,
  );
  assert.equal(pinned, "8.8.8.8");
  assert.equal(result.ok, true);
  const missing = await probePublicSite(
    "https://example.com/",
    "Missing",
    async () => [{ address: "8.8.8.8" }],
    request,
  );
  assert.equal(missing.ok, false);
});

test("monitor records failures and runs enabled schedules per project", async () => {
  const db = store();
  const events = [];
  const monitor = new Monitoring(
    db,
    (type, payload) => events.push({ type, payload }),
    async () => ({ ok: false, status: 503, latencyMs: 7, reason: "HTTP 503" }),
  );
  monitor.save("one", {
    url: "https://example.com/",
    enabled: true,
    interval: 5,
    expected: "",
  });
  await monitor.tick();
  assert.equal(monitor.status("one").checks[0].status, 503);
  await monitor.tick();
  assert.equal(monitor.status("one").checks.length, 1);
  assert.equal(events[0].type, "monitor-result");
  assert.equal(monitor.status("other").checks.length, 0);
});

test("backend guide detects dependencies and prepares provider-specific safe steps", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "forge-guide-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ dependencies: { "@supabase/supabase-js": "^2.0" } }),
  );
  await fs.writeFile(path.join(root, ".env"), "REAL_SECRET=never-read");
  const project = { id: "one", name: "Demo", path: root };
  const guide = new BackendGuide(store());
  const report = await guide.save(
    project,
    { data: "projects", auth: true, api: true },
    { database: "supabase", hosting: "vercel" },
  );
  assert.ok(report.detected.includes("Supabase SDK"));
  assert.match(report.prompt, /Row Level Security/);
  assert.match(report.prompt, /autentikasi/);
  assert.doesNotMatch(JSON.stringify(report), /never-read/);
  assert.throws(() =>
    validateGuide({ data: "unsafe\ncommand", auth: true, api: true }),
  );
});
