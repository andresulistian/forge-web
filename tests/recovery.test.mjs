import test from "node:test";
import assert from "node:assert/strict";
import { isolatedForge } from "./visual-fixtures.mjs";

import { ActivityCenter } from "../server/activity.mjs";

test("late completion cannot overwrite a newer run; interrupted turn is not completed", async () => {
  const values = new Map();
  const store = {
    setting: (_s, key) => values.get(key),
    setSetting: (_s, key, value) => values.set(key, value),
    addHistory: () => ({}),
  };
  let resolve;
  const pending = new Promise((r) => (resolve = r));
  const activity = new ActivityCenter(store, { diff: () => pending });
  const project = { id: "one" };
  const first = activity.begin(
    project,
    { mode: "build", text: "first" },
    "old",
  );
  const finishing = activity.finish(project);
  const second = activity.begin(project, { mode: "ask", text: "second" }, null);
  resolve({ files: [] });
  await finishing;
  assert.equal(activity.current(project.id).id, second.id);
  assert.equal(
    activity.current(project.id).status,
    "running",
    "late diff must not complete a newer run",
  );
  await activity.observe(
    "codex",
    {
      projectId: project.id,
      method: "turn/completed",
      params: { turn: { status: "interrupted" } },
    },
    project,
  );
  assert.equal(activity.current(project.id).status, "interrupted");
  assert.notEqual(first.id, second.id);
});

test(
  "durable draft is bounded, credential-free, CAS guarded and recovered across restart with interrupted run",
  { timeout: 30000 },
  async (t) => {
    const forge = await isolatedForge(t);
    const p = await forge.json("projects/create", { name: "Recovery" });
    const initialResponse = await forge.request(`session?projectId=${p.id}`);
    assert.equal(
      initialResponse.status,
      200,
      "durable recovery endpoint must exist",
    );
    const initial = await initialResponse.json();
    const saved = await forge.json("session", {
      projectId: p.id,
      expected: initial.revision,
      draft: {
        text: "Unsent draft",
        mode: "plan",
        provider: "codex",
        model: "fixture-vision",
        tab: "agent",
        token: "DO_NOT_STORE",
        password: "DO_NOT_STORE",
      },
    });
    assert.equal(saved.draft.text, "Unsent draft");
    assert.ok(!JSON.stringify(saved).includes("DO_NOT_STORE"));
    assert.equal(
      (
        await forge.request("session", {
          projectId: p.id,
          expected: initial.revision,
          draft: { text: "late" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await forge.request("session", {
          projectId: p.id,
          expected: saved.revision,
          draft: { text: "x".repeat(40001) },
        })
      ).status,
      400,
    );
    const generation = (await forge.json("state")).generation;
    await forge.json("chat", {
      projectId: p.id,
      text: "HOLD_FOR_RESTART",
      mode: "ask",
      provider: "codex",
      model: "fixture-vision",
      webMode: "off",
    });
    const before = (await forge.json(`agent-center?projectId=${p.id}`)).run;
    assert.equal(before.status, "running");
    await forge.stop();
    await forge.start();
    const state = await forge.json("state");
    assert.notEqual(state.generation, generation);
    assert.equal(state.active, null);
    assert.equal(state.session.projectId, p.id);
    const restored = await forge.json(`session?projectId=${p.id}`);
    assert.equal(restored.draft.text, "Unsent draft");
    assert.equal(restored.draft.mode, "plan");
    const after = (await forge.json(`agent-center?projectId=${p.id}`)).run;
    assert.equal(after.id, before.id);
    assert.equal(after.status, "interrupted");
    assert.equal(
      (await forge.json(`agent-center?projectId=${p.id}`)).run.id,
      before.id,
      "GET/reconnect must not resume or duplicate run",
    );
  },
);
