import test from "node:test";
import assert from "node:assert/strict";
import { coordinateSpecialists } from "../server/specialist-coordinator.mjs";
import { planSpecialists } from "../server/workflow-plan.mjs";

const request = "Upload logo and display in preview";
const passChecks = () => ({ ok: true, results: [{ name: "test", ok: true, output: "fixture test exited 0" }] });
const review = (plan, verdict = "PASS") => JSON.stringify({ verdict, reason: verdict === "FIX" ? "Fix preview" : "Checked", criteria: plan.criteria.map(({ id }) => ({ id, status: verdict === "PASS" ? "pass" : "fail", evidence: "src/Preview.tsx" })) });

test("exact planned roles run sequentially with handoffs and real verification callback", async () => {
  const plan = planSpecialists(request);
  const roles = [];
  let live = 0;
  let peak = 0;
  let checks = 0;
  const result = await coordinateSpecialists({ plan, request, context: "approved design", runAgent: async ({ role, mode, prompt }) => {
    live++; peak = Math.max(peak, live); roles.push(role);
    assert.equal(mode, ["reviewer", "explorer"].includes(role) ? "plan" : "build");
    assert.match(prompt, /approved design/);
    if (role === "frontend") assert.match(prompt, /backend report/);
    await new Promise((resolve) => setTimeout(resolve, 1)); live--;
    return role === "reviewer" ? review(plan) : role + " report";
  }, verify: async () => { checks++; return passChecks(); } });
  assert.equal(result.ok, true);
  assert.deepEqual(roles, plan.roles);
  assert.equal(peak, 1);
  assert.equal(checks, 1);
  assert.equal(result.humanAcceptanceRequired, true);
});
test("failed machine checks return feedback to writers and trigger re-testing", async () => {
  const plan = planSpecialists(request);
  let checks = 0;
  const result = await coordinateSpecialists({ plan, request, runAgent: async ({ role, attempt, prompt }) => {
    if (attempt === 1 && plan.builders.includes(role)) assert.match(prompt, /regression failed/);
    return role === "reviewer" ? review(plan) : role + " report";
  }, verify: async () => ++checks === 1 ? { ok: false, results: [{ name: "test", ok: false, output: "regression failed" }] } : passChecks() });
  assert.equal(result.ok, true);
  assert.equal(checks, 2);
  assert.equal(result.attempts, 2);
  assert.ok(result.calls <= plan.maxAgentCalls);
});
test("Reviewer FIX triggers bounded repairs and a fresh independent review", async () => {
  const plan = planSpecialists(request);
  let reviews = 0;
  const result = await coordinateSpecialists({ plan, request, runAgent: async ({ role }) => role === "reviewer" ? review(plan, ++reviews === 1 ? "FIX" : "PASS") : "report", verify: passChecks });
  assert.equal(result.ok, true);
  assert.equal(reviews, 2);
});
test("unstructured reviewer text blocks rather than silently passing", async () => {
  const plan = planSpecialists(request);
  const result = await coordinateSpecialists({ plan, request, runAgent: async () => "looks okay", verify: passChecks });
  assert.equal(result.ok, false);
  assert.equal(result.review.verdict, "BLOCK");
  assert.equal(result.attempts, 1);
});
test("a declined test approval stops without spending another repair call", async () => {
  const plan = planSpecialists(request);
  const result = await coordinateSpecialists({ plan, request, runAgent: async () => "report", verify: async () => ({ ok: false, blocked: true, results: [{ name: "approval", ok: false }] }) });
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 1);
  assert.equal(result.calls, 3);
});
test("maximum two repair rounds is enforced", async () => {
  const plan = planSpecialists(request, "maximum");
  let checks = 0;
  const result = await coordinateSpecialists({ plan, request, runAgent: async () => "report", verify: async () => { checks++; return { ok: false, results: [{ name: "test", ok: false }] }; } });
  assert.equal(checks, 3);
  assert.equal(result.ok, false);
  assert.ok(result.calls <= plan.maxAgentCalls);
});
test("lint-only success is not sufficient even if a verifier incorrectly sets ok", async () => {
  const plan = planSpecialists("Fix button", "economy");
  const result = await coordinateSpecialists({ plan, request: "Fix button", runAgent: async () => "done", verify: async () => ({ ok: true, results: [{ name: "lint", ok: true }] }) });
  assert.equal(result.ok, false);
});
test("empty worker output and worker failures cannot become success", async () => {
  const plan = planSpecialists(request);
  await assert.rejects(coordinateSpecialists({ plan, request, runAgent: async () => "", verify: passChecks }), /hasil/);
  await assert.rejects(coordinateSpecialists({ plan, request, runAgent: async () => { throw Error("offline"); }, verify: passChecks }), /offline/);
});
test("abort before execution prevents all worker calls", async () => {
  const controller = new AbortController(); controller.abort();
  const plan = planSpecialists(request);
  let calls = 0;
  await assert.rejects(coordinateSpecialists({ plan, request, signal: controller.signal, runAgent: async () => { calls++; return "report"; }, verify: passChecks }), /dihentikan/);
  assert.equal(calls, 0);
});
test("abort after backend prevents frontend and testing", async () => {
  const controller = new AbortController();
  const plan = planSpecialists(request);
  const roles = [];
  await assert.rejects(coordinateSpecialists({ plan, request, signal: controller.signal, runAgent: async ({ role }) => { roles.push(role); if (role === "backend") controller.abort(); return "report"; }, verify: () => { throw Error("must not run"); } }), /dihentikan/);
  assert.deepEqual(roles, ["explorer", "backend"]);
});
test("tampered/unbounded plans fail closed", async () => {
  const plan = planSpecialists(request);
  for (const changed of [{ maxRepairs: 99 }, { builders: ["admin"] }, { maxAgentCalls: 100 }, { roles: ["builder"] }])
    await assert.rejects(coordinateSpecialists({ plan: { ...plan, ...changed }, request, runAgent: async () => "report", verify: passChecks }));
});
