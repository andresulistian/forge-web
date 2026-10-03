import test from "node:test";
import assert from "node:assert/strict";
import { Skills } from "../server/skills.mjs";
import { DesignIdentity } from "../server/design-identity.mjs";
import { ProjectMemory } from "../server/project-memory.mjs";
import { Agents } from "../server/agents.mjs";
import { fixture, sample } from "./design-fixtures.mjs";

test("shared agent context selects one guide and carries saved identity to every provider and mode", async (t) => {
  const { workspace, project } = await fixture(t);
  const design = new DesignIdentity(workspace);
  await design.save(project, {
    identity: sample(),
    expected: (await design.get(project)).revision,
  });
  const mod = await import("../server/agent-context.mjs").catch(() => ({}));
  assert.equal(
    typeof mod.prepareAgentContext,
    "function",
    "shared context assembler must exist",
  );
  const skills = new Skills(workspace.store),
    memory = new ProjectMemory(workspace.store);
  const prepared = await mod.prepareAgentContext({
    project,
    text: "/polish form",
    media: [],
    skills,
    projectMemory: memory,
    designIdentity: design,
  });
  assert.equal(prepared.resolvedSkill.skill.command, "/polish");
  assert.match(prepared.text, /Editorial hangat/);
  assert.match(prepared.text, /konteks.*bukan instruksi/i);
  assert.doesNotMatch(prepared.text, /Skill Debug aktif/);
  const calls = [];
  const stub = {
    active: false,
    codex: { turn: (...args) => calls.push(args) },
    gemini: { turn: (...args) => calls.push(args) },
    ollama: { turn: (...args) => calls.push(args) },
    apiProviders: {
      store: { messages: () => [] },
      turn: (...args) => calls.push(args),
    },
  };
  for (const mode of ["ask", "plan", "build"])
    for (const provider of [
      "codex",
      "gemini",
      "ollama",
      "api:openrouter",
      "api:vikey",
    ]) {
      await Agents.prototype.turnDirect.call(stub, {
        project,
        mode,
        provider,
        text: prepared.text,
      });
      assert.match(calls.at(-1)[2], /Editorial hangat/);
    }
  for (const provider of ["codex", "api:openrouter", "api:vikey"]) {
    await Agents.prototype.turnDirect.call(stub, {
      project,
      mode: "build",
      provider,
      text: prepared.text,
      multiAgent: true,
    });
    assert.match(calls.at(-1)[2], /Editorial hangat/);
  }
  const plain = await mod.prepareAgentContext({
    project,
    text: "buat fitur",
    media: [],
    skills,
    projectMemory: memory,
    designIdentity: design,
  });
  assert.match(plain.text, /Editorial hangat/);
  assert.doesNotMatch(plain.text, /Reusable Forge skill/);
});
