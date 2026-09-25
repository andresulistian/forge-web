import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DeployManager } from "../server/deploy.mjs";
import { ReleaseHistory, releaseUrl } from "../server/releases.mjs";
import { Store } from "../server/store.mjs";

const productionId = "a".repeat(32);
const previewId = "b".repeat(32);
const cloudflareRows = [
  { id: productionId, environment: "production", latest_stage: { status: "success" }, created_on: "2026-01-01T00:00:00Z", url: "https://shop.pages.dev" },
  { id: previewId, environment: "preview", latest_stage: { status: "success" }, created_on: "2026-01-02T00:00:00Z", url: "https://preview.shop.pages.dev" },
];

test("release history verifies provider project and production before rollback", async (t) => {
  const oldToken = process.env.CLOUDFLARE_API_TOKEN;
  const oldAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  process.env.CLOUDFLARE_API_TOKEN = "local-test-token";
  process.env.CLOUDFLARE_ACCOUNT_ID = "c".repeat(32);
  t.after(() => {
    if (oldToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN; else process.env.CLOUDFLARE_API_TOKEN = oldToken;
    if (oldAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID; else process.env.CLOUDFLARE_ACCOUNT_ID = oldAccount;
  });
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url, method: options.method });
    assert.equal(options.headers.Authorization, "Bearer local-test-token");
    return { ok: true, status: 200, json: async () => ({ success: true, result: options.method === "POST" ? cloudflareRows[0] : cloudflareRows }) };
  };
  const history = new ReleaseHistory(null, fetcher);
  const config = { hosting: "cloudflare", projectName: "shop" };
  history.record("project-1", { provider: "cloudflare", projectName: "shop", target: "web", status: "failed" });
  const list = await history.list("project-1", config);
  assert.equal(list.online, true);
  assert.equal(list.entries.length, 3);
  assert.equal(list.entries.filter((entry) => entry.source === "provider").length, 2);
  assert.equal(list.entries.find((item) => item.id === previewId).rollbackable, false);
  await assert.rejects(history.verify(config, previewId), /tidak tersedia/);
  await assert.rejects(history.verify(config, "../wrong"), /tidak valid/);
  await assert.rejects(history.verify({ ...config, projectName: "other" }, "d".repeat(32)), /tidak tersedia/);
  assert.equal((await history.verify(config, productionId)).id, productionId);
  await history.rollbackCloudflare(config, productionId);
  assert.match(requests.at(-1).url, /\/pages\/projects\/shop\/deployments\/a{32}\/rollback$/);
  assert.equal(requests.at(-1).method, "POST");
  assert.equal(releaseUrl("visit https://evil.example and https://shop.pages.dev", "cloudflare"), "https://shop.pages.dev/");
});

test("Vercel history includes only the configured project and successful production rollback targets", async (t) => {
  const old = process.env.VERCEL_TOKEN;
  process.env.VERCEL_TOKEN = "vercel-test-token";
  t.after(() => { if (old === undefined) delete process.env.VERCEL_TOKEN; else process.env.VERCEL_TOKEN = old; });
  const history = new ReleaseHistory(null, async (url) => {
    assert.match(url, /projectId=my-app/);
    return { ok: true, status: 200, json: async () => ({ deployments: [
      { uid: "dpl_1234567890", name: "my-app", target: "production", state: "READY", createdAt: Date.now(), url: "my-app.vercel.app" },
      { uid: "dpl_1234567891", name: "my-app", target: null, state: "READY", createdAt: Date.now(), url: "preview.vercel.app" },
      { uid: "dpl_1234567892", name: "other-app", target: "production", state: "READY", createdAt: Date.now(), url: "other.vercel.app" },
    ] }) };
  });
  const config = { hosting: "vercel", projectName: "my-app" };
  const releases = await history.list("project-1", config);
  assert.equal(releases.entries.length, 2);
  assert.equal(releases.entries[0].rollbackable, true);
  await assert.rejects(history.verify(config, "dpl_1234567891"), /tidak tersedia/);
});

test("rollback switches the online release without editing the local source", async (t) => {
  const oldToken = process.env.CLOUDFLARE_API_TOKEN;
  const oldAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  process.env.CLOUDFLARE_API_TOKEN = "local-test-token";
  process.env.CLOUDFLARE_ACCOUNT_ID = "c".repeat(32);
  t.after(() => {
    if (oldToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN; else process.env.CLOUDFLARE_API_TOKEN = oldToken;
    if (oldAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID; else process.env.CLOUDFLARE_ACCOUNT_ID = oldAccount;
  });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "forge-releases-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = { id: "project-1", name: "Shop", path: path.join(root, "project") };
  await fs.mkdir(project.path);
  await fs.writeFile(path.join(project.path, "index.html"), "local code stays");
  const events = [];
  let rollbackRequests = 0;
  const deploy = new DeployManager(path.join(root, "data"), (type, payload) => events.push({ type, payload }), null,
    async (_url, options) => {
      if (options.method === "POST") rollbackRequests++;
      return { ok: true, status: 200, json: async () => ({ success: true, result: options.method === "POST" ? cloudflareRows[0] : cloudflareRows }) };
    });
  await deploy.save(project, { hosting: "cloudflare", environment: "production", projectName: "shop" });
  await assert.rejects(deploy.rollback(project, previewId), /tidak tersedia/);
  assert.equal(rollbackRequests, 0);
  assert.equal((await deploy.rollback(project, productionId)).started, true);
  for (let i = 0; i < 100 && !events.some((event) => event.type === "deploy-completed"); i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(events.some((event) => event.type === "deploy-completed"));
  assert.equal(rollbackRequests, 1);
  assert.equal(events.at(-1).payload.ok, true);
  assert.equal(deploy.releases.local(project.id)[0].rollbackOf, productionId);
  assert.equal(await fs.readFile(path.join(project.path, "index.html"), "utf8"), "local code stays");
});

test("Vercel rollback uses a verified project deployment and release ledger persists after restart", async (t) => {
  const old = process.env.VERCEL_TOKEN;
  process.env.VERCEL_TOKEN = "vercel-test-token";
  t.after(() => { if (old === undefined) delete process.env.VERCEL_TOKEN; else process.env.VERCEL_TOKEN = old; });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "forge-release-ledger-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const project = { id: "local-project", name: "My App", path: dir };
  const store = await new Store(path.join(dir, "data")).init();
  const events = [];
  const deploy = new DeployManager(path.join(dir, "data"), (type, payload) => events.push({ type, payload }), store,
    async (_url, _options) => ({ ok: true, status: 200, json: async () => ({ deployments: [
      { uid: "dpl_1234567890", name: "my-app", target: "production", state: "READY", createdAt: Date.now(), url: "my-app.vercel.app" },
    ] }) }));
  await deploy.save(project, { hosting: "vercel", environment: "production", projectName: "my-app" });
  let command;
  deploy.spawn = async (_project, executable, args) => { command = { executable, args }; return ""; };
  await deploy.rollback(project, "dpl_1234567890");
  for (let i = 0; i < 100 && !events.some((event) => event.type === "deploy-completed"); i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(events.at(-1).payload.ok, true);
  assert.equal(command.executable, "npx");
  assert.ok(command.args.includes("dpl_1234567890"));
  assert.deepEqual(command.args.slice(command.args.indexOf("--project"), command.args.indexOf("--project") + 2), ["--project", "my-app"]);
  assert.equal(command.args.includes("vercel-test-token"), false);
  store.close();
  const restarted = await new Store(path.join(dir, "data")).init();
  assert.equal(new ReleaseHistory(restarted).local(project.id)[0].rollbackOf, "dpl_1234567890");
  restarted.close();
});

test("successful Forge deploy records a release URL without contacting a provider in the test", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "forge-deploy-ledger-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = { id: "project-1", name: "Shop", path: path.join(root, "project") };
  await fs.mkdir(project.path);
  await fs.writeFile(path.join(project.path, "index.html"), "<h1>Safe release</h1>");
  const events = [];
  const deploy = new DeployManager(path.join(root, "data"), (type, payload) => events.push({ type, payload }));
  await deploy.save(project, { hosting: "cloudflare", environment: "production", projectName: "shop" });
  deploy.spawn = async () => "Deployment complete: https://abc.shop.pages.dev";
  deploy.run(project, "web", "build");
  for (let i = 0; i < 100 && !events.some((event) => event.type === "deploy-completed"); i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(events.find((event) => event.type === "deploy-completed")?.payload.ok, true);
  const entry = deploy.releases.local(project.id)[0];
  assert.equal(entry.url, "https://abc.shop.pages.dev/");
  assert.equal(entry.environment, "production");
  assert.equal(entry.status, "success");
});
