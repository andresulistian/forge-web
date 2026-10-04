import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { UniversalAgentCore, agentAdapter } from "../server/agent-core.mjs";
import { Skills } from "../server/skills.mjs";
import { ProjectMemory } from "../server/project-memory.mjs";
import { ActivityCenter } from "../server/activity.mjs";
import { Workspace } from "../server/workspace.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "forge-phase1-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = new Workspace(
    path.join(root, "data"),
    path.join(root, "projects"),
    path.resolve("templates/starter"),
  );
  await workspace.init();
  t.after(() => workspace.close());
  const project = await workspace.create("Phase One");
  return { root, workspace, project };
}

test("Universal Agent Core routes every provider through one request contract", async () => {
  const events = [];
  const requests = [];
  const core = new UniversalAgentCore((type, payload) =>
    events.push({ type, payload }),
  );
  for (const id of ["codex", "openrouter", "vikey", "local"])
    core.register(
      agentAdapter({
        id,
        label: id,
        matches: (provider) => provider === id,
        catalog: async () => ({ provider: id, models: [] }),
        run: async (request) => requests.push(request),
        stop: async () => {},
      }),
    );
  const request = {
    project: { id: "p" },
    provider: "openrouter",
    model: "model",
    mode: "build",
    text: "buat fitur",
  };
  await core.execute(request);
  assert.equal(requests[0], request);
  assert.equal(events[0].type, "agent-activity");
  assert.equal(events[0].payload.phase, "routing");
  await assert.rejects(
    () => core.execute({ ...request, provider: "unknown" }),
    /Provider/,
  );
});

test("Hermes-style skills are reusable, project-scoped, and injectable", async (t) => {
  const { workspace, project } = await fixture(t);
  const skills = new Skills(workspace.store);
  assert.ok(skills.list(project.id).some((item) => item.command === "/debug"));
  const custom = skills.save(project.id, {
    name: "Accessibility",
    command: "/a11y",
    description: "Audit aksesibilitas",
    prompt: "Periksa keyboard, focus, label, contrast, dan semantic HTML.",
  });
  const resolved = skills.resolve(project.id, "/a11y periksa halaman checkout");
  assert.equal(resolved.text, "periksa halaman checkout");
  assert.match(resolved.instructions, /keyboard, focus/);
  assert.equal(
    skills.list("project-lain").some((item) => item.id === custom.id),
    false,
  );
});

test("Project Memory scans structure and commands while preserving decisions", async (t) => {
  const { workspace, project } = await fixture(t);
  const memory = new ProjectMemory(workspace.store);
  const first = await memory.refresh(project);
  assert.ok(first.structure.includes("package.json"));
  assert.ok(first.commands.dev);
  memory.save(project.id, {
    conventions: ["Komponen memakai functional React."],
    decisions: ["Gunakan API yang sama untuk semua provider."],
  });
  const refreshed = await memory.refresh(project);
  assert.ok(
    refreshed.decisions.some((item) => item.includes("semua provider")),
  );
  assert.match(memory.prompt(refreshed), /Project Memory/);
  assert.match(memory.prompt(refreshed), /Important commands/);
});

test("Agent run captures elapsed status and a reviewable diff that can be restored", async (t) => {
  const { workspace, project } = await fixture(t);
  const before = (await workspace.checkpoint(project, "Before agent"))[0].id;
  const center = new ActivityCenter(workspace.store, workspace);
  center.begin(
    project,
    { text: "ubah aplikasi", mode: "build", provider: "codex", model: "sol" },
    before,
  );
  await fs.writeFile(
    path.join(project.path, "new-agent-file.txt"),
    "hasil agent\n",
  );
  center.update(project.id, { testStatus: "passed", buildStatus: "passed" });
  const run = await center.finish(project);
  assert.equal(run.status, "completed");
  assert.equal(run.reviewStatus, "ready");
  assert.equal(run.testStatus, "passed");
  assert.ok(run.diff.files.some((item) => item.file === "new-agent-file.txt"));
  assert.match(run.diff.patch, /hasil agent/);
  await workspace.restore(project, before);
  await assert.rejects(() =>
    fs.access(path.join(project.path, "new-agent-file.txt")),
  );
});

test("Phase 1 UI keeps Agent Center, safe review, memory, and responsive layout", async () => {
  const [app, center, styles, server] = await Promise.all([
    fs.readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/AgentCenter.tsx", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    fs.readFile(new URL("../server/index.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(app, /\["agent", "Agent"\]/);
  assert.match(app, /<AgentCenter/);
  assert.match(center, /Review perubahan/);
  assert.match(center, /Project Memory/);
  assert.match(center, /High-level activity/);
  assert.match(center, /Reusable skills/);
  assert.match(server, /\/api\/review\/accept/);
  assert.match(server, /\/api\/review\/undo/);
  assert.match(styles, /\.agent-center \{[\s\S]*?grid-template-columns/);
  assert.match(styles, /@media \(max-width: 1050px\)[\s\S]*?\.agent-center/);
});
