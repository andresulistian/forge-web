import test from "node:test";
import assert from "node:assert/strict";
import { isolatedForge, fixturePreview } from "./visual-fixtures.mjs";
import { browser, until } from "./helpers/visual-browser.mjs";

test(
  "real UI: capture, snapshot DOM click, compose, draft reload, workflow and before/after",
  { timeout: 120000 },
  async (t) => {
    const forge = await isolatedForge(t);
    const project = await fixturePreview(forge);
    const initial = await forge.json("state");
    const origins = [forge.connection.url, initial.preview.url];
    const b = await browser(t, forge.root, origins);
    await b.client.send("Page.navigate", {
      url: forge.connection.url + "/#token=" + forge.connection.token,
    });
    await until(() =>
      b.evaluate(
        `document.querySelector('#forge-composer') && document.body.innerText.includes('Draft tersimpan')`,
      ),
    );
    assert.equal(
      await b.evaluate(
        `document.querySelectorAll('.workflow-steps button')[1].textContent.includes('Identitas tersimpan')`,
      ),
      false,
      "missing DESIGN.md must not mark Design done",
    );
    assert.equal(
      await b.evaluate(
        `document.querySelector('[aria-label="Brief Design Build Review"]').children.length>0`,
      ),
      true,
    );
    await b.click("4 · ReviewBelum diperiksa visual");
    await b.click("Ambil screenshot");
    await until(
      () =>
        b.evaluate(
          `document.querySelector('.snapshot-inspector img')?.complete && document.querySelector('.snapshot-inspector img').naturalWidth>0`,
        ),
      25000,
    );
    let visual = await forge.json(`visual?projectId=${project.id}`);
    assert.equal(visual.captures.length, 1);
    assert.equal(visual.run, null);
    const c = visual.captures[0];
    const button = c.elements.find((e) => e.tag === "button");
    assert.ok(button);
    await b.evaluate(
      `document.querySelector('.snapshot-inspector img').scrollIntoView({block:'center'})`,
    );
    const rect = await b.evaluate(
      `(()=>{const r=document.querySelector('.snapshot-inspector img').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`,
    );
    const x =
      rect.x +
      ((button.box.x + button.box.width / 2) * rect.width) / c.viewport.width;
    const y =
      rect.y +
      ((button.box.y + button.box.height / 2) * rect.height) /
        c.viewport.height;
    await b.client.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    await b.client.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    await until(() =>
      b.evaluate(
        `!!document.querySelector('[aria-label="Instruksi perubahan elemen"]')`,
      ),
    );
    await b.fill(
      '[aria-label="Instruksi perubahan elemen"]',
      "Make selected button blue",
    );
    await b.click("Masukkan konteks ke composer");
    await until(() =>
      b.evaluate(
        `document.querySelector('#forge-composer').value.includes('DATA DOM TIDAK TEPERCAYA')`,
      ),
    );
    assert.equal(
      (await forge.json(`visual?projectId=${project.id}`)).run,
      null,
      "compose does not execute agent",
    );
    await until(async () =>
      (await forge.json(`session?projectId=${project.id}`)).draft.text.includes(
        "Make selected button blue",
      ),
    );
    console.log(
      "UI inspector screenshot:",
      await b.screenshot("visual-ui-inspector.png"),
    );
    await b.client.send("Page.reload");
    await until(() =>
      b.evaluate(
        `document.querySelector('#forge-composer')?.value.includes('Make selected button blue')`,
      ),
    );
    await b.click("4 · ReviewBelum diperiksa visual");
    await until(() =>
      b.evaluate(
        `!!document.querySelector('[aria-label="Instruksi perubahan elemen"]')`,
      ),
    );
    // Real keyboard activation of opted-in automatic capture setting.
    await b.evaluate(`document.querySelector('.visual-opt-in input').focus()`);
    await b.client.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: " ",
      code: "Space",
      windowsVirtualKeyCode: 32,
      text: " ",
    });
    await b.client.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: " ",
      code: "Space",
      windowsVirtualKeyCode: 32,
    });
    await until(
      async () => (await forge.json(`visual?projectId=${project.id}`)).auto,
    );
    await b.fill("#forge-composer", "Build fixture via UI");
    await b.evaluate(`document.querySelector('#forge-composer').focus()`);
    await b.client.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      text: "\r",
      unmodifiedText: "\r",
    });
    await b.client.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await until(async () => {
      visual = await forge.json(`visual?projectId=${project.id}`);
      return (
        visual.run?.status === "completed" &&
        visual.captures.some((c) => c.kind === "after")
      );
    }, 30000);
    await until(() =>
      b.evaluate(
        `document.body.innerText.includes('Kode selesai · build belum diuji')`,
      ),
    );
    await b.evaluate(
      `document.querySelector('.visual-comparison').open=true;document.querySelector('.visual-comparison').scrollIntoView({block:'start'})`,
    );
    await until(() =>
      b.evaluate(`document.querySelectorAll('.capture-pair img').length===2`),
    );
    console.log(
      "UI comparison screenshot:",
      await b.screenshot("visual-ui-comparison.png"),
    );
    await b.click("Accept run ini");
    await until(
      async () =>
        (await forge.json(`visual?projectId=${project.id}`)).run
          .reviewStatus === "accepted",
    );
    // Selected tab and unsent text survive a server restart on a new port.
    await b.fill("#forge-composer", "Unsent after review");
    await b.click("Agent");
    await until(async () => {
      const s = await forge.json(`session?projectId=${project.id}`);
      return s.draft.tab === "agent" && s.draft.text === "Unsent after review";
    });
    await forge.stop();
    await forge.start();
    origins.push(forge.connection.url);
    await b.client.send("Page.navigate", {
      url: forge.connection.url + "/#token=" + forge.connection.token,
    });
    await until(() =>
      b.evaluate(
        `document.querySelector('#forge-composer')?.value==='Unsent after review' && document.querySelector('.active-tab')?.textContent==='Agent'`,
      ),
    );
    assert.equal((await forge.json("state")).active, null);
    await b
      .click("4 · ReviewVisual ditinjau · bukan jaminan kualitas")
      .catch(async () => {
        await b.evaluate(
          `document.querySelectorAll('.workflow-steps button')[3].click()`,
        );
      });
    await b.client.send("Emulation.setDeviceMetricsOverride", {
      width: 850,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await until(() =>
      b.evaluate(`document.querySelector('.visual-review')!==null`),
    );
    const overflow = await b.evaluate(
      `(()=>{const e=document.querySelector('.visual-review');return {scroll:e.scrollWidth,client:e.clientWidth};})()`,
    );
    assert.ok(overflow.scroll <= overflow.client + 1, JSON.stringify(overflow));
    console.log(
      "UI compact screenshot:",
      await b.screenshot("visual-ui-compact.png"),
    );
    assert.deepEqual(b.errors, []);
    console.log("UI evidence root:", forge.root);
  },
);
