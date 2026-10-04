import test from "node:test";
import assert from "node:assert/strict";
import { isolatedForge, fixturePreview } from "./visual-fixtures.mjs";
import { browser, until } from "./helpers/visual-browser.mjs";

test(
  "late target response cannot restore a target after capture selection changes",
  { timeout: 45000 },
  async (t) => {
    const forge = await isolatedForge(t);
    const p = await fixturePreview(forge);
    for (let i = 0; i < 2; i++)
      await forge.json("visual/capture", {
        projectId: p.id,
        kind: "snapshot",
        viewport: "mobile",
        path: "/",
      });
    const captures = (await forge.json(`visual?projectId=${p.id}`)).captures;
    const b = await browser(t, forge.root, [forge.connection.url]);
    await b.client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `const original=window.fetch; window.fetch=async (...args)=>{const response=await original(...args); if(String(args[0]).includes('/api/visual/target')){window.targetWaiting=true;await new Promise(r=>window.releaseTarget=r);} return response;};`,
    });
    await b.client.send("Page.navigate", {
      url: forge.connection.url + "/#token=" + forge.connection.token,
    });
    await until(() =>
      b.evaluate(
        `document.querySelector('#forge-composer') && !document.querySelector('#forge-composer').disabled`,
      ),
    );
    await b.click("Tools");
    await b.click("Review visual");
    await b.fill('[aria-label="Target DOM snapshot"]', "0");
    await until(() => b.evaluate("window.targetWaiting"));
    await b.fill('[aria-label="Capture tersimpan"]', captures[1].id);
    await b.evaluate("window.releaseTarget()");
    await until(() =>
      b.evaluate(`!document.body.innerText.includes('Memproses…')`),
    );
    await new Promise((r) => setTimeout(r, 700));
    const session = await forge.json(`session?projectId=${p.id}`);
    assert.equal(
      session.draft.target,
      null,
      "late lookup must not enter persisted composer target",
    );
    await b.fill('[aria-label="Capture tersimpan"]', captures[0].id);
    assert.equal(
      await b.evaluate(`!!document.querySelector('.target-context')`),
      false,
      "old target must not reappear",
    );
  },
);

test(
  "composer is locked during delayed draft hydration and can retry a failed load",
  { timeout: 45000 },
  async (t) => {
    const forge = await isolatedForge(t);
    await fixturePreview(forge);
    const b = await browser(t, forge.root, [forge.connection.url]);
    await b.client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `const original=window.fetch; window.fetch=async (...args)=>{ if(String(args[0]).includes('/api/session?')) { window.draftWaiting=true; await new Promise(r=>window.releaseDraft=r); if(!sessionStorage.getItem('draftRetried')) {sessionStorage.setItem('draftRetried','1');throw Error('fixture load failed');} } return original(...args); };`,
    });
    await b.client.send("Page.navigate", {
      url: forge.connection.url + "/#token=" + forge.connection.token,
    });
    await until(() =>
      b.evaluate(
        `window.draftWaiting && !!document.querySelector('#forge-composer')`,
      ),
    );
    assert.equal(
      await b.evaluate(`document.querySelector('#forge-composer').disabled`),
      true,
    );
    await b.evaluate("window.releaseDraft()");
    await until(() =>
      b.evaluate(
        `document.body.innerText.includes('Coba pulihkan draft lagi')`,
      ),
    );
    await b.click("Coba pulihkan draft lagi");
    await b.evaluate("window.releaseDraft()");
    await until(() =>
      b.evaluate(`!document.querySelector('#forge-composer').disabled`),
    );
    await b.fill("#forge-composer", "Typing after recovery");
    assert.equal(
      await b.evaluate(`document.querySelector('#forge-composer').value`),
      "Typing after recovery",
    );
  },
);
