import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { isolatedForge } from "./visual-fixtures.mjs";
import { browser, until } from "./helpers/visual-browser.mjs";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
  "base64",
);
async function open(b, forge) {
  await b.client.send("Page.navigate", {
    url: forge.connection.url + "/#token=" + forge.connection.token,
  });
  await until(() =>
    b.evaluate(
      `!!document.querySelector('#forge-composer:not(:disabled)') && document.body.innerText.includes('Test vision')`,
    ),
  );
}
async function choose(b, file) {
  await b.client.send("Page.setInterceptFileChooserDialog", { enabled: true });
  await b.click("Lampirkan file");
  const { root } = await b.client.send("DOM.getDocument");
  const { nodeId } = await b.client.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: '.attachment-picker input[type="file"]',
  });
  await b.client.send("DOM.setFileInputFiles", { nodeId, files: [file] });
}
const decoded = (selector) =>
  `!!document.querySelector(${JSON.stringify(selector)}) && [...document.querySelectorAll(${JSON.stringify(selector)})].every(i=>i.complete && i.naturalWidth>0 && i.src.startsWith('blob:'))`;

test(
  "real browser file chooser upload has a decoded private draft thumbnail",
  { timeout: 60000 },
  async (t) => {
    const forge = await isolatedForge(t);
    await forge.json("projects/create", { name: "Image browser" });
    const file = path.join(forge.root, "Brand Logo.png");
    await fs.writeFile(file, png);
    const b = await browser(t, forge.root, [forge.connection.url]);
    b.client.ws.addEventListener("message", (event) => {
      const m = JSON.parse(event.data);
      if (m.method === "Page.javascriptDialogOpening")
        console.log("Unexpected dialog", m.params.type, m.params.message);
    });
    await open(b, forge);
    await choose(b, file);
    await until(() =>
      b.evaluate(
        `document.querySelector('.attachment-chips')?.textContent.includes('Brand Logo.png')`,
      ),
    );
    await until(() => b.evaluate(decoded(".attachment-chips img")));
    assert.equal(
      await b.evaluate(decoded(".attachment-chips img")),
      true,
      "uploaded image must decode in the real draft, not just show a name chip",
    );
    assert.equal(
      await b.evaluate(
        `!!document.querySelector('select[aria-label="Penggunaan Brand Logo.png"]')`,
      ),
      true,
      "image usage must be selectable",
    );
    await b.fill('select[aria-label="Penggunaan Brand Logo.png"]', "reference");
    await until(
      async () =>
        (
          await forge.json(
            `session?projectId=${(await forge.json("state")).projects[0].id}`,
          )
        ).draft.attachments?.[0]?.imageUsage === "reference",
    );
    await until(() =>
      b.evaluate(
        `document.body.innerText.includes('Draft tersimpan lokal di server')`,
      ),
    );

    await b.client.send("Page.reload");
    await until(() => b.evaluate(decoded(".attachment-chips img")));
    assert.equal(
      await b.evaluate(
        `document.querySelector('select[aria-label="Penggunaan Brand Logo.png"]').value`,
      ),
      "reference",
    );
    await b.click("Ask");
    await b.fill("#forge-composer", "Study the logo, do not publish it yet");
    await b.evaluate(
      `document.querySelector('[aria-label="Kirim pesan"]').click()`,
    );
    await until(() => b.evaluate(decoded(".message-attachments img")));
    assert.equal(
      await b.evaluate(
        `!!document.querySelector('[aria-label="Gunakan lagi Brand Logo.png"]')`,
      ),
      true,
    );
    await until(async () => !(await forge.json("state")).active);
    await until(() =>
      b.evaluate(
        `document.body.innerText.includes('Draft tersimpan lokal di server')`,
      ),
    );
    await b.client.send("Page.reload");
    await until(() => b.evaluate(decoded(".message-attachments img")));
    await b.evaluate(
      `document.querySelector('[aria-label="Gunakan lagi Brand Logo.png"]').click()`,
    );
    await until(() => b.evaluate(decoded(".attachment-chips img")));
    assert.equal(
      await b.evaluate(
        `document.querySelector('select[aria-label="Penggunaan Brand Logo.png"]').value`,
      ),
      "reference",
    );
    const blob = await b.evaluate(
      `document.querySelector('.attachment-chips img').src`,
    );
    await b.evaluate(
      `(()=>{window._thumbRevoked=[];const revoke=URL.revokeObjectURL;URL.revokeObjectURL=u=>{window._thumbRevoked.push(u);revoke(u)}})()`,
    );
    await b.evaluate(
      `document.querySelector('[aria-label="Hapus lampiran Brand Logo.png"]').click()`,
    );
    assert.equal(
      await b.evaluate(
        `document.querySelectorAll('.attachment-chips img').length`,
      ),
      0,
    );
    assert.equal(
      await b.evaluate(
        `window._thumbRevoked.includes(${JSON.stringify(blob)})`,
      ),
      true,
      "removal revokes the private thumbnail blob",
    );
    await b.evaluate(
      `(()=>{const original=window.fetch;window.fetch=(url,options)=>String(url).includes('/api/attachments/image?')?Promise.resolve(new Response('',{status:404})):original(url,options)})()`,
    );
    await b.evaluate(
      `document.querySelector('[aria-label="Gunakan lagi Brand Logo.png"]').click()`,
    );
    await until(() =>
      b.evaluate(
        `!!document.querySelector('.attachment-chips [aria-label="Gambar Brand Logo.png tidak tersedia"]')`,
      ),
    );
    await b.evaluate(
      `document.querySelector('[aria-label="Hapus lampiran Brand Logo.png"]').click()`,
    );
  },
);

test(
  "transparent logo normalization preserves alpha for vision without changing original source bytes",
  { timeout: 60000 },
  async (t) => {
    const forge = await isolatedForge(t);
    const project = await forge.json("projects/create", {
      name: "Transparent logo",
    });
    const b = await browser(t, forge.root, [forge.connection.url]);
    await open(b, forge);
    const original = await b.evaluate(
      `(()=>{const c=document.createElement('canvas');c.width=160;c.height=80;const x=c.getContext('2d');x.fillStyle='#0a6042';x.fillRect(40,20,80,40);return c.toDataURL('image/png').split(',')[1]})()`,
    );
    const file = path.join(forge.root, "Transparent Logo.png");
    await fs.writeFile(file, Buffer.from(original, "base64"));
    await choose(b, file);
    await until(() => b.evaluate(decoded(".attachment-chips img")));
    await until(
      async () =>
        (await forge.json(`session?projectId=${project.id}`)).draft.attachments
          ?.length === 1,
    );
    const id = (await forge.json(`session?projectId=${project.id}`)).draft
      .attachments[0].id;
    const saved = JSON.parse(
      await fs.readFile(
        path.join(forge.root, "data/attachments", project.id, id + ".json"),
        "utf8",
      ),
    );
    assert.equal(saved.source.data, original);
    assert.equal(
      saved.images[0].mimeType,
      "image/png",
      "transparent vision frame must not JPEG-flatten the logo",
    );
    const alpha = await b.evaluate(
      `(async()=>{const i=new Image();i.src=${JSON.stringify("data:" + saved.images[0].mimeType + ";base64," + saved.images[0].data)};await i.decode();const c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;const x=c.getContext('2d');x.drawImage(i,0,0);return {corner:x.getImageData(0,0,1,1).data[3],center:x.getImageData(80,40,1,1).data[3],width:i.naturalWidth,height:i.naturalHeight}})()`,
    );
    assert.deepEqual(alpha, { corner: 0, center: 255, width: 160, height: 80 });
    const noisy = await b.evaluate(
      `(()=>{const c=document.createElement('canvas');c.width=1800;c.height=1200;const x=c.getContext('2d'),pixels=x.createImageData(c.width,c.height);let seed=1;for(let i=0;i<pixels.data.length;i+=4){for(let j=0;j<3;j++){seed=(seed*1664525+1013904223)>>>0;pixels.data[i+j]=seed>>>24}pixels.data[i+3]=255}pixels.data[3]=0;x.putImageData(pixels,0,0);return c.toDataURL('image/png').split(',')[1]})()`,
    );
    const large = path.join(forge.root, "Large Raster.png");
    await fs.writeFile(large, Buffer.from(noisy, "base64"));
    await choose(b, large);
    await until(
      async () =>
        (await forge.json(`session?projectId=${project.id}`)).draft.attachments
          ?.length === 2,
    );
    const largeId = (await forge.json(`session?projectId=${project.id}`)).draft
      .attachments[1].id;
    const normalized = JSON.parse(
      await fs.readFile(
        path.join(
          forge.root,
          "data/attachments",
          project.id,
          largeId + ".json",
        ),
        "utf8",
      ),
    );
    const bytes = Buffer.from(normalized.images[0].data, "base64");
    assert.equal(
      normalized.source.data,
      noisy,
      "normalization never alters original source",
    );
    assert.equal(normalized.images[0].mimeType, "image/png");
    assert.ok(
      normalized.images[0].data.length <= 2_900_000,
      "bounded frame byte budget",
    );
    assert.ok(
      bytes.readUInt32BE(16) <= 1600 && bytes.readUInt32BE(20) <= 1600,
      "bounded dimensions",
    );
  },
);

test(
  "delayed upload and thumbnail never leak into a newly selected project; blobs are revoked",
  { timeout: 90000 },
  async (t) => {
    const forge = await isolatedForge(t);
    const first = await forge.json("projects/create", { name: "Race first" });
    const other = await forge.json("projects/create", { name: "Race other" });
    const b = await browser(t, forge.root, [forge.connection.url]);
    await open(b, forge);
    async function select(id) {
      await b.click("Proyek");
      const label = id === first.id ? "Race first" : "Race other";
      assert.equal(
        await b.evaluate(
          `![...document.querySelectorAll('button.project')].find(e=>e.textContent.includes(${JSON.stringify(label)})).disabled`,
        ),
        true,
        "project switching remains available while attachment upload is pending",
      );
      await b.evaluate(
        `[...document.querySelectorAll('button.project')].find(e=>e.textContent.includes(${JSON.stringify(label)})).click()`,
      );
      await until(() =>
        b.evaluate(
          `document.querySelector('.breadcrumb strong').textContent === ${JSON.stringify(label)} && !document.querySelector('#forge-composer').disabled`,
        ),
      );
    }
    await select(first.id);
    await b.evaluate(
      `(()=>{window._revoked=[];const revoke=URL.revokeObjectURL;URL.revokeObjectURL=u=>{window._revoked.push(u);revoke(u)};const original=window.fetch;window.fetch=async(url,options)=>{const r=await original(url,options);if(String(url).endsWith('/api/attachments')){window._uploadWaiting=true;await new Promise(resolve=>window._releaseUpload=resolve)}return r}})()`,
    );
    const file = path.join(forge.root, "Race.png");
    await fs.writeFile(file, png);
    await choose(b, file);
    await until(() => b.evaluate(`window._uploadWaiting===true`));
    await select(other.id);
    await b.evaluate(`window._releaseUpload()`);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(
      await b.evaluate(
        `document.querySelectorAll('.attachment-chips img').length`,
      ),
      0,
    );
    assert.deepEqual(
      (await forge.json(`session?projectId=${other.id}`)).draft.attachments,
      [],
    );
    // Independently persist a private first-project image and pause its thumbnail.
    const image = await forge.json("attachments", {
      projectId: first.id,
      item: {
        kind: "image",
        name: "Delayed.png",
        images: [{ data: png.toString("base64"), mimeType: "image/png" }],
      },
    });
    const draft = await forge.json(`session?projectId=${first.id}`);
    await forge.json("session", {
      projectId: first.id,
      expected: draft.revision,
      draft: {
        text: "",
        attachments: [{ id: image.id, imageUsage: "reference" }],
      },
    });
    await b.evaluate(
      `(()=>{const original=window.fetch;window.fetch=async(url,options)=>{const r=await original(url,options);if(String(url).includes('/api/attachments/image?')){window._thumbWaiting=true;await new Promise(resolve=>window._releaseThumb=resolve)}return r}})()`,
    );
    await select(first.id);
    await until(() => b.evaluate(`window._thumbWaiting===true`));
    await select(other.id);
    await b.evaluate(`window._releaseThumb()`);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(
      await b.evaluate(
        `document.querySelectorAll('.attachment-chips img').length`,
      ),
      0,
    );

    assert.ok(
      await b.evaluate(`window._revoked.length>0`),
      "prepared upload blobs are revoked",
    );
    assert.deepEqual(b.errors, []);
  },
);

test(
  "upload Ask → explicit reuse Build → delivered asset URLs decode in fixture landing at 390/1440; restart keeps historic images",
  { timeout: 120000 },
  async (t) => {
    const forge = await isolatedForge(t);
    const project = await forge.json("projects/create", {
      name: "Landing image fixture",
    });
    // A local, dependency-free preview serves only this disposable project.
    await fs.writeFile(
      path.join(project.path, "package.json"),
      JSON.stringify({ type: "module", scripts: { dev: "node fixture.mjs" } }),
    );
    await fs.writeFile(
      path.join(project.path, "fixture.mjs"),
      `import http from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';const root=fileURLToPath(new URL('./',import.meta.url));http.createServer(async(q,r)=>{try{const relative=decodeURIComponent(new URL(q.url,'http://local').pathname).slice(1)||'page.html';const file=path.resolve(root,relative);if(!file.startsWith(root))throw Error('path');r.setHeader('Content-Type',file.endsWith('.png')?'image/png':file.endsWith('.jpg')?'image/jpeg':'text/html');r.end(await fs.readFile(file));}catch{r.statusCode=404;r.end('not found')}}).listen(Number(process.env.PORT),'127.0.0.1');`,
    );
    const origins = [forge.connection.url];
    const b = await browser(t, forge.root, origins);
    await open(b, forge);
    // Generated logo with alpha and a JPEG photo-like raster (no external media).
    const source = await b.evaluate(
      `(()=>{const logo=document.createElement('canvas');logo.width=240;logo.height=120;const x=logo.getContext('2d');x.fillStyle='#126247';x.fillRect(20,20,60,80);x.font='bold 32px sans-serif';x.fillText('LEAF',95,72);const photo=document.createElement('canvas');photo.width=640;photo.height=360;const y=photo.getContext('2d');const g=y.createLinearGradient(0,0,640,360);g.addColorStop(0,'#cadec0');g.addColorStop(1,'#245843');y.fillStyle=g;y.fillRect(0,0,640,360);y.fillStyle='#edf3cf';y.beginPath();y.arc(460,80,40,0,Math.PI*2);y.fill();return {logo:logo.toDataURL('image/png').split(',')[1],photo:photo.toDataURL('image/jpeg',.9).split(',')[1]}})()`,
    );
    const logo = path.join(forge.root, "Leaf Logo.png"),
      photo = path.join(forge.root, "Photo Fixture.jpg");
    await fs.writeFile(logo, Buffer.from(source.logo, "base64"));
    await fs.writeFile(photo, Buffer.from(source.photo, "base64"));
    await choose(b, logo);
    await until(() => b.evaluate(decoded(".attachment-chips img")));
    await b.click("Ask");
    await b.fill(
      "#forge-composer",
      "Study this logo; keep private until explicit reuse",
    );
    await b.evaluate(
      `document.querySelector('[aria-label="Kirim pesan"]').click()`,
    );
    await until(() => b.evaluate(decoded(".message-attachments img")));
    await until(async () => !(await forge.json("state")).active);
    assert.equal(
      (await fs.readdir(project.path, { recursive: true })).some((f) =>
        /forge-assets|forge-uploads/.test(f),
      ),
      false,
      "Ask does not publish sources",
    );
    let input = JSON.parse(
      await fs.readFile(
        path.join(forge.root, "fixture-last-input.json"),
        "utf8",
      ),
    );
    assert.equal(input.filter((p) => p.type === "image").length, 1);
    await until(() =>
      b.evaluate(
        `!document.querySelector('[aria-label="Gunakan lagi Leaf Logo.png"]').disabled`,
      ),
    );
    await b.evaluate(
      `document.querySelector('[aria-label="Gunakan lagi Leaf Logo.png"]').click()`,
    );
    await b.fill('select[aria-label="Penggunaan Leaf Logo.png"]', "asset");
    await choose(b, photo);
    await until(() =>
      b.evaluate(
        `document.querySelectorAll('.attachment-chips img').length===2 && ` +
          decoded(".attachment-chips img"),
      ),
    );
    for (const theme of ["light", "dark"]) {
      await b.evaluate(
        `document.documentElement.dataset.theme=${JSON.stringify(theme)}`,
      );
      for (const width of [1440, 390]) {
        await b.client.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: false,
        });
        assert.equal(
          await b.evaluate(`document.documentElement.scrollWidth<=innerWidth`),
          true,
          `${theme} ${width} image draft overflow`,
        );
        assert.equal(
          await b.evaluate(
            `[...document.querySelectorAll('.attachment-chips > span')].every(e=>e.getBoundingClientRect().right<=innerWidth)`,
          ),
          true,
          "image controls remain in viewport",
        );
        console.log(
          "Evidence",
          await b.screenshot(`images-${theme}-${width}-draft.png`),
        );
      }
    }
    await b.click("Build");
    await b.fill(
      "#forge-composer",
      "IMAGE_LANDING_FIXTURE use the supplied logo and photo",
    );
    await b.evaluate(
      `document.querySelector('[aria-label="Kirim pesan"]').click()`,
    );
    await until(
      async () =>
        !(await forge.json("state")).active &&
        (await forge.json(`messages?projectId=${project.id}`)).filter(
          (m) => m.role === "user",
        ).length === 2,
    );
    input = JSON.parse(
      await fs.readFile(
        path.join(forge.root, "fixture-last-input.json"),
        "utf8",
      ),
    );
    assert.equal(
      input.filter((p) => p.type === "image").length,
      2,
      "explicit reuse + current photo, no bulk historical reupload",
    );
    const urls = [...input[0].text.matchAll(/browser URL is (\/\S+)/g)].map(
      (m) => m[1].replace(/\.$/, ""),
    );
    assert.equal(urls.length, 2);
    assert.ok(urls.every((url) => url.includes("%20")));
    const html = await fs.readFile(
      path.join(project.path, "page.html"),
      "utf8",
    );
    for (const url of urls)
      assert.ok(
        html.includes(url),
        "fixture consumes URL actually delivered to provider, not a guessed upload path",
      );
    const originals = [source.logo, source.photo];
    for (let i = 0; i < urls.length; i++)
      assert.deepEqual(
        await fs.readFile(
          path.join(project.path, decodeURIComponent(urls[i]).slice(1)),
        ),
        Buffer.from(originals[i], "base64"),
      );
    const preview = await forge.json("preview/start", {
      projectId: project.id,
      confirmed: true,
    });
    origins.push(preview.url);
    await b.client.send("Page.navigate", { url: preview.url });
    for (const width of [1440, 390]) {
      await b.client.send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await until(() =>
        b.evaluate(
          `document.querySelectorAll('img').length===2 && [...document.images].every(i=>i.complete&&i.naturalWidth>0)`,
        ),
      );
      assert.deepEqual(
        await b.evaluate(
          `[...document.images].map(i=>({url:new URL(i.src).pathname,width:i.naturalWidth,height:i.naturalHeight,fit:getComputedStyle(i).objectFit}))`,
        ),
        [
          { url: urls[0], width: 240, height: 120, fit: "contain" },
          { url: urls[1], width: 640, height: 360, fit: "cover" },
        ],
      );
      assert.equal(
        await b.evaluate(`document.documentElement.scrollWidth<=innerWidth`),
        true,
      );
      console.log("Evidence", await b.screenshot(`image-landing-${width}.png`));
    }
    await forge.stop();
    await forge.start();
    origins.push(forge.connection.url);
    await open(b, forge);
    await until(() => b.evaluate(decoded(".message-attachments img")));
    assert.equal(
      await b.evaluate(
        `document.querySelectorAll('.message-attachments .attachment-thumbnail').length`,
      ),
      3,
      "all historic IDs remain in chat after isolated restart on another origin",
    );
    for (let index = 0; index < 3; index++) {
      await b.evaluate(
        `document.querySelectorAll('.message-attachments .attachment-thumbnail')[${index}].scrollIntoView({block:'center'})`,
      );
      await until(() =>
        b.evaluate(
          `(()=>{const i=document.querySelectorAll('.message-attachments .attachment-thumbnail')[${index}].querySelector('img');return i&&i.complete&&i.naturalWidth>0})()`,
        ),
      );
    }
    assert.equal(
      await b.evaluate(
        `document.querySelectorAll('.attachment-chips img').length`,
      ),
      0,
      "sent images are not implicitly reattached",
    );
    const messages = await forge.json(`messages?projectId=${project.id}`);
    assert.doesNotMatch(
      JSON.stringify(messages),
      /data:image|;base64|"source":|"images":/,
    );
    const draft = await forge.json(`session?projectId=${project.id}`);
    assert.deepEqual(draft.draft.attachments, []);
    assert.deepEqual(b.errors, []);
  },
);
