import test from "node:test";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

test(
  "browser startup failure terminates its owned process even when SIGTERM is ignored",
  { timeout: 15000 },
  async () => {
    const dir = await fs.mkdtemp(
      path.join(
        fileURLToPath(new URL("../../", import.meta.url)),
        "forge-browser-cleanup-",
      ),
    );
    const pidFile = path.join(dir, "pid");
    const binary = path.join(dir, "fake-browser.mjs");
    await fs.writeFile(
      binary,
      `#!${process.execPath}\nimport fs from 'node:fs';fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`,
      { mode: 0o700 },
    );
    let pid;
    try {
      await assert.rejects(
        runBrowserTest("http://127.0.0.1:9999", [], { binary }),
        /Chrome belum siap/,
      );
      pid = Number(await fs.readFile(pidFile, "utf8"));
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
      }
      assert.equal(
        alive,
        false,
        "owned child must be gone before capture rejects",
      );
    } finally {
      if (!pid)
        pid = Number(await fs.readFile(pidFile, "utf8").catch(() => "0"));
      if (pid)
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* already gone */
        }
    }
  },
);

test("capture returns real PNG and safe bounded DOM measured at mobile viewport", async () => {
  const server = http.createServer((_req, res) =>
    res.end(
      `<html><body><h1>Hello</h1><button id="edit">Edit me</button><button></button><input type="password" value="NEVER_COLLECT"><div style="width:1200px">Wide</div></body></html>`,
    ),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await runBrowserTest(
      `http://127.0.0.1:${server.address().port}`,
      [],
      { capture: { viewport: "mobile", path: "/" } },
    );
    assert.ok(
      result.capture,
      "capture requested must return actual screenshot evidence",
    );
    const png = Buffer.from(result.capture.png, "base64");
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.equal(png.readUInt32BE(16), 390);
    assert.equal(result.capture.viewport.width, 390);
    assert.ok(result.capture.measurements.horizontalOverflow > 0);
    assert.ok(result.capture.measurements.unnamedControls > 0);
    assert.ok(
      result.capture.elements.some(
        (e) => e.tag === "button" && e.text === "Edit me" && e.selector,
      ),
    );
    assert.ok(
      !JSON.stringify(result.capture.elements).includes("NEVER_COLLECT"),
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
import assert from "node:assert/strict";
import { runBrowserTest, validateSteps } from "../server/browser-tests.mjs";

test("isolated capture blocks worker requests to unrelated loopback services", async () => {
  let contacted = 0;
  const outside = http.createServer((_q, r) => {
    contacted++;
    r.setHeader("Access-Control-Allow-Origin", "*");
    r.end("private");
  });
  await new Promise((r) => outside.listen(0, "127.0.0.1", r));
  const server = http.createServer((q, r) => {
    if (q.url === "/worker.js") {
      r.setHeader("Content-Type", "application/javascript");
      r.end(
        `fetch('http://127.0.0.1:${outside.address().port}/private').then(()=>postMessage('done')).catch(()=>postMessage('blocked'))`,
      );
    } else {
      r.setHeader("Content-Type", "text/html");
      r.end(
        '<html><body><h1>Worker isolation</h1><p id="result">pending</p><script>const ready=new Promise(resolve=>{new Worker("/worker.js").onmessage=e=>{document.getElementById("result").textContent=e.data;resolve();};});Object.defineProperty(document.fonts,"ready",{value:ready});</script></body></html>',
      );
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    await runBrowserTest(`http://127.0.0.1:${server.address().port}`, [], {
      capture: { viewport: "desktop", path: "/" },
    });
    assert.equal(contacted, 0, "worker must not bypass origin restriction");
  } finally {
    await new Promise((r) => server.close(r));
    await new Promise((r) => outside.close(r));
  }
});

test("browser test accepts local journeys but rejects external navigation and unbounded steps", async () => {
  assert.deepEqual(
    validateSteps([
      { action: "visit", path: "/register" },
      {
        action: "fill",
        selector: "input[name=email]",
        value: "me@example.test",
      },
      { action: "click", selector: "button[type=submit]" },
      { action: "expect", selector: "h1", value: "Selesai" },
    ]).length,
    4,
  );
  for (const path of [
    "https://example.com",
    "//example.com",
    "/\\example.com",
    "/x\nurl",
  ])
    assert.throws(() => validateSteps([{ action: "visit", path }]));
  assert.throws(() =>
    validateSteps(
      Array.from({ length: 13 }, () => ({
        action: "click",
        selector: "button",
      })),
    ),
  );
  assert.throws(() => validateSteps([{ action: "fill", selector: "input" }]));
  await assert.rejects(
    runBrowserTest("http://example.com:3000", []),
    /Preview lokal/,
  );
  await assert.rejects(
    runBrowserTest("http://127.0.0.1:3000", [
      { action: "visit", path: "//example.com" },
    ]),
    /path lokal/,
  );
});
