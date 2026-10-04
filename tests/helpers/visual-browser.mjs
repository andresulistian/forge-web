import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { DevTools } from "../../server/browser-tests.mjs";

export async function browser(t, root, origins) {
  const profile = await fs.mkdtemp(path.join(root, "ui-chrome-"));
  const child = spawn(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    [
      "--headless=new",
      "--password-store=basic",
      "--use-mock-keychain",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    {
      env: { PATH: process.env.PATH, HOME: root, TMPDIR: root },
      stdio: "ignore",
    },
  );
  let client;
  t.after(async () => {
    client?.close();
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((r) => child.once("exit", r)),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  });
  let port;
  await until(async () => {
    try {
      port = (
        await fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8")
      ).split("\n")[0];
      return !!port;
    } catch {
      return false;
    }
  });
  const pages = await (
    await fetch(`http://127.0.0.1:${port}/json/list`)
  ).json();
  const errors = [];
  client = new DevTools(
    pages.find((p) => p.type === "page").webSocketDebuggerUrl,
    (method, params) => {
      if (method === "Runtime.exceptionThrown")
        errors.push(params.exceptionDetails.text);
      if (method === "Fetch.requestPaused") {
        const allowed = origins.some((origin) => {
          try {
            return new URL(params.request.url).origin === origin;
          } catch {
            return false;
          }
        });
        void client
          .send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", {
            requestId: params.requestId,
            ...(allowed ? {} : { errorReason: "BlockedByClient" }),
          })
          .catch(() => {});
      }
    },
  );
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const evaluate = async (expression) => {
    const r = await client.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const click = async (label) => {
    let point;
    await until(async () => {
      point = await evaluate(`(() => {
        const el=[...document.querySelectorAll('button,summary')].find(e=>e.textContent.trim()===${JSON.stringify(label)} && e.checkVisibility() && !e.disabled);
        if(!el) return null;
        el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();
        return {x:r.x+r.width/2,y:r.y+r.height/2};
      })()`);
      return !!point;
    });
    await client.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...point,
      button: "left",
      clickCount: 1,
    });
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...point,
      button: "left",
      clickCount: 1,
    });
  };
  const fill = async (selector, value) =>
    evaluate(
      `(()=>{const el=document.querySelector(${JSON.stringify(selector)}); const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return el.value;})()`,
    );
  return {
    client,
    evaluate,
    click,
    fill,
    errors,
    screenshot: async (name) => {
      const r = await client.send("Page.captureScreenshot", { format: "png" });
      const file = path.join(root, name);
      await fs.writeFile(file, Buffer.from(r.data, "base64"));
      return file;
    },
  };
}
export async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Timed out waiting for UI condition");
}
