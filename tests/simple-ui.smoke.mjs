import test from "node:test";
import assert from "node:assert/strict";
import { isolatedForge } from "./visual-fixtures.mjs";
import { browser, until } from "./helpers/visual-browser.mjs";

const contrastProbe = `(() => {
  const lum = color => { const v=color.match(/[\\d.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return v[0]*.2126+v[1]*.7152+v[2]*.0722; };
  return ['.welcome h1','.welcome p','.composer-caption','#forge-composer'].map(selector=>{
    const el=document.querySelector(selector), style=getComputedStyle(el);let ancestor=el,bg;
    do { bg=getComputedStyle(ancestor).backgroundColor;ancestor=ancestor.parentElement; } while(ancestor && (bg==='rgba(0, 0, 0, 0)' || bg==='transparent'));
    const a=lum(style.color),b=lum(bg);return {selector,fg:style.color,bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
  });
})()`;

test(
  "calm neutral shell is readable in both themes and responsive without overflow",
  { timeout: 120000 },
  async (t) => {
    const forge = await isolatedForge(t);
    await forge.json("projects/create", { name: "Simple workspace" });
    const b = await browser(t, forge.root, [forge.connection.url]);
    await b.client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `localStorage.setItem('forge-theme','light')`,
    });
    await b.client.send("Page.navigate", {
      url: forge.connection.url + "/#token=" + forge.connection.token,
    });
    await until(() =>
      b.evaluate(`!!document.querySelector('#forge-composer:not(:disabled)')`),
    );
    assert.equal(
      await b.evaluate(
        `getComputedStyle(document.documentElement).fontFamily.includes('Segoe')`,
      ),
      true,
      "local system font",
    );
    assert.equal(
      await b.evaluate(
        `getComputedStyle(document.querySelector('.conversation')).backgroundColor`,
      ),
      "rgb(246, 248, 250)",
      "neutral light chat canvas",
    );
    assert.equal(
      await b.evaluate(
        `document.querySelector('.ai-picker-row')?.getBoundingClientRect().width || 0`,
      ),
      0,
      "model details are contextual, not a permanent settings box",
    );
    await b.click("AI · Test vision");
    await until(() =>
      b.evaluate(
        `document.querySelector('[aria-label="Provider AI"]')?.getBoundingClientRect().width > 0`,
      ),
    );
    await b.click("AI · Test vision");
    for (const theme of ["light", "dark"]) {
      if (theme === "dark") {
        await b.click("Tools");
        await b.click("Preferensi & proyek");
        await b.click("Gelap");
        await b.click("Tools");
      }
      for (const width of [1440, 1024, 390]) {
        await b.client.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: false,
        });
        assert.equal(
          await b.evaluate(
            `document.documentElement.scrollWidth <= innerWidth`,
          ),
          true,
          `${theme} ${width}: page overflow`,
        );
        assert.equal(
          await b.evaluate(
            `document.querySelector('.chat').getBoundingClientRect().width <= 860`,
          ),
          true,
          "readable chat measure",
        );
        const contrast = await b.evaluate(contrastProbe);
        console.log(theme, width, "contrast", JSON.stringify(contrast));
        for (const item of contrast)
          assert.ok(item.ratio >= 4.5, JSON.stringify(item));
        console.log(
          "Evidence",
          await b.screenshot(`simple-${theme}-${width}-chat.png`),
        );
        await b.click("Preview");
        assert.equal(
          await b.evaluate(
            `document.documentElement.scrollWidth <= innerWidth`,
          ),
          true,
          `${theme} ${width}: preview overflow`,
        );
        console.log(
          "Evidence",
          await b.screenshot(`simple-${theme}-${width}-preview.png`),
        );
        await b.click("Kembali ke chat");
        await until(() =>
          b.evaluate(`document.activeElement.id==='forge-composer'`),
        );
        const focus = await b.evaluate(`(() => {
        const e=document.querySelector('.composer'),s=getComputedStyle(e);
        const lum=c=>{const v=c.match(/[\\d.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return v[0]*.2126+v[1]*.7152+v[2]*.0722};
        const a=lum(s.borderTopColor),b=lum(s.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      })()`);
        assert.ok(focus >= 3, `focus/control contrast ${focus}`);
        console.log(theme, width, "focus contrast", focus);
        await b.click("Tools");
        assert.equal(
          await b.evaluate(
            `document.querySelector('.context-panel').getBoundingClientRect().right <= innerWidth`,
          ),
          true,
          "menu in viewport",
        );
        console.log(
          "Evidence",
          await b.screenshot(`simple-${theme}-${width}-tools.png`),
        );
        await b.click("Tools");
      }
    }
    assert.deepEqual(b.errors, []);
  },
);

test(
  "narrow preview never hides the active Stop control",
  { timeout: 60000 },
  async (t) => {
    const forge = await isolatedForge(t);
    await forge.json("projects/create", { name: "Safety fixture" });
    const b = await browser(t, forge.root, [forge.connection.url]);
    await b.client.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await b.client.send("Page.navigate", {
      url: forge.connection.url + "/#token=" + forge.connection.token,
    });
    await until(() =>
      b.evaluate(
        `!!document.querySelector('#forge-composer:not(:disabled)') && document.body.innerText.includes('Test vision')`,
      ),
    );
    await b.fill("#forge-composer", "HOLD_FOR_RESTART");
    await b.evaluate(
      `document.querySelector('[aria-label="Kirim pesan"]').click()`,
    );
    await until(async () => !!(await forge.json("state")).active);
    await until(() =>
      b.evaluate(`!!document.querySelector('[aria-label="Hentikan agent"]')`),
    );
    await b.click("Preview");
    assert.equal(
      await b.evaluate(
        `document.querySelector('[aria-label="Hentikan agent"]').checkVisibility()`,
      ),
      true,
      "Stop remains visible on narrow preview",
    );
    await b.evaluate(
      `document.querySelector('[aria-label="Hentikan agent"]').click()`,
    );
    await until(async () => !(await forge.json("state")).active);
  },
);

test(
  "chat-first shell ignores legacy Builder without losing draft or executing Preview",
  { timeout: 120000 },
  async (t) => {
    const forge = await isolatedForge(t);
    const project = await forge.json("projects/create", {
      name: "Chat fixture",
    });
    const b = await browser(t, forge.root, [forge.connection.url]);
    await b.client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `localStorage.setItem('forge-workspace-view','builder');localStorage.setItem('forge-theme','light');`,
    });
    await b.client.send("Page.navigate", {
      url: forge.connection.url + "/#token=" + forge.connection.token,
    });
    await until(() =>
      b.evaluate(`!!document.querySelector('#forge-composer:not(:disabled)')`),
    );
    assert.equal(
      await b.evaluate(`!!document.querySelector('.workspace.dedicated-chat')`),
      true,
      "legacy Builder must open chat-first",
    );
    assert.equal(
      await b.evaluate(
        `document.querySelector('.right-pane')?.getBoundingClientRect().width || 0`,
      ),
      0,
    );
    await b.fill("#forge-composer", "An unsent idea");
    await b.click("Preview");
    await until(() =>
      b.evaluate(
        `document.querySelector('.right-pane')?.getBoundingClientRect().width > 0`,
      ),
    );
    assert.equal(
      (await forge.json("state")).preview,
      null,
      "opening panel must not start preview",
    );
    assert.equal(
      await b.evaluate(
        `document.querySelector('.browser-tests').checkVisibility()`,
      ),
      false,
      "browser tests are contextual",
    );
    await b.click("Uji browser");
    assert.equal(
      await b.evaluate(
        `document.querySelector('.browser-tests').checkVisibility()`,
      ),
      true,
    );
    await b.click("Uji browser");
    await b.click("Jalankan preview");
    await until(() =>
      b.evaluate(`!!document.querySelector('[role="dialog"]')`),
    );
    assert.equal(
      (await forge.json("state")).preview,
      null,
      "Start waits for command confirmation",
    );
    await b.client.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await b.click("Kembali ke chat");
    assert.equal(
      await b.evaluate(`document.querySelector('#forge-composer').value`),
      "An unsent idea",
    );
    await until(
      async () =>
        (await forge.json(`session?projectId=${project.id}`)).draft.text ===
        "An unsent idea",
    );
    assert.equal(
      (await forge.json(`visual?projectId=${project.id}`)).run,
      null,
    );
    assert.equal(
      await b.evaluate(`!!document.querySelector('[aria-label="Tools"]')`),
      true,
      "advanced routes have a contextual Tools entry",
    );
    await b.click("Tools");
    await until(() =>
      b.evaluate(`!!document.querySelector('[aria-label="Tools panel"]')`),
    );
    await b.evaluate(
      `document.querySelector('[aria-label="Tools panel"] button').focus()`,
    );
    await b.client.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    assert.equal(
      await b.evaluate(`document.activeElement?.getAttribute('aria-label')`),
      "Tools",
    );
    const routes = {
      Kode: ".files-pane",
      Kanban: ".kanban-panel",
      Deploy: ".deploy-center",
      Agent: ".agent-center",
      Checkpoint: ".history",
      Pengaturan: ".integrations-pane",
      Aktivitas: ".activity",
      "Review visual": ".visual-review",
    };
    for (const [label, selector] of Object.entries(routes)) {
      await b.click("Tools");
      await b.click(label);
      await until(() =>
        b.evaluate(
          `document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`,
        ),
      );
      if (label === "Agent")
        for (const text of [
          "Project Memory",
          "Reusable skills",
          "Identitas desain",
        ])
          assert.equal(
            await b.evaluate(
              `document.querySelector('.agent-center').innerText.includes(${JSON.stringify(text)})`,
            ),
            true,
            text,
          );
      if (label === "Pengaturan")
        for (const text of [
          "Backup",
          "GitHub",
          "MCP servers",
          "AI API providers",
          "Web Search",
        ])
          assert.equal(
            await b.evaluate(
              `document.querySelector('.integrations-pane').innerText.includes(${JSON.stringify(text)})`,
            ),
            true,
            text,
          );
      if (label === "Deploy")
        for (const child of [
          ".backend-guide",
          ".release-panel",
          ".monitor-panel",
          ".security-gate",
        ])
          assert.equal(
            await b.evaluate(
              `!!document.querySelector(${JSON.stringify(child)})`,
            ),
            true,
            child,
          );
      assert.equal(
        await b.evaluate(
          `!!document.querySelector('[aria-label="Tools panel"]')`,
        ),
        false,
      );
      await b.click("Kembali ke chat");
    }
    await b.click("Proyek");
    await until(() =>
      b.evaluate(
        `document.querySelector('.sidebar')?.getBoundingClientRect().width > 0`,
      ),
    );
    await b.evaluate(`document.querySelector('.sidebar button').focus()`);
    await b.client.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    assert.equal(
      await b.evaluate(`document.querySelector('.sidebar').hidden`),
      true,
      "sidebar Escape closes and persists",
    );
    assert.equal(
      await b.evaluate(`document.activeElement.id`),
      "project-toggle",
    );
    await b.click("Proyek");
    await b.click("Proyek baru ⌘");
    await until(() =>
      b.evaluate(`!!document.querySelector('[role="dialog"]')`),
    );
    await until(() =>
      b.evaluate(
        `document.querySelector('[role="dialog"]')?.contains(document.activeElement)`,
      ),
    );
    await b.client.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await until(() => b.evaluate(`!document.querySelector('[role="dialog"]')`));
    await b.click("Tutup proyek");
    await b.click("Tools");
    await b.click("Forge Guide");
    await until(() => b.evaluate(`!!document.querySelector('.guide-panel')`));
    await until(() =>
      b.evaluate(
        `document.querySelector('.guide-panel')?.contains(document.activeElement)`,
      ),
    );
    await b.client.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await until(() => b.evaluate(`!document.querySelector('.guide-panel')`));
    assert.equal(
      await b.evaluate(`document.activeElement.getAttribute('aria-label')`),
      "Tools",
    );
    assert.deepEqual(b.errors, []);
  },
);
