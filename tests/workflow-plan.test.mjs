import test from "node:test";
import assert from "node:assert/strict";
import { planSpecialists, requestCriteria, parseReview, specialistInstructions } from "../server/workflow-plan.mjs";

test("small UI work uses one frontend specialist, not the whole team", () => {
  const plan = planSpecialists("Perbaiki warna button", "balanced");
  assert.deepEqual(plan.roles, ["frontend"]);
  assert.equal(plan.workers, 1);
  assert.deepEqual(plan.requiredChecks, ["test"]);
});
test("API work routes to backend with risk review", () => {
  const plan = planSpecialists("Perbaiki auth API dan database", "balanced");
  assert.deepEqual(plan.roles, ["explorer", "backend", "reviewer"]);
});
test("attachment and preview work gives backend/frontend distinct sequential roles", () => {
  const plan = planSpecialists("Upload logo ke preview", "balanced");
  assert.deepEqual(plan.builders, ["backend", "frontend"]);
  assert.equal(plan.review, true);
  assert.equal(plan.maxRepairs, 1);
  assert.equal(plan.maxAgentCalls, 7);
});
test("economy does not create unnecessary AI review calls", () => {
  const plan = planSpecialists("Upload logo ke API dan preview", "economy");
  assert.deepEqual(plan.roles, ["fullstack"]);
  assert.equal(plan.maxRepairs, 0);
});
test("disabled coordination remains a single builder", () => {
  const plan = planSpecialists("Refactor auth API and UI", "maximum", false);
  assert.deepEqual(plan.roles, ["builder"]);
  assert.equal(plan.maxRepairs, 0);
});
test("invalid modes and empty requests are rejected", () => {
  assert.throws(() => planSpecialists("Change", "unlimited"));
  assert.throws(() => planSpecialists("  "));
  assert.throws(() => planSpecialists("x".repeat(40001)));
  assert.throws(() => specialistInstructions("administrator"));
});
test("long multi-requirement requests are never silently truncated", () => {
  const request = Array.from({ length: 20 }, (_, i) => `${i + 1}. Requirement ${i + 1}`).join("\n");
  const result = requestCriteria(request);
  assert.equal(result.length, 1);
  assert.equal(result[0].description, request);
});
test("strict reviewer rejects prose, duplicate IDs and incomplete evidence", () => {
  const criteria = requestCriteria("1. Logo\n2. Preview");
  assert.equal(parseReview("Everything looks fine", criteria).verdict, "BLOCK");
  assert.equal(parseReview(JSON.stringify({ verdict: "PASS", criteria: [{ id: "C1", status: "pass", evidence: "x" }] }), criteria).verdict, "BLOCK");
  assert.equal(parseReview(JSON.stringify({ verdict: "PASS", criteria: [{ id: "C1", status: "pass", evidence: "x" }, { id: "C1", status: "pass", evidence: "x" }] }), criteria).verdict, "BLOCK");
});
test("PASS cannot hide failed or unverified acceptance criteria", () => {
  const criteria = requestCriteria("Fix preview");
  for (const status of ["unverified", "fail"]) assert.equal(parseReview(JSON.stringify({ verdict: "PASS", criteria: [{ id: "C1", status, evidence: "not checked" }] }), criteria).verdict, "BLOCK");
});
test("strict review accepts complete JSON evidence, including fenced JSON", () => {
  const criteria = requestCriteria("Fix preview");
  const text = JSON.stringify({ verdict: "PASS", criteria: [{ id: "C1", status: "pass", evidence: "src/Preview.tsx; test report" }] });
  assert.equal(parseReview(text, criteria).verdict, "PASS");
  assert.equal(parseReview("```json\n" + text + "\n```", criteria).verdict, "PASS");
});
