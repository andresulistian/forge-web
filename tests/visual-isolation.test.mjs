import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { runBrowserTest } from "../server/browser-tests.mjs";

async function serve(t, handler) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${server.address().port}`;
}
test(
  "ordinary same-origin preview remains a passing browser test despite blocked browser background traffic",
  { timeout: 30000 },
  async (t) => {
    const origin = await serve(t, (_q, r) =>
      r.end("<h1>Ordinary preview</h1>"),
    );
    const result = await runBrowserTest(origin, []);
    assert.equal(result.ok, true, JSON.stringify(result.findings));
  },
);

test(
  "dedicated/shared workers, redirects, WebSockets and popups cannot reach a second origin",
  { timeout: 30000 },
  async (t) => {
    const escaped = [],
      local = [];
    const other = await serve(t, (q, r) => {
      escaped.push(q.url);
      r.setHeader("Access-Control-Allow-Origin", "*");
      r.end("external");
    });
    const origin = await serve(t, (q, r) => {
      local.push(q.url);
      if (q.url === "/redirect") {
        r.writeHead(302, { Location: other + "/redirect-proof" });
        r.end();
        return;
      }
      if (q.url === "/worker.js" || q.url === "/shared.js") {
        r.setHeader("Content-Type", "application/javascript");
        r.end(
          `(async()=>{await fetch('/started-'+${JSON.stringify(q.url.slice(1))}); for(const url of ['${other}/worker-proof','/redirect']){try{await fetch(url)}catch{}} try{new WebSocket('${other.replace("http:", "ws:")}/socket')}catch{} await fetch('/finished-'+${JSON.stringify(q.url.slice(1))});})();`,
        );
        return;
      }
      r.setHeader("Content-Type", "text/html");
      r.end(
        `<h1>Preview usable</h1><script>new Worker('/worker.js');new SharedWorker('/shared.js');window.open('${other}/popup');</script>`,
      );
    });
    await runBrowserTest(
      origin,
      [{ action: "expect", selector: "h1", value: "Preview usable" }],
      { capture: { viewport: "mobile", path: "/" } },
    );
    assert.ok(local.includes("/started-worker.js"));
    assert.ok(local.includes("/started-shared.js"));
    assert.ok(local.includes("/finished-worker.js"));
    assert.ok(local.includes("/finished-shared.js"));
    assert.ok(local.includes("/redirect"));
    assert.deepEqual(escaped, []);
  },
);

test(
  "capture masks styled editable descendants, closed shadow controls and frame contents in real PNG",
  { timeout: 30000 },
  async (t) => {
    let secret = "SECRET_A";
    const origin = await serve(t, (_q, r) => {
      r.setHeader("Content-Type", "text/html");
      r.end(
        `<body><h1>Public heading</h1><div contenteditable style="width:200px;height:50px"><b style="color:red!important">${secret}</b></div><div id="shadow" style="width:200px;height:50px"></div><iframe srcdoc="<b>${secret}</b>"></iframe><script>document.querySelector('#shadow').attachShadow({mode:'closed'}).innerHTML='<input value="${secret}"><b style="visibility:visible;position:fixed;top:600px;left:0">${secret}</b>';</script></body>`,
      );
    });
    const a = (
      await runBrowserTest(origin, [], {
        capture: { viewport: "mobile", path: "/" },
      })
    ).capture;
    secret = "SECRET_B";
    const b = (
      await runBrowserTest(origin, [], {
        capture: { viewport: "mobile", path: "/" },
      })
    ).capture;
    assert.equal(
      a.png,
      b.png,
      "changing only private values must not change screenshot pixels",
    );
    assert.ok(a.masking.regions >= 3);
    assert.ok(!JSON.stringify(a.elements).includes("SECRET_"));
  },
);

test(
  "browser-wide isolation blocks service-worker own fetch while same-origin worker executes",
  { timeout: 30000 },
  async (t) => {
    const escaped = [],
      local = [];
    const other = await serve(t, (q, r) => {
      escaped.push(q.url);
      r.setHeader("Access-Control-Allow-Origin", "*");
      r.end("proof");
    });
    const origin = await serve(t, (q, r) => {
      local.push(q.url);
      if (q.url === "/sw.js") {
        r.setHeader("Content-Type", "application/javascript");
        r.end(
          `self.addEventListener('install', e => e.waitUntil((async()=>{await fetch('/worker-started'); try {await fetch('${other}/proof')} catch {} await fetch('/worker-finished');})()));`,
        );
      } else {
        r.setHeader("Content-Type", "text/html");
        r.end(
          `<h1>Ordinary preview works</h1><script>navigator.serviceWorker.register('/sw.js');</script>`,
        );
      }
    });
    await runBrowserTest(
      origin,
      [{ action: "expect", selector: "h1", value: "Ordinary preview works" }],
      { capture: { viewport: "mobile", path: "/" } },
    );
    assert.ok(
      local.includes("/worker-started"),
      "real service worker must execute",
    );
    assert.deepEqual(
      escaped,
      [],
      "second loopback server must receive no request",
    );
    assert.ok(
      local.includes("/worker-finished"),
      "same-origin worker requests remain functional",
    );
  },
);
