import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { isolatedForge } from "./visual-fixtures.mjs";
import { browser, until } from "./helpers/visual-browser.mjs";

test(
  "real PNG/JPEG/WebP/GIF sources stay original; JPEG frames decode and oversized/truncated JPEGs reject",
  { timeout: 90000 },
  async (t) => {
    const forge = await isolatedForge(t);
    const project = await forge.json("projects/create", {
      name: "Raster formats",
    });
    const b = await browser(t, forge.root, [forge.connection.url]);
    await b.client.send("Page.navigate", {
      url: forge.connection.url + "/#token=" + forge.connection.token,
    });
    await until(() =>
      b.evaluate(`!!document.querySelector('#forge-composer:not(:disabled)')`),
    );
    const generated = await b.evaluate(
      `(()=>{const c=document.createElement('canvas');c.width=64;c.height=32;const x=c.getContext('2d');x.fillStyle='#29634b';x.fillRect(10,10,40,15);const result={png:c.toDataURL('image/png').split(',')[1],jpeg:c.toDataURL('image/jpeg').split(',')[1],webp:c.toDataURL('image/webp').split(',')[1]};for(const [w,h] of [[2001,1],[1,2001]]){c.width=w;c.height=h;x.fillRect(0,0,w,h);result[w+'x'+h]=c.toDataURL('image/jpeg').split(',')[1]}return result})()`,
    );
    const gif = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    for (const [format, data] of [
      ...Object.entries(generated).filter(([key]) =>
        ["png", "jpeg", "webp"].includes(key),
      ),
      ["gif", gif],
    ]) {
      const source = { data, mimeType: "image/" + format };
      const image = await forge.json("attachments", {
        projectId: project.id,
        item: {
          kind: "image",
          name: "Original." + format,
          source,
          images: [
            {
              data: generated[format === "jpeg" ? "jpeg" : "png"],
              mimeType: format === "jpeg" ? "image/jpeg" : "image/png",
            },
          ],
        },
      });
      const saved = JSON.parse(
        await fs.readFile(
          path.join(
            forge.root,
            "data/attachments",
            project.id,
            image.id + ".json",
          ),
          "utf8",
        ),
      );
      assert.deepEqual(saved.source, source);
      assert.equal(saved.size, Buffer.from(data, "base64").length);
      const response = await forge.request(
        `attachments/image?projectId=${project.id}&id=${image.id}`,
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      const decoded = await b.evaluate(
        `(async()=>{const i=new Image();i.src=${JSON.stringify("data:" + saved.images[0].mimeType + ";base64," + saved.images[0].data)};await i.decode();return [i.naturalWidth,i.naturalHeight]})()`,
      );
      assert.deepEqual(decoded, [64, 32]);
    }
    const valid = await forge.json("attachments", {
      projectId: project.id,
      item: {
        kind: "image",
        name: "Photo.jpg",
        images: [{ data: generated.jpeg, mimeType: "image/jpeg" }],
      },
    });
    const file = path.join(
      forge.root,
      "data/attachments",
      project.id,
      valid.id + ".json",
    );
    const original = JSON.parse(await fs.readFile(file, "utf8"));
    const jpeg = Buffer.from(generated.jpeg, "base64");
    for (const [label, data] of [
      ["2001x1", generated["2001x1"]],
      ["1x2001", generated["1x2001"]],
      ["signature", Buffer.from([255, 216, 255]).toString("base64")],
      ["truncated", jpeg.subarray(0, -10).toString("base64")],
      [
        "broken structure",
        Buffer.concat([jpeg.subarray(0, 30), Buffer.from([255, 217])]).toString(
          "base64",
        ),
      ],
    ]) {
      const images = [{ data, mimeType: "image/jpeg" }];
      assert.equal(
        (
          await forge.request("attachments", {
            projectId: project.id,
            item: { kind: "image", name: label + ".jpg", images },
          })
        ).status,
        400,
        label + " NEW upload",
      );
      await fs.writeFile(file, JSON.stringify({ ...original, images }));
      assert.equal(
        (
          await forge.request(
            `attachments/image?projectId=${project.id}&id=${valid.id}`,
          )
        ).status,
        400,
        label + " legacy preview",
      );
    }
    console.log("Evidence", forge.root);
  },
);
