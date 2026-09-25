import test from "node:test";
import assert from "node:assert/strict";
import { BuildOrchestrator } from "../server/orchestrator.mjs";

const project = { id: "project-1", path: "/tmp/project-1" };

test("specialists run in parallel and their reports reach one writable builder", async () => {
  const events = [];
  const starts = [];
  let running = 0;
  let peak = 0;
  const orchestrator = new BuildOrchestrator({
    emit: (type, payload) => events.push({ type, payload }),
    maxWorkers: 3,
    workerFactory: ({ agent }) => ({
      async run({ mode, prompt }) {
        starts.push({ role: agent.role, mode, prompt });
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, agent.role === "builder" ? 1 : 20));
        running -= 1;
        return { text: `${agent.role} report` };
      },
      async close() {},
    }),
  });
  const result = await orchestrator.run({
    project,
    request: "Add search",
    provider: "api:router",
    model: "deepseek/test",
  });
  assert.equal(peak, 2);
  assert.deepEqual(starts.map((item) => item.mode).sort(), ["build", "plan", "plan"]);
  assert.equal(starts.filter((item) => item.mode === "build").length, 1);
  const builder = starts.find((item) => item.role === "builder");
  assert.match(builder.prompt, /architecture report/);
  assert.match(builder.prompt, /risks report/);
  assert.equal(result.reports.length, 2);
  assert.match(result.synthesis, /Inspecting architecture/);
  assert.ok(events.some((event) => event.type === "orchestration-task" && event.payload.phase === "done"));
});

test("worker cap is enforced across concurrent project tasks", async () => {
  let running = 0;
  let peak = 0;
  const orchestrator = new BuildOrchestrator({
    maxWorkers: 2,
    workerFactory: ({ agent }) => ({
      async run() {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, agent.role === "builder" ? 2 : 15));
        running -= 1;
        return { text: agent.role };
      },
      async close() {},
    }),
  });
  await Promise.all([
    orchestrator.run({ project, request: "One", provider: "codex", model: "test" }),
    orchestrator.run({ project: { id: "project-2", path: "/tmp/project-2" }, request: "Two", provider: "codex", model: "test" }),
  ]);
  assert.equal(peak, 2);
});

test("specialist failures degrade gracefully while builder failure fails task", async () => {
  const phases = [];
  const orchestrator = new BuildOrchestrator({
    emit: (type, payload) => { if (type === "orchestration-task") phases.push(payload); },
    workerFactory: ({ agent }) => ({
      async run() {
        if (agent.role === "architecture") throw Error("scanner unavailable");
        return { text: `${agent.role} ok` };
      },
      async close() {},
    }),
  });
  const result = await orchestrator.run({ project, request: "Change", provider: "codex", model: "test" });
  assert.equal(result.reports.find((item) => item.role === "architecture").status, "failed");
  assert.equal(result.builder.status, "completed");

  const failing = new BuildOrchestrator({
    workerFactory: ({ agent }) => ({
      async run() {
        if (agent.role === "builder") throw Error("build broke");
        return { text: "ok" };
      },
      async close() {},
    }),
  });
  await assert.rejects(
    failing.run({ project, request: "Change", provider: "codex", model: "test" }),
    /build broke/,
  );
  assert.equal(failing.active, false);
  assert.ok(phases.some((item) => item.phase === "done"));
});

test("approvals are owned by the builder and read-only approvals fail closed", async () => {
  const approvals = [];
  const decisions = [];
  let orchestrator;
  orchestrator = new BuildOrchestrator({
    emit: (type, payload) => {
      if (type === "approval") {
        approvals.push(payload);
        queueMicrotask(() => orchestrator.decide(payload.id, true));
      }
    },
    workerFactory: ({ agent, emit }) => {
      const worker = {
        async run() {
          if (agent.role === "architecture") emit("approval", { id: "read-only", reason: "write" });
          if (agent.role === "builder") {
            emit("approval", { id: "builder-approval", reason: "write" });
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          return { text: agent.role };
        },
        decide(id, accept) { decisions.push({ role: agent.role, id, accept }); },
        async close() {},
      };
      return worker;
    },
  });
  await orchestrator.run({ project, request: "Change", provider: "api:router", model: "test" });
  assert.deepEqual(approvals.map((item) => item.id), ["builder-approval"]);
  assert.ok(decisions.some((item) => item.id === "read-only" && item.accept === false));
  assert.ok(decisions.some((item) => item.id === "builder-approval" && item.accept === true));
});

test("stop interrupts active workers and prevents the writer", async () => {
  const releases = [];
  let builderStarted = false;
  const orchestrator = new BuildOrchestrator({
    workerFactory: ({ agent }) => {
      let stopped = false;
      return {
        async run() {
          if (agent.role === "builder") builderStarted = true;
          await new Promise((resolve, reject) => {
            releases.push(() => stopped ? reject(Error("stopped")) : resolve());
          });
          return { text: "done" };
        },
        async stop() {
          stopped = true;
          while (releases.length) releases.shift()();
        },
        async close() {},
      };
    },
  });
  const pending = orchestrator.run({ taskId: "task-stop", project, request: "Change", provider: "codex", model: "test" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(await orchestrator.stop("task-stop"), true);
  await assert.rejects(pending, /dihentikan/);
  assert.equal(builderStarted, false);
});
