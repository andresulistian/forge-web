import test from "node:test";
import assert from "node:assert/strict";
import { isolatedForge } from "./visual-fixtures.mjs";
import { browser, until } from "./helpers/visual-browser.mjs";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
async function savedDraft(forge, project) {
  const image = await forge.json("attachments", {
    projectId: project.id,
    item: {
      kind: "image",
      name: "Saved reference.png",
      images: [{ data: png, mimeType: "image/png" }],
    },
  });
  const session = await forge.json(`session?projectId=${project.id}`);
  const attachments = [{ id: image.id, imageUsage: "reference" }];
  await forge.json("session", {
    projectId: project.id,
    expected: session.revision,
    draft: { text: "Recover me", attachments },
  });
  return attachments;
}
async function navigate(b, forge) {
  await b.client.send("Page.navigate", {
    url: forge.connection.url + "/#token=" + forge.connection.token,
  });
  await until(() =>
    b.evaluate(`!!document.querySelector('#forge-composer:not(:disabled)')`),
  );
}

test(
  "metadata JSON503 preserves saved role/ID while editing; persistent warning offers retry without replay",
  { timeout: 60000 },
  async (t) => {
    const forge = await isolatedForge(t);
    const project = await forge.json("projects/create", { name: "Recovery" });
    const attachments = await savedDraft(forge, project);
    let fail = true,
      failures = 0;
    const b = await browser(
      t,
      forge.root,
      [forge.connection.url],
      (client, params) => {
        if (!fail || !params.request.url.endsWith("/api/attachments/metadata"))
          return false;
        failures++;
        void client.send("Fetch.fulfillRequest", {
          requestId: params.requestId,
          responseCode: 503,
          responseHeaders: [
            { name: "Content-Type", value: "application/json" },
          ],
          body: Buffer.from(
            JSON.stringify({ error: "Temporary metadata outage" }),
          ).toString("base64"),
        });
        return true;
      },
    );
    await navigate(b, forge);
    assert.ok(
      failures > 0,
      "actual browser HTTP metadata request received JSON503",
    );
    assert.equal(
      (
        await forge.request(
          `attachments/image?projectId=${project.id}&id=${attachments[0].id}`,
        )
      ).status,
      200,
    );
    await b.fill("#forge-composer", "Edited during metadata outage");
    await until(
      async () =>
        (await forge.json(`session?projectId=${project.id}`)).draft.text ===
        "Edited during metadata outage",
    );
    assert.deepEqual(
      (await forge.json(`session?projectId=${project.id}`)).draft.attachments,
      attachments,
      "503 is not an explicit attachment removal",
    );
    assert.equal(
      await b.evaluate(
        `!!document.querySelector('[data-attachment-recovery]')`,
      ),
      true,
      "warning must survive successful autosave",
    );
    assert.equal(
      await b.evaluate(
        `document.querySelector('[aria-label="Kirim pesan"]').disabled`,
      ),
      true,
      "unresolved saved images cannot be silently omitted from a send",
    );
    await b.client.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    assert.equal(
      await b.evaluate(`document.documentElement.scrollWidth<=innerWidth`),
      true,
      "recovery warning must fit the mobile chat",
    );
    assert.equal(
      await b.evaluate(
        `[...document.querySelectorAll('[data-attachment-recovery] button')].every(e=>e.getBoundingClientRect().right<=innerWidth)`,
      ),
      true,
    );
    console.log("Evidence", await b.screenshot("metadata-recovery-390.png"));
    fail = false;
    await b.click("Coba muat lampiran lagi");
    await until(() =>
      b.evaluate(
        `document.querySelector('.attachment-chips img')?.naturalWidth>0`,
      ),
    );
    assert.equal(
      await b.evaluate(
        `document.querySelector('select[aria-label="Penggunaan Saved reference.png"]').value`,
      ),
      "reference",
    );
    assert.equal(
      await b.evaluate(`document.querySelector('#forge-composer').value`),
      "Edited during metadata outage",
      "retry hydrates metadata only, not old text",
    );
    assert.equal(
      await b.evaluate(
        `!!document.querySelector('[data-attachment-recovery]')`,
      ),
      false,
    );
    assert.deepEqual(
      (await forge.json(`session?projectId=${project.id}`)).draft.attachments,
      attachments,
    );
    assert.deepEqual(await forge.json(`messages?projectId=${project.id}`), []);
    assert.equal((await forge.json("state")).active, null);
    console.log("Evidence", forge.root);
  },
);

test(
  "delayed metadata JSON503 cannot affect another project or a newer controller after A-B-A switching",
  { timeout: 90000 },
  async (t) => {
    const forge = await isolatedForge(t);
    const first = await forge.json("projects/create", {
      name: "Recovery first",
    });
    const attachments = await savedDraft(forge, first);
    const other = await forge.json("projects/create", {
      name: "Recovery other",
    });
    let held,
      metadataRequests = 0;
    const b = await browser(
      t,
      forge.root,
      [forge.connection.url],
      (client, params) => {
        if (!params.request.url.endsWith("/api/attachments/metadata"))
          return false;
        if (JSON.parse(params.request.postData).projectId !== first.id)
          return false;
        metadataRequests++;
        if (metadataRequests !== 1) return false;
        held = { client, requestId: params.requestId };
        return true;
      },
    );
    await b.client.send("Page.navigate", {
      url: forge.connection.url + "/#token=" + forge.connection.token,
    });
    // The saved session selects A; its initial metadata response remains pending.
    await until(() => !!held);
    async function select(name, ready = true) {
      await b.click("Proyek");
      await b.evaluate(
        `[...document.querySelectorAll('button.project')].find(e=>e.textContent.includes(${JSON.stringify(name)})).click()`,
      );
      await until(() =>
        b.evaluate(
          `document.querySelector('.breadcrumb strong')?.textContent===${JSON.stringify(name)}${ready ? " && !document.querySelector('#forge-composer').disabled" : ""}`,
        ),
      );
    }
    await select("Recovery other");
    await b.fill("#forge-composer", "Other project draft stays separate");
    await until(
      async () =>
        (await forge.json(`session?projectId=${other.id}`)).draft.text ===
        "Other project draft stays separate",
    );
    assert.deepEqual(
      (await forge.json(`session?projectId=${other.id}`)).draft.attachments,
      [],
    );
    await select("Recovery first");
    await until(() =>
      b.evaluate(
        `document.querySelector('.attachment-chips img')?.naturalWidth>0`,
      ),
    );
    await b.fill("#forge-composer", "New controller draft");
    await until(
      async () =>
        (await forge.json(`session?projectId=${first.id}`)).draft.text ===
        "New controller draft",
    );
    await held.client.send("Fetch.fulfillRequest", {
      requestId: held.requestId,
      responseCode: 503,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(
        JSON.stringify({ error: "Delayed old metadata failure" }),
      ).toString("base64"),
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(
      await b.evaluate(
        `/Lampiran lama tidak tersedia|Lampiran belum dimuat/.test(document.body.innerText)`,
      ),
      false,
      "an old failed hydration must not warn on the newer same-project controller",
    );
    assert.equal(
      await b.evaluate(`document.querySelector('#forge-composer').value`),
      "New controller draft",
    );
    assert.deepEqual(
      (await forge.json(`session?projectId=${first.id}`)).draft.attachments,
      attachments,
    );
    assert.deepEqual(
      (await forge.json(`session?projectId=${other.id}`)).draft.attachments,
      [],
    );
    assert.deepEqual(await forge.json(`messages?projectId=${first.id}`), []);
    console.log("Evidence", forge.root);
  },
);

test(
  "explicit discard for reupload invalidates a pending metadata retry without clearing text",
  { timeout: 60000 },
  async (t) => {
    const forge = await isolatedForge(t);
    const project = await forge.json("projects/create", {
      name: "Reupload recovery",
    });
    await savedDraft(forge, project);
    let requestCount = 0,
      held;
    const b = await browser(
      t,
      forge.root,
      [forge.connection.url],
      (client, params) => {
        if (!params.request.url.endsWith("/api/attachments/metadata"))
          return false;
        requestCount++;
        if (requestCount > 1) {
          held = { client, requestId: params.requestId };
          return true;
        }
        void client.send("Fetch.fulfillRequest", {
          requestId: params.requestId,
          responseCode: 503,
          responseHeaders: [
            { name: "Content-Type", value: "application/json" },
          ],
          body: Buffer.from(
            JSON.stringify({ error: "Temporary metadata outage" }),
          ).toString("base64"),
        });
        return true;
      },
    );
    await navigate(b, forge);
    await b.click("Coba muat lampiran lagi");
    await until(() => !!held);
    await b.click("Hapus pilihan lama untuk unggah ulang");
    await until(
      async () =>
        (await forge.json(`session?projectId=${project.id}`)).draft.attachments
          .length === 0,
    );
    await held.client.send("Fetch.continueRequest", {
      requestId: held.requestId,
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(
      await b.evaluate(`document.querySelector('#forge-composer').value`),
      "Recover me",
    );
    assert.equal(
      await b.evaluate(
        `!!document.querySelector('[data-attachment-recovery]')`,
      ),
      false,
    );
    assert.equal(
      await b.evaluate(
        `document.querySelectorAll('.attachment-chips img').length`,
      ),
      0,
    );
    assert.deepEqual(
      (await forge.json(`session?projectId=${project.id}`)).draft.attachments,
      [],
    );
    assert.equal(
      await b.evaluate(
        `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Lampirkan file').disabled`,
      ),
      false,
    );
    console.log("Evidence", forge.root);
  },
);
