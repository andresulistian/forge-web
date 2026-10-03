import test from "node:test";
import assert from "node:assert/strict";
import { Skills } from "../server/skills.mjs";
const store = () => {
  const data = new Map();
  return {
    setting: (k, p) => data.get(`${k}:${p}`),
    setSetting: (k, p, v) => data.set(`${k}:${p}`, v),
  };
};
test("five practical design guides load only the selected first command", () => {
  const skills = new Skills(store());
  for (const command of [
    "/design",
    "/design-system",
    "/polish",
    "/design-review",
    "/responsive",
  ]) {
    const result = skills.resolve("p", `${command} halaman checkout`);
    assert.equal(result.skill?.command, command);
    assert.equal(result.text, "halaman checkout");
    for (const section of [
      "Pemilihan",
      "Workflow",
      "Contoh",
      "Anti-pattern",
      "Checklist",
      "Verifikasi",
    ])
      assert.ok(
        result.instructions.includes(section),
        `${command}: ${section}`,
      );
    assert.ok(result.instructions.length > 1500);
    assert.equal(
      (result.instructions.match(/Reusable Forge skill/g) || []).length,
      1,
    );
  }
  assert.equal(skills.resolve("p", "buat halaman").instructions, "");
  assert.equal(skills.resolve("p", "/debug /design").skill.command, "/debug");
  assert.match(
    skills.resolve("p", "/design-review").instructions,
    /screenshot.*tidak|tidak.*screenshot/i,
  );
});
test("legacy custom design commands retain precedence and remain editable", () => {
  const db = store();
  db.setSetting("skills", "p", [
    {
      id: "old",
      command: "/design",
      name: "Mine",
      prompt: "custom legacy",
      builtin: false,
    },
  ]);
  const skills = new Skills(db);
  assert.equal(skills.resolve("p", "/design").skill.id, "old");
  skills.save("p", {
    id: "old",
    command: "/design",
    name: "Mine",
    prompt: "edited legacy",
  });
  assert.match(skills.resolve("p", "/design").instructions, /edited legacy/);
  assert.notEqual(skills.resolve("other", "/design").skill.id, "old");
  assert.throws(
    () => skills.save("p", { command: "/polish", name: "New", prompt: "x" }),
    /bawaan/,
  );
});
