import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { isolatedForge, fixturePreview } from "./visual-fixtures.mjs";
import { browser, until } from "./helpers/visual-browser.mjs";

async function setup(t, preview = false) {
  const forge = await isolatedForge(t);
  if (preview) await fixturePreview(forge);
  else await forge.json("projects/create", { name: "Review fixture" });
  const state = await forge.json("state");
  const b = await browser(
    t,
    forge.root,
    [forge.connection.url, state.preview?.url].filter(Boolean),
  );
  await b.client.send("Page.navigate", {
    url: forge.connection.url + "/#token=" + forge.connection.token,
  });
  await until(() =>
    b.evaluate(
      `!!document.querySelector('#forge-composer:not(:disabled)') && document.body.innerText.includes('Draft tersimpan') && document.body.innerText.includes('Test vision')`,
    ),
  );
  return { forge, b };
}
async function point(b, selector) {
  return b.evaluate(
    `(() => {const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
  );
}

async function theme(b, value) {
  await b.click("Tools");
  await b.click("Preferensi & proyek");
  const label = value === "light" ? "Terang" : "Gelap";
  if (
    await b.evaluate(
      `Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()===${JSON.stringify(label)})`,
    )
  )
    await b.click(label);
  await b.click("Tools");
}

test(
  "annotation editing preserves the rendered preview in both themes",
  { timeout: 120000 },
  async (t) => {
    const { b } = await setup(t, true);
    for (const value of ["light", "dark"]) {
      await theme(b, value);
      await b.click("Preview");
      await until(() =>
        b.evaluate(`!!document.querySelector('.preview-canvas iframe')`),
      );
      // Compare actual pixels inside the iframe, excluding the mode toolbar.
      const clip = await b.evaluate(
        `(() => {const r=document.querySelector('.preview-canvas').getBoundingClientRect();return {x:r.x+4,y:r.y+4,width:r.width-8,height:r.height-8,scale:1};})()`,
      );
      const before = await b.client.send("Page.captureScreenshot", {
        format: "png",
        clip,
      });
      await b.evaluate(
        `document.querySelector('button[aria-label="Annotation preview"]').click()`,
      );
      const after = await b.client.send("Page.captureScreenshot", {
        format: "png",
        clip,
      });
      console.log(
        "Evidence",
        await b.screenshot(`review-annotation-${value}.png`),
      );
      const alpha = await b.evaluate(
        `(() => {const c=getComputedStyle(document.querySelector('.annotation-layer.is-editing')).backgroundColor;const v=c.match(/[\\d.]+/g).map(Number);return v.length===4?v[3]:1;})()`,
      );
      assert.ok(
        alpha <= 0.15,
        `preview must remain visible, overlay alpha=${alpha}`,
      );
      assert.ok(
        before.data === after.data,
        `${value}: annotation mode must preserve iframe pixels`,
      );
      await b.evaluate(
        `document.querySelector('button[aria-label="Annotation preview"]').click()`,
      );
      await b.click("Kembali ke chat");
    }
    assert.deepEqual(b.errors, []);
  },
);

test(
  "enabled Send retains icon contrast on hover and keyboard focus",
  { timeout: 120000 },
  async (t) => {
    const { b } = await setup(t);
    for (const value of ["light", "dark"]) {
      await theme(b, value);
      await b.fill("#forge-composer", "Unsent contrast fixture");
      for (const state of ["hover", "focus"]) {
        await b.client.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          ...(state === "hover" ? await point(b, ".send") : { x: 1, y: 1 }),
        });
        if (state === "focus") {
          await b.evaluate(`document.querySelector('#forge-composer').focus()`);
          await b.client.send("Input.dispatchKeyEvent", {
            type: "keyDown",
            key: "Tab",
            code: "Tab",
            windowsVirtualKeyCode: 9,
          });
          await b.evaluate(`document.querySelector('.send').focus()`);
        }
        await new Promise((r) => setTimeout(r, 200));
        const colors = await b.evaluate(
          `(() => {const s=getComputedStyle(document.querySelector('.send'));return [s.color,s.backgroundColor];})()`,
        );
        const luminance = (c) =>
          c
            .match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number)
            .map((x) => {
              x /= 255;
              return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
            })
            .reduce((a, x, i) => a + x * [0.2126, 0.7152, 0.0722][i], 0);
        const [a, z] = colors.map(luminance),
          ratio = (Math.max(a, z) + 0.05) / (Math.min(a, z) + 0.05);
        console.log(
          value,
          state,
          colors,
          ratio,
          await b.screenshot(`review-send-${value}-${state}.png`),
        );
        assert.ok(ratio >= 4.5, `${value} ${state} Send contrast ${ratio}`);
      }
    }
  },
);

test(
  "context panels and selects stay inside both viewport edges, including short composer",
  { timeout: 120000 },
  async (t) => {
    const { b } = await setup(t);
    for (const value of ["light", "dark"]) {
      await theme(b, value);
      for (const height of [800, 400]) {
        await b.client.send("Emulation.setDeviceMetricsOverride", {
          width: 390,
          height,
          deviceScaleFactor: 1,
          mobile: false,
        });
        for (const label of ["Opsi chat", "AI · Test vision", "Tools"]) {
          await b.click(label);
          const bounds = await b.evaluate(
            `Array.from(document.querySelectorAll('.context-panel')).filter(e=>e.checkVisibility()).flatMap(e=>[e,...e.querySelectorAll('select')]).map(e=>{const r=e.getBoundingClientRect();return {tag:e.tagName,left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:e.scrollWidth,client:e.clientWidth};})`,
          );
          console.log(
            value,
            height,
            label,
            bounds,
            await b.screenshot(
              `review-panel-${value}-${height}-${label.split(" ")[0]}.png`,
            ),
          );
          for (const r of bounds) {
            assert.ok(
              r.left >= 8 && r.right <= 382,
              `${label}: horizontal clipping ${JSON.stringify(r)}`,
            );
            assert.ok(
              r.top >= 8 && r.bottom <= height - 8,
              `${label}: vertical clipping ${JSON.stringify(r)}`,
            );
            assert.ok(r.scroll <= r.client + 1, `${label}: internal overflow`);
          }
          await b.click(label);
        }
      }
    }
  },
);

async function key(b, key, code, n) {
  for (const type of ["keyDown", "keyUp"])
    await b.client.send("Input.dispatchKeyEvent", {
      type,
      key,
      code,
      windowsVirtualKeyCode: n,
      ...(key === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}),
    });
}
test(
  "New and Delete dialogs return keyboard focus on Escape and close, including unmounted menu",
  { timeout: 120000 },
  async (t) => {
    const { b } = await setup(t);
    for (const close of ["escape", "close"]) {
      await b.click("Proyek");
      await b.evaluate(
        `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Proyek baru ⌘').focus()`,
      );
      await key(b, "Enter", "Enter", 13);
      await until(() =>
        b.evaluate(`!!document.querySelector('[role="dialog"]')`),
      );
      if (close === "escape") await key(b, "Escape", "Escape", 27);
      else {
        for (const type of ["mousePressed", "mouseReleased"])
          await b.client.send("Input.dispatchMouseEvent", {
            type,
            ...(await point(b, '[aria-label="Tutup dialog"]')),
            button: "left",
            clickCount: 1,
          });
      }
      await until(() =>
        b.evaluate(`!document.querySelector('[role="dialog"]')`),
      );
      assert.equal(
        await b.evaluate(`document.activeElement.textContent.trim()`),
        "Proyek baru ⌘",
        "New focus returns to invoking control",
      );
      await b.click("Tutup proyek");
      await b.click("Tools");
      await b.click("Preferensi & proyek");
      await b.evaluate(
        `document.querySelector('.delete-project-button').focus()`,
      );
      await key(b, "Enter", "Enter", 13);
      await until(() =>
        b.evaluate(`!!document.querySelector('[role="dialog"]')`),
      );
      if (close === "escape") await key(b, "Escape", "Escape", 27);
      else {
        for (const type of ["mousePressed", "mouseReleased"])
          await b.client.send("Input.dispatchMouseEvent", {
            type,
            ...(await point(b, '[aria-label="Tutup dialog"]')),
            button: "left",
            clickCount: 1,
          });
      }
      await until(() =>
        b.evaluate(`!document.querySelector('[role="dialog"]')`),
      );
      const focus = await b.evaluate(
        `({label:document.activeElement.getAttribute('aria-label'),cls:document.activeElement.className})`,
      );
      if (close === "close") {
        assert.equal(
          focus.label,
          "Tools",
          "unmounted menu returns to persistent trigger",
        );
        assert.equal(
          await b.evaluate(
            `!!document.querySelector('.delete-project-button')`,
          ),
          false,
        );
      } else
        assert.ok(
          focus.cls.includes("delete-project-button"),
          JSON.stringify(focus),
        );
      // If the originating disclosure is still open, dismiss it for next pass.
      if (
        await b.evaluate(
          `!!document.querySelector('[aria-label="Tools panel"]')`,
        )
      )
        await b.click("Tools");
    }
  },
);

test(
  "pending approvals can be denied and allowed from narrow and short preview",
  { timeout: 120000 },
  async (t) => {
    const { forge, b } = await setup(t);
    for (const value of ["light", "dark"]) {
      await theme(b, value);
      for (const height of [800, 400]) {
        await b.client.send("Emulation.setDeviceMetricsOverride", {
          width: 390,
          height,
          deviceScaleFactor: 1,
          mobile: false,
        });
        for (const action of ["Tolak", "Izinkan sekali"]) {
          await b.fill("#forge-composer", "REQUEST_APPROVAL");
          await b.evaluate(`document.querySelector('.send').click()`);
          await until(() =>
            b.evaluate(`!!document.querySelector('.approval')`),
          );
          await b.click("Preview");
          const visible = await b.evaluate(
            `Array.from(document.querySelectorAll('.approval button')).map(e=>{e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {visible:e.checkVisibility(),left:r.left,right:r.right,top:r.top,bottom:r.bottom};})`,
          );
          for (const r of visible)
            assert.ok(
              r.visible &&
                r.left >= 0 &&
                r.right <= 390 &&
                r.top >= 0 &&
                r.bottom <= height,
              JSON.stringify(r),
            );
          console.log(
            "Approval evidence",
            await b.screenshot(
              `review-approval-${value}-${height}-${action}.png`,
            ),
          );
          await b.click(action);
          await until(
            async () =>
              !(await forge.json("state")).approvals.length &&
              !(await forge.json("state")).active,
          );
          const result = JSON.parse(
            await fs.readFile(
              path.join(forge.root, "fixture-approval-result.json"),
              "utf8",
            ),
          );
          assert.equal(
            result.decision,
            action === "Tolak" ? "decline" : "accept",
          );
          await b.click("Kembali ke chat");
        }
      }
    }
    assert.deepEqual(b.errors, []);
  },
);

test(
  "hidden code editor keeps unsaved work and exact checkpoint restore works through Tools",
  { timeout: 120000 },
  async (t) => {
    const { forge, b } = await setup(t, true);
    const project = (await forge.json("state")).projects[0];
    const original = await fs.readFile(
      path.join(project.path, "page.html"),
      "utf8",
    );
    const checkpoint = await forge.json("checkpoint", {
      projectId: project.id,
    });
    console.log("Checkpoint fixture", checkpoint);
    await b.click("Tools");
    await b.click("Kode");
    await b.click("page.html");
    await b.click("Edit kode");
    await until(() =>
      b.evaluate(`!!document.querySelector('.monaco-editor textarea')`),
    );
    await b.evaluate(
      `document.querySelector('.monaco-editor [role="textbox"]').focus()`,
    );
    await b.client.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      modifiers: 4,
      commands: ["selectAll"],
    });
    await b.client.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      modifiers: 4,
    });
    const edited = "Edited through real Monaco keyboard";
    await b.client.send("Input.insertText", { text: edited });
    console.log(
      "Editor evidence",
      await b.screenshot("review-editor-input.png"),
    );
    await until(() => b.evaluate(`!!document.querySelector('.dirty-dot')`));
    await b.click("Kembali ke chat");
    assert.equal(
      await b.evaluate(
        `document.querySelector('.monaco-editor [role="textbox"]').checkVisibility()`,
      ),
      false,
    );
    // Reloading would destroy the unsaved editor; use the existing file-switch
    // confirmation to exercise cancellation through an actual browser dialog.
    await b.click("Tools");
    await b.click("Kode");
    const dialogDecision = async (accept) => {
      const opened = new Promise((resolve) => {
        const listener = (event) => {
          const message = JSON.parse(event.data);
          if (message.method !== "Page.javascriptDialogOpening") return;
          b.client.ws.removeEventListener("message", listener);
          resolve(message.params);
        };
        b.client.ws.addEventListener("message", listener);
      });
      const clicked = b.click("package.json");
      const dialog = await opened;
      assert.equal(dialog.type, "confirm");
      await b.client.send("Page.handleJavaScriptDialog", { accept });
      await clicked;
    };
    await dialogDecision(false);
    assert.equal(
      await b.evaluate(
        `document.querySelector('.file-meta strong').textContent`,
      ),
      "page.html",
    );
    assert.equal(
      await b.evaluate(`!!document.querySelector('.dirty-dot')`),
      true,
    );
    assert.equal(
      await fs.readFile(path.join(project.path, "page.html"), "utf8"),
      original,
      "hiding editor does not save",
    );
    await b.click("Simpan");
    await until(
      async () =>
        (await fs.readFile(path.join(project.path, "page.html"), "utf8")) ===
        edited,
    );
    assert.equal(
      (await forge.json(`file?projectId=${project.id}&file=page.html`)).text,
      edited,
    );
    await b.click("Kembali ke chat");
    await b.click("Tools");
    await b.click("Checkpoint");
    await until(() =>
      b.evaluate(`document.querySelectorAll('.checkpoint').length>=2`),
    );
    const id = checkpoint[0].id;
    await b.evaluate(
      `Array.from(document.querySelectorAll('.checkpoint')).find(e=>e.textContent.includes(${JSON.stringify(id.slice(0, 7))})).querySelector('button').click()`,
    );
    await until(() =>
      b.evaluate(`!!document.querySelector('[role="dialog"]')`),
    );
    assert.equal(
      await fs.readFile(path.join(project.path, "page.html"), "utf8"),
      edited,
      "restore requires confirmation",
    );
    await b.click("Lanjutkan");
    await until(
      async () =>
        (await fs.readFile(path.join(project.path, "page.html"), "utf8")) ===
        original,
    );
    assert.equal((await forge.json("state")).preview, null);
    console.log(
      "Restore evidence",
      await b.screenshot("review-checkpoint-restored.png"),
    );
    assert.deepEqual(b.errors, []);
  },
);
