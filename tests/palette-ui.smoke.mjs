import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { isolatedForge, fixturePreview } from "./visual-fixtures.mjs";
import { browser, until } from "./helpers/visual-browser.mjs";

const palette = {
  light: {
    accent: "#6d28d9",
    soft: "#f3eefa",
    action: "#6d28d9",
    canvas: "rgb(246, 248, 250)",
    chrome: "rgb(243, 243, 243)",
    surface: "rgb(255, 255, 255)",
    danger: "#a32924",
    success: "#28603a",
  },
  dark: {
    accent: "#c4b5fd",
    soft: "#35264d",
    action: "#6d28d9",
    canvas: "rgb(24, 25, 28)",
    chrome: "rgb(32, 33, 36)",
    surface: "rgb(37, 38, 42)",
    danger: "#ffb4ad",
    success: "#a4d5b0",
  },
};
function rgb(hex) {
  return `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
}
async function theme(b, value) {
  await b.click("Tools");
  await b.click("Preferensi & proyek");
  if (
    await b.evaluate(
      `document.documentElement.dataset.theme !== ${JSON.stringify(value)}`,
    )
  )
    await b.click(value === "light" ? "Terang" : "Gelap");
  await b.click("Tools");
}
async function colors(b, selector) {
  return b.evaluate(`(() => {
    const e=document.querySelector(${JSON.stringify(selector)});if(!e) throw Error('Missing '+${JSON.stringify(selector)});
    const s=getComputedStyle(e);let a=e,bg;
    do{bg=getComputedStyle(a).backgroundColor;a=a.parentElement;}while(a&&(bg==='rgba(0, 0, 0, 0)'||bg==='transparent'));
    const lum=c=>{const v=c.match(/[\\d.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return v[0]*.2126+v[1]*.7152+v[2]*.0722};
    const ratio=(x,y)=>(Math.max(lum(x),lum(y))+.05)/(Math.min(lum(x),lum(y))+.05);
    let outer=e.parentElement,outerBg;
    do{outerBg=getComputedStyle(outer).backgroundColor;outer=outer.parentElement;}while(outer&&(outerBg==='rgba(0, 0, 0, 0)'||outerBg==='transparent'));
    return {selector:${JSON.stringify(selector)},fg:s.color,bg,ratio:ratio(s.color,bg),outline:s.outlineColor,outlineStyle:s.outlineStyle,focusRatio:ratio(s.outlineColor,outerBg),border:s.borderTopColor,borderRatio:ratio(s.borderTopColor,bg),disabled:!!e.disabled};
  })()`);
}
async function readable(b, selector, expected, records, label) {
  const value = await colors(b, selector);
  assert.equal(value.disabled, false, `${label}: enabled control`);
  assert.equal(value.fg, rgb(expected), `${label}: purple foreground`);
  assert.ok(value.ratio >= 4.5, `${label}: ${JSON.stringify(value)}`);
  records.push({ label, ...value });
  return value;
}
async function point(b, selector) {
  return b.evaluate(
    `(() => {const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
  );
}
async function keyboardFocus(b, selector) {
  await until(() =>
    b.evaluate(
      `!!document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`,
    ),
  );
  await b.client.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: 1,
    y: 1,
  });
  await b.client.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
  });
  await b.client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
  });
  await b.evaluate(
    `document.querySelector(${JSON.stringify(selector)}).focus()`,
  );
  assert.equal(
    await b.evaluate(
      `document.querySelector(${JSON.stringify(selector)}).matches(':focus-visible')`,
    ),
    true,
  );
}

test(
  "restrained purple accents are readable in both real themes without changing the neutral shell",
  { timeout: 180000 },
  async (t) => {
    const forge = await isolatedForge(t);
    const project = await fixturePreview(forge);
    assert.equal((await forge.request("state", null, false)).status, 401);
    const state = await forge.json("state");
    const b = await browser(t, forge.root, [
      forge.connection.url,
      state.preview.url,
    ]);
    await b.client.send("Page.navigate", {
      url: forge.connection.url + "/#token=" + forge.connection.token,
    });
    await until(() =>
      b.evaluate(
        `!!document.querySelector('#forge-composer:not(:disabled)') && document.body.innerText.includes('Test vision')`,
      ),
    );
    const image = await b.evaluate(
      `(() => {const c=document.createElement('canvas');c.width=160;c.height=80;const x=c.getContext('2d');x.fillStyle='#28603a';x.fillRect(30,20,100,40);return c.toDataURL('image/png').split(',')[1]})()`,
    );
    const file = path.join(forge.root, "Accent fixture.png");
    await fs.writeFile(file, Buffer.from(image, "base64"));
    await b.client.send("Page.setInterceptFileChooserDialog", {
      enabled: true,
    });
    await b.click("Lampirkan file");
    const { root } = await b.client.send("DOM.getDocument");
    const { nodeId } = await b.client.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: '.attachment-picker input[type="file"]',
    });
    await b.client.send("DOM.setFileInputFiles", { nodeId, files: [file] });
    await until(() =>
      b.evaluate(
        `document.querySelector('.attachment-chips img')?.naturalWidth > 0`,
      ),
    );
    const records = [];
    for (const value of ["light", "dark"]) {
      await theme(b, value);
      const p = palette[value];
      const tokens = await b.evaluate(
        `(() => {const s=getComputedStyle(document.documentElement);return Object.fromEntries(['accent','accent-soft','action','focus','danger','success'].map(k=>[k,s.getPropertyValue('--'+k).trim()]));})()`,
      );
      assert.deepEqual(tokens, {
        accent: p.accent,
        "accent-soft": p.soft,
        action: p.action,
        focus: p.accent,
        danger: p.danger,
        success: p.success,
      });
      const surfacePairs = await b.evaluate(`(() => {
      const s=getComputedStyle(document.documentElement),color=k=>s.getPropertyValue('--'+k).trim();
      const lum=h=>{const v=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722};
      return ['canvas','chrome','surface','hover','accent-soft'].flatMap(bg=>['text','muted','accent','focus'].map(fg=>{const a=lum(color(fg)),b=lum(color(bg));return {fgToken:fg,bgToken:bg,fg:color(fg),bg:color(bg),ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};}));
    })()`);
      for (const pair of surfacePairs)
        assert.ok(
          pair.ratio >= (pair.fgToken === "focus" ? 3 : 4.5),
          `${value}: ${JSON.stringify(pair)}`,
        );
      records.push(
        ...surfacePairs.map((pair) => ({
          label: `${value} semantic surface pair`,
          ...pair,
        })),
      );
      for (const [selector, expected] of [
        [".conversation", p.canvas],
        [".topbar", p.chrome],
        [".composer", p.surface],
      ])
        assert.equal(
          await b.evaluate(
            `getComputedStyle(document.querySelector(${JSON.stringify(selector)})).backgroundColor`,
          ),
          expected,
          `${value}: neutral ${selector}`,
        );
      for (const label of ["Ask", "Plan", "Build"]) {
        await b.click(label);
        await b.client.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: 1,
          y: 1,
        });
        await new Promise((r) => setTimeout(r, 180));
        const c = await readable(
          b,
          ".mode-switch .chosen",
          p.accent,
          records,
          `${value} ${label}`,
        );
        assert.equal(c.bg, rgb(p.soft));
      }
      for (const selector of [
        ".attachment-actions button:first-of-type",
        ".attachment-actions button:nth-of-type(2)",
      ])
        await readable(
          b,
          selector,
          p.accent,
          records,
          `${value} attachment action/link`,
        );
      await keyboardFocus(b, ".image-attachment-card select");
      const imageControl = await colors(b, ".image-attachment-card select");
      assert.equal(imageControl.outline, rgb(p.accent));
      assert.equal(imageControl.outlineStyle, "solid");
      assert.ok(
        imageControl.ratio >= 4.5 && imageControl.focusRatio >= 3,
        JSON.stringify(imageControl),
      );
      records.push({ label: `${value} image usage focus`, ...imageControl });
      await b.fill("#forge-composer", "Unsent purple accent fixture");
      await until(() =>
        b.evaluate(`!document.querySelector('.send').disabled`),
      );
      for (const interaction of ["default", "hover", "focus"]) {
        await b.client.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          ...(interaction === "hover"
            ? await point(b, ".send")
            : { x: 1, y: 1 }),
        });
        await b.evaluate(`document.activeElement.blur()`);
        if (interaction === "focus") await keyboardFocus(b, ".send");
        await new Promise((r) => setTimeout(r, 180));
        const send = await readable(
          b,
          ".send",
          "#ffffff",
          records,
          `${value} send ${interaction}`,
        );
        assert.equal(send.bg, rgb(p.action));
        if (interaction === "focus") {
          assert.equal(send.outline, rgb(p.accent));
          assert.equal(send.outlineStyle, "solid");
          assert.ok(send.focusRatio >= 3, JSON.stringify(send));
        }
      }
      await b.evaluate(`document.querySelector('#forge-composer').focus()`);
      const composer = await colors(b, ".composer");
      assert.equal(composer.border, rgb(p.accent));
      assert.ok(composer.borderRatio >= 3, JSON.stringify(composer));
      records.push({ label: `${value} composer focus`, ...composer });
      await b.click("Proyek");
      await readable(
        b,
        ".project.selected .project-icon",
        p.accent,
        records,
        `${value} selected project`,
      );
      await b.click("Tutup proyek");
      for (const width of [1440, 390]) {
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
        );
        console.log(
          "Evidence",
          await b.screenshot(`purple-${value}-${width}-chat-image.png`),
        );
        await b.click("Preview");
        await until(() =>
          b.evaluate(`!!document.querySelector('.preview-canvas iframe')`),
        );
        await b.evaluate(
          `document.querySelector('[aria-label="Annotation preview"]').click()`,
        );
        await readable(
          b,
          ".annotation-active",
          p.accent,
          records,
          `${value} ${width} annotation active`,
        );
        const alpha = await b.evaluate(
          `getComputedStyle(document.querySelector('.annotation-layer.is-editing')).backgroundColor`,
        );
        assert.equal(
          alpha,
          "rgba(0, 0, 0, 0)",
          "annotation overlay remains transparent",
        );
        console.log(
          "Evidence",
          await b.screenshot(`purple-${value}-${width}-preview.png`),
        );
        await b.evaluate(
          `document.querySelector('[aria-label="Annotation preview"]').click()`,
        );
        await b.click("Kembali ke chat");
        await b.click("Tools");
        await readable(
          b,
          ".workflow-steps strong",
          p.accent,
          records,
          `${value} ${width} workflow`,
        );
        console.log(
          "Evidence",
          await b.screenshot(`purple-${value}-${width}-tools.png`),
        );
        await b.click("Review visual");
        await until(() =>
          b.evaluate(
            `document.querySelector('.visual-review')?.checkVisibility()`,
          ),
        );
        if (width === 1440) {
          await b.click("Ambil screenshot");
          await until(() =>
            b.evaluate(
              `document.querySelector('.capture-figure img')?.naturalWidth > 0 && !document.querySelector('.visual-controls button').disabled`,
            ),
          );
        }
        await readable(
          b,
          ".capture-figure figcaption",
          p.accent,
          records,
          `${value} ${width} snapshot caption`,
        );
        await keyboardFocus(b, '.visual-review [aria-label="Path screenshot"]');
        const review = await colors(
          b,
          '.visual-review [aria-label="Path screenshot"]',
        );
        assert.equal(review.outline, rgb(p.accent));
        assert.ok(
          review.ratio >= 4.5 && review.focusRatio >= 3,
          JSON.stringify(review),
        );
        records.push({ label: `${value} ${width} review focus`, ...review });
        console.log(
          "Evidence",
          await b.screenshot(`purple-${value}-${width}-review.png`),
        );
        await b.evaluate(
          `document.querySelector('.capture-figure').scrollIntoView({block:'center'})`,
        );
        console.log(
          "Evidence",
          await b.screenshot(`purple-${value}-${width}-snapshot.png`),
        );
        await b.click("Kembali ke chat");
      }
    }
    assert.equal(
      (await forge.json(`visual?projectId=${project.id}`)).run,
      null,
      "contrast testing never sends the unsent draft to a provider",
    );
    assert.deepEqual(b.errors, []);
    await fs.writeFile(
      path.join(forge.root, "purple-contrast.json"),
      JSON.stringify(records, null, 2),
    );
    console.log(
      "Contrast evidence",
      path.join(forge.root, "purple-contrast.json"),
    );
  },
);

test(
  "native review controls, app links and text selection never fall back to browser blue",
  { timeout: 120000 },
  async (t) => {
    const forge = await isolatedForge(t);
    const project = await forge.json("projects/create", {
      name: "Native accent fixture",
    });
    const b = await browser(t, forge.root, [forge.connection.url]);
    await b.client.send("Page.navigate", {
      url: forge.connection.url + "/#token=" + forge.connection.token,
    });
    await until(() =>
      b.evaluate(`!!document.querySelector('#forge-composer:not(:disabled)')`),
    );
    const records = [];
    for (const value of ["light", "dark"]) {
      await theme(b, value);
      await b.click("Tools");
      await b.click("Review visual");
      const native = await b.evaluate(`(() => {
      const e=document.querySelector('.visual-opt-in input'),s=getComputedStyle(e);
      const selection=getComputedStyle(document.querySelector('.visual-heading h3'),'::selection');
      return {accent:s.accentColor,selectionBg:selection.backgroundColor,selectionFg:selection.color};
    })()`);
      await b.evaluate(
        `document.querySelector('.visual-opt-in input').click()`,
      );
      await until(
        async () =>
          (await forge.json(`visual?projectId=${project.id}`)).auto === true,
      );
      await keyboardFocus(b, ".visual-opt-in input");
      const nativeFocus = await colors(b, ".visual-opt-in input");
      assert.equal(nativeFocus.outline, rgb(palette[value].accent));
      assert.ok(nativeFocus.focusRatio >= 3, JSON.stringify(nativeFocus));
      await b.evaluate(
        `(() => {const r=document.createRange();r.selectNodeContents(document.querySelector('.visual-heading h3'));getSelection().removeAllRanges();getSelection().addRange(r);})()`,
      );
      console.log(
        "Evidence",
        await b.screenshot(`purple-${value}-native-review.png`),
      );
      await b.evaluate(`getSelection().removeAllRanges()`);
      await b.evaluate(
        `document.querySelector('.visual-opt-in input').click()`,
      );
      await until(
        async () =>
          (await forge.json(`visual?projectId=${project.id}`)).auto === false,
      );
      await b.click("Kembali ke chat");
      await b.click("Tools");
      await b.click("Pengaturan");
      await until(() =>
        b.evaluate(`!!document.querySelector('.integration-note a')`),
      );
      await b.evaluate(
        `document.querySelector('.integration-note a').scrollIntoView({block:'center'})`,
      );
      const link = await colors(b, ".integration-note a");
      await keyboardFocus(b, ".integration-note a");
      const linkFocus = await colors(b, ".integration-note a");
      console.log(
        "Evidence",
        await b.screenshot(`purple-${value}-settings-link.png`),
      );
      records.push({ theme: value, native, nativeFocus, link, linkFocus });
      await b.click("Kembali ke chat");
    }
    await fs.writeFile(
      path.join(forge.root, "purple-native.json"),
      JSON.stringify(records, null, 2),
    );
    console.log("Native evidence", path.join(forge.root, "purple-native.json"));
    for (const { theme: value, native, link, linkFocus } of records) {
      const p = palette[value];
      assert.deepEqual(
        native,
        {
          accent: rgb(p.accent),
          selectionBg: rgb(p.soft),
          selectionFg:
            value === "light" ? "rgb(23, 23, 26)" : "rgb(236, 238, 242)",
        },
        `${value}: native accents ${JSON.stringify(records)}`,
      );
      assert.equal(link.fg, rgb(p.accent), `${value}: app link is purple`);
      assert.ok(link.ratio >= 4.5, JSON.stringify(link));
      assert.equal(linkFocus.outline, rgb(p.accent));
      assert.equal(linkFocus.outlineStyle, "solid");
      assert.ok(linkFocus.focusRatio >= 3, JSON.stringify(linkFocus));
    }
    assert.deepEqual(b.errors, []);
  },
);
