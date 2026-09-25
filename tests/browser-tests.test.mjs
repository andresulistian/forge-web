import test from "node:test";
import assert from "node:assert/strict";
import { runBrowserTest, validateSteps } from "../server/browser-tests.mjs";

test("browser test accepts local journeys but rejects external navigation and unbounded steps", async () => {
  assert.deepEqual(validateSteps([
    { action: "visit", path: "/register" },
    { action: "fill", selector: "input[name=email]", value: "me@example.test" },
    { action: "click", selector: "button[type=submit]" },
    { action: "expect", selector: "h1", value: "Selesai" },
  ]).length, 4);
  for (const path of ["https://example.com", "//example.com", "/\\example.com", "/x\nurl"])
    assert.throws(() => validateSteps([{ action: "visit", path }]));
  assert.throws(() => validateSteps(Array.from({ length: 13 }, () => ({ action: "click", selector: "button" }))));
  assert.throws(() => validateSteps([{ action: "fill", selector: "input" }]));
  await assert.rejects(runBrowserTest("http://example.com:3000", []), /Preview lokal/);
  await assert.rejects(runBrowserTest("http://127.0.0.1:3000", [{ action: "visit", path: "//example.com" }]), /path lokal/);
});
