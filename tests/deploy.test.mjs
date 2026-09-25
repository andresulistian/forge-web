import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DeployManager, validateDeployConfig } from "../server/deploy.mjs";
import { scanFiles, securityAudit } from "../server/security.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "forge-deploy-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = { id: "project-1", name: "My App", path: path.join(root, "app") };
  await fs.mkdir(project.path);
  return { root, project, deploy: new DeployManager(path.join(root, "data"), () => {}) };
}

test("deploy config validates provider, environment, and application identifier", () => {
  const config = validateDeployConfig({}, "My App");
  assert.equal(config.projectName, "my-app");
  assert.equal(config.appId, "com.forge.myapp");
  assert.throws(() => validateDeployConfig({ hosting: "unknown" }, "App"));
  assert.throws(() => validateDeployConfig({ appId: "bad id" }, "App"));
  assert.throws(() => validateDeployConfig({ environment: "secret" }, "App"));
});

test("deploy inspection detects static and Expo projects and persists settings", async (t) => {
  const { project, deploy } = await fixture(t);
  await fs.writeFile(path.join(project.path, "index.html"), "<h1>Hello</h1>");
  assert.equal((await deploy.inspect(project)).projectType, "static");
  const saved = await deploy.save(project, {
    hosting: "vercel",
    database: "supabase",
    environment: "production",
    mobileProfile: "production",
    projectName: "hello-shop",
    appId: "com.hello.shop",
  });
  assert.equal(saved.database, "supabase");
  assert.equal((await deploy.config(project)).hosting, "vercel");
  await fs.writeFile(
    path.join(project.path, "package.json"),
    JSON.stringify({ dependencies: { expo: "latest" }, scripts: { build: "expo export" } }),
  );
  await fs.writeFile(path.join(project.path, "eas.json"), "{}");
  const expo = await deploy.inspect(project);
  assert.equal(expo.projectType, "expo");
  assert.equal(expo.easConfigured, true);
});

test("static staging excludes secrets, package metadata, and symlinks", async (t) => {
  const { root, project, deploy } = await fixture(t);
  await fs.writeFile(path.join(project.path, "index.html"), "<h1>Hello</h1>");
  await fs.writeFile(path.join(project.path, "app.js"), "console.log('ok')");
  await fs.writeFile(path.join(project.path, ".env"), "SECRET=yes");
  await fs.writeFile(path.join(project.path, "package.json"), "{}");
  await fs.writeFile(path.join(root, "outside.js"), "private");
  await fs.symlink(path.join(root, "outside.js"), path.join(project.path, "link.js"));
  const staged = await deploy.stageStatic(project);
  assert.equal(await fs.readFile(path.join(staged, "index.html"), "utf8"), "<h1>Hello</h1>");
  assert.equal(await fs.readFile(path.join(staged, "app.js"), "utf8"), "console.log('ok')");
  await assert.rejects(() => fs.access(path.join(staged, ".env")));
  await assert.rejects(() => fs.access(path.join(staged, "package.json")));
  await assert.rejects(() => fs.access(path.join(staged, "link.js")));
  assert.throws(() => deploy.run(project, "desktop"));
});

test("audit blocks hardcoded tokens before external commands and redacts their values", async (t) => {
  const { project, deploy } = await fixture(t);
  const token = "ghp_" + "A".repeat(36);
  await fs.writeFile(path.join(project.path, "index.html"), `<script>const token='${token}'</script>`);
  const report = await deploy.security(project);
  assert.equal(report.passed, false);
  assert.equal(report.findings[0].severity, "critical");
  assert.equal(JSON.stringify(report).includes(token), false);
  assert.ok(report.findings[0].fix.includes("rotasi"));
  let ran = false;
  deploy.spawn = async () => { ran = true; };
  await assert.rejects(() => deploy.execute(project, "web", "build"), /Security Gate/);
  assert.equal(ran, false);
});

test("Cloudflare warns about local env files, Vercel blocks them, and artifacts cannot contain them", async (t) => {
  const { project, deploy } = await fixture(t);
  await fs.writeFile(path.join(project.path, "index.html"), "<h1>Safe</h1>");
  await fs.writeFile(path.join(project.path, ".env"), "LOCAL_VARIABLE=placeholder");
  const cloudflare = await deploy.security(project);
  assert.equal(cloudflare.passed, true);
  assert.equal(cloudflare.findings[0].severity, "warning");
  await deploy.save(project, { hosting: "vercel" });
  const vercel = await deploy.security(project);
  assert.equal(vercel.passed, false);
  assert.equal(vercel.findings[0].code, "sensitive-file");
  const artifact = await scanFiles(project.path, { artifact: true });
  assert.ok(artifact.some((item) => item.blocking));
});

test("audit requires lockfile for npm dependencies but permits a clean static app", async (t) => {
  const { project } = await fixture(t);
  await fs.writeFile(path.join(project.path, "index.html"), "<h1>Safe</h1>");
  assert.equal((await securityAudit(project)).passed, true);
  await fs.writeFile(path.join(project.path, "package.json"), JSON.stringify({ dependencies: { example: "1.0.0" } }));
  const report = await securityAudit(project);
  assert.equal(report.passed, false);
  assert.ok(report.findings.some((item) => item.code === "missing-lock"));
});
