import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { sanitizeEnv } from "./env.mjs";
import { previewProxy } from "./preview-proxy.mjs";

const choices =
  process.platform === "darwin"
    ? [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      ]
    : [
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/opt/google/chrome/chrome",
      ];

export function validateSteps(steps) {
  if (!Array.isArray(steps) || steps.length > 12)
    throw Error("Maksimal 12 langkah uji.");
  return steps.map((step) => {
    if (!step || !["visit", "click", "fill", "expect"].includes(step.action))
      throw Error("Jenis langkah tidak valid.");
    if (step.action === "visit") {
      if (
        typeof step.path !== "string" ||
        !step.path.startsWith("/") ||
        step.path.startsWith("//") ||
        step.path.length > 150 ||
        /[\\\r\n]/.test(step.path)
      )
        throw Error("Gunakan path lokal seperti / atau /halaman.");
      return { action: "visit", path: step.path };
    }
    if (
      typeof step.selector !== "string" ||
      !step.selector.trim() ||
      step.selector.length > 200
    )
      throw Error("Isi CSS selector yang valid (maksimal 200 karakter).");
    if (step.action === "click")
      return { action: "click", selector: step.selector };
    if (typeof step.value !== "string" || step.value.length > 300)
      throw Error("Teks langkah maksimal 300 karakter.");
    return { action: step.action, selector: step.selector, value: step.value };
  });
}

export class DevTools {
  constructor(url, onEvent) {
    this.ws = new WebSocket(url);
    this.pending = new Map();
    this.nextId = 0;
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener(
        "error",
        () => reject(Error("Browser tidak dapat dihubungi.")),
        { once: true },
      );
    });
    this.ws.addEventListener("message", (event) => {
      const value = JSON.parse(event.data);
      if (value.method) return onEvent(value.method, value.params || {});
      const entry = this.pending.get(value.id);
      if (!entry) return;
      this.pending.delete(value.id);
      clearTimeout(entry.timer);
      if (value.error) entry.reject(Error(value.error.message));
      else entry.resolve(value.result);
    });
    this.ws.addEventListener("close", () => {
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(Error("Browser terputus."));
      }
      this.pending.clear();
    });
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(`Browser tidak merespons dalam 12 detik: ${method}`));
      }, 12000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() {
    this.ws.close();
  }
}

async function waitFor(check, message, ms = 5000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw Error(message);
}

export async function runBrowserTest(previewUrl, rawSteps, options = {}) {
  const steps = validateSteps(rawSteps);
  const captureRequest = options.capture;
  const viewport =
    captureRequest?.viewport === "mobile"
      ? { width: 390, height: 844, name: "mobile" }
      : { width: 1440, height: 900, name: "desktop" };
  if (captureRequest) {
    if (!["desktop", "mobile"].includes(captureRequest.viewport))
      throw Error("Viewport tidak valid.");
    validateSteps([{ action: "visit", path: captureRequest.path }]);
  }
  const base = new URL(previewUrl);
  if (
    base.protocol !== "http:" ||
    base.hostname !== "127.0.0.1" ||
    !/^\d+$/.test(base.port)
  )
    throw Error("Pengujian hanya mendukung Preview lokal Forge.");
  const binary =
    options.binary ||
    process.env.FORGE_TEST_BROWSER ||
    (await (async () => {
      for (const candidate of choices) {
        try {
          await fs.access(candidate);
          return candidate;
        } catch {
          /* try next */
        }
      }
      throw Error(
        "Chrome/Chromium belum terpasang. Instal Google Chrome untuk memakai pengujian browser.",
      );
    })());
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "forge-browser-"));
  let child;
  let devtools;
  let proxy;
  const networkIsolation = {
    policy: "exact-preview-origin-proxy",
    blockedRequests: 0,
    scope:
      "browser-wide; includes browser background traffic, not necessarily page errors",
  };
  const findings = [];
  const finding = (message) => {
    if (findings.length < 20) findings.push(message);
  };
  const checks = [];
  let mainFrame = null;
  try {
    proxy = await previewProxy(base.origin, () => {
      networkIsolation.blockedRequests++;
    });
    child = spawn(
      binary,
      [
        "--headless=new",
        "--password-store=basic",
        "--use-mock-keychain",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-features=Translate",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
        `--proxy-server=${proxy.url}`,
        "--proxy-bypass-list=<-loopback>",
        "--disable-quic",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "about:blank",
      ],
      { stdio: "ignore", env: sanitizeEnv() },
    );
    let exited = false;
    let spawnError = null;
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("exit", () => {
      exited = true;
    });
    const port = await waitFor(async () => {
      if (spawnError)
        throw Error(`Chrome gagal dijalankan: ${spawnError.message}`);
      if (exited) throw Error("Chrome gagal dijalankan.");
      try {
        const value = (
          await fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8")
        ).split("\n")[0];
        return /^\d+$/.test(value) ? value : null;
      } catch {
        return null;
      }
    }, "Chrome belum siap setelah 5 detik.");
    const list = await (
      await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(3000),
      })
    ).json();
    const page = list.find(
      (entry) => entry.type === "page" && entry.webSocketDebuggerUrl,
    );
    if (!page) throw Error("Tab pengujian tidak tersedia.");
    devtools = new DevTools(page.webSocketDebuggerUrl, (method, params) => {
      if (method === "Fetch.requestPaused") {
        const requested = params.request.url;
        let allowed = false;
        try {
          allowed = new URL(requested).origin === base.origin;
        } catch {
          /* block */
        }
        void devtools
          .send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", {
            requestId: params.requestId,
            ...(!allowed ? { errorReason: "BlockedByClient" } : {}),
          })
          .catch(() => {});
        if (!allowed) finding("Permintaan di luar Preview diblokir.");
      }
      if (method === "Page.frameNavigated" && !params.frame.parentId)
        mainFrame = params.frame.id;
      if (method === "Runtime.exceptionThrown")
        finding(`JavaScript: ${params.exceptionDetails?.text || "error"}`);
      if (method === "Log.entryAdded" && params.entry?.level === "error")
        finding(`Console: ${params.entry.text.slice(0, 220)}`);
      if (
        method === "Network.responseReceived" &&
        params.type === "Document" &&
        params.response.status >= 400
      )
        finding(`HTTP ${params.response.status}: halaman gagal dimuat.`);
    });
    await Promise.all([
      devtools.send("Page.enable"),
      devtools.send("Runtime.enable"),
      devtools.send("Log.enable"),
      devtools.send("Network.enable"),
    ]);
    await devtools.send("Fetch.enable", {
      patterns: [{ urlPattern: "*", requestStage: "Request" }],
    });
    const evaluate = async (expression) => {
      const result = await devtools.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails)
        throw Error(
          result.exceptionDetails.text || "Gagal menjalankan langkah browser.",
        );
      return result.result.value;
    };
    const localPage = async () => {
      const location = await evaluate("location.href");
      if (new URL(location).origin !== base.origin)
        throw Error("Browser meninggalkan Preview lokal.");
    };
    const visit = async (url) => {
      const target = new URL(url, base);
      if (target.origin !== base.origin)
        throw Error("Halaman harus berada di Preview lokal.");
      const response = await devtools.send("Page.navigate", {
        url: target.href,
      });
      if (response.errorText)
        throw Error(`Halaman gagal dimuat: ${response.errorText}`);
      await waitFor(
        async () => {
          if (mainFrame && response.frameId !== mainFrame) return false;
          try {
            return await evaluate(
              `document.readyState === 'complete' && location.pathname === ${JSON.stringify(target.pathname)}`,
            );
          } catch {
            return false;
          }
        },
        "Halaman tidak selesai dimuat.",
        10000,
      );
      await localPage();
    };
    if (captureRequest) {
      await devtools.send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await devtools.send("Network.setBypassServiceWorker", { bypass: true });
      await devtools.send("Network.setBlockedURLs", {
        urls: ["ws://*", "wss://*", "file://*"],
      });
      await devtools.send("Page.setDownloadBehavior", { behavior: "deny" });
      await devtools.send("Page.addScriptToEvaluateOnNewDocument", {
        source: "window.open = () => null;",
      });
    }
    await visit(
      captureRequest ? new URL(captureRequest.path, base).href : base.href,
    );
    let capture;
    if (captureRequest) {
      // Bounded settling: a fresh isolated page, fonts or timeout, then two paint frames.
      await evaluate(
        `Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))`,
      );
      // CDP pierces closed as well as open roots; mask the entire host, not
      // merely text in light DOM. Frames/plugins are conservatively hidden.
      await devtools.send("Emulation.setScriptExecutionDisabled", {
        value: true,
      });
      await devtools.send("DOM.enable");
      const { root } = await devtools.send("DOM.getDocument", {
        depth: -1,
        pierce: true,
      });
      const markHosts = async (node) => {
        if (node.shadowRoots?.length) {
          await devtools.send("DOM.setAttributeValue", {
            nodeId: node.nodeId,
            name: "data-forge-private",
            value: "",
          });
        }
        for (const child of node.children || []) await markHosts(child);
        for (const shadow of node.shadowRoots || []) await markHosts(shadow);
      };
      await markHosts(root);
      const masking = await evaluate(`(() => {
        const privateSelector='input,textarea,select,[contenteditable],iframe,frame,object,embed,[data-forge-private]';
        const regions=[...document.querySelectorAll(privateSelector)];
        const style=document.createElement('style');
        style.textContent='*,*::before,*::after { animation:none !important; transition:none !important; caret-color:transparent !important; }';
        document.head.append(style);
        for(const el of regions) {
          const rect=el.getBoundingClientRect();
          el.setAttribute('data-forge-private','');
          el.style.setProperty('opacity','0','important');
          for(const node of [el,...el.querySelectorAll('*')]) node.style.setProperty('visibility','hidden','important');
          const mask=document.createElement('div'); mask.setAttribute('data-forge-private','');
          mask.style.cssText='all:initial!important;position:fixed!important;background:#222!important;opacity:1!important;z-index:2147483647!important;pointer-events:none!important;left:'+rect.x+'px!important;top:'+rect.y+'px!important;width:'+rect.width+'px!important;height:'+rect.height+'px!important;';
          document.documentElement.append(mask);
        }
        return {regions:regions.length, policy:'opaque editable regions, entire shadow hosts and frames; ordinary page text is not secret-scanned'};
      })()`);
      const snapshot = await evaluate(`(() => {
        const safeText = el => { const clone = el.cloneNode(true); clone.querySelectorAll('input,textarea,select,script,style,[contenteditable],iframe,frame,object,embed,[data-forge-private]').forEach(n => n.remove()); return (clone.textContent || '').replace(/\\s+/g, ' ').trim().slice(0,160); };
        const selector = el => { const parts = []; let n = el; for (let i=0; n && n.nodeType===1 && i<18; i++, n=n.parentElement) { const tag=n.localName; const peers=n.parentElement ? [...n.parentElement.children].filter(x=>x.localName===tag) : [n]; parts.unshift(tag+':nth-of-type('+(peers.indexOf(n)+1)+')'); } const s=parts.join(' > '); return s.length<=1000 && document.querySelectorAll(s).length===1 && document.querySelector(s)===el ? s : null; };
        const elements=[]; let unnamedControls=0;
        for (const el of [...document.querySelectorAll('body *')].slice(0,10000)) {
          if (el.closest('input,textarea,select,script,style,[contenteditable],iframe,frame,object,embed,[data-forge-private]')) continue;
          const rect=el.getBoundingClientRect(); const css=getComputedStyle(el);
          if (rect.width<=0 || rect.height<=0 || rect.bottom<=0 || rect.right<=0 || rect.top>=innerHeight || rect.left>=innerWidth || css.visibility!=='visible' || css.display==='none') continue;
          const text=safeText(el); const role=(el.getAttribute('role')||'').slice(0,60); const label=(el.getAttribute('aria-label')||el.getAttribute('alt')||'').slice(0,160);
          if ((el.matches('button,a[href]') || ['button','link'].includes(role)) && !text && !label && !el.getAttribute('aria-labelledby')) unnamedControls++;
          if (elements.length>=500) continue;
          const s=selector(el); if (!s) continue;
          elements.push({ tag:el.localName, selector:s, text, accessible:{role,label}, box:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}, source:null });
        }
        return {elements, measurements:{horizontalOverflow:Math.max(0,document.documentElement.scrollWidth-innerWidth), unnamedControls}, scroll:{x:scrollX,y:scrollY}, location:location.pathname+location.search, capturedAt:new Date().toISOString()};
      })()`);
      await localPage();
      const screenshot = await devtools.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
        fromSurface: true,
      });
      await devtools.send("Emulation.setScriptExecutionDisabled", {
        value: false,
      });
      if (screenshot.data.length > 16_000_000)
        throw Error("Screenshot terlalu besar.");
      capture = {
        ...snapshot,
        masking,
        networkIsolation: { ...networkIsolation },
        png: screenshot.data,
        viewport,
        findings: [...findings],
        settling: "bounded-fonts-and-two-frames",
        reviewStatus: "not-reviewed",
      };
    }
    const title = await evaluate("document.title || ''");
    const visible = await evaluate(
      "document.body?.innerText?.trim().slice(0, 10000) || ''",
    );
    if (!visible) finding("Halaman tidak memiliki teks yang terlihat.");
    checks.push({
      action: "load",
      label: `Halaman utama (${title || "tanpa judul"})`,
      ok: !!visible,
    });
    for (const step of steps) {
      const label =
        step.action === "visit"
          ? step.path
          : `${step.action}: ${step.selector}`;
      try {
        await localPage();
        if (step.action === "visit") await visit(step.path);
        else {
          const selector = JSON.stringify(step.selector);
          await waitFor(async () => {
            try {
              return await evaluate(
                `Boolean(document.querySelector(${selector}))`,
              );
            } catch {
              return false;
            }
          }, `Elemen tidak ditemukan: ${step.selector}`);
          if (step.action === "expect") {
            await waitFor(
              async () => {
                try {
                  return (
                    await evaluate(
                      `document.querySelector(${selector})?.textContent || ''`,
                    )
                  ).includes(step.value);
                } catch {
                  return false;
                }
              },
              `Teks "${step.value.slice(0, 60)}" tidak ditemukan.`,
            );
          } else if (step.action === "fill") {
            const value = JSON.stringify(step.value);
            const filled = await evaluate(
              `(() => { const el = document.querySelector(${selector}); if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false; const setter = Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set; setter.call(el, ${value}); el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); return true; })()`,
            );
            if (!filled) throw Error("Elemen bukan input atau textarea.");
          } else await evaluate(`document.querySelector(${selector}).click()`);
          await localPage();
        }
        checks.push({ action: step.action, label, ok: true });
      } catch (error) {
        checks.push({
          action: step.action,
          label,
          ok: false,
          error: error.message,
        });
        break;
      }
    }
    return {
      ...(capture ? { capture } : {}),
      networkIsolation: { ...networkIsolation },
      ok: checks.every((check) => check.ok) && findings.length === 0,
      checks,
      findings,
      testedAt: new Date().toISOString(),
    };
  } finally {
    devtools?.close();
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => child.kill("SIGKILL"), 1500);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill("SIGTERM");
      });
    }
    await proxy?.close();
    await fs.rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 200,
    });
  }
}
