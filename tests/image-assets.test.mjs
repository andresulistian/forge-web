import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Attachments, attachmentPrompt } from "../server/attachments.mjs";
const frame = {
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXs8AAAAASUVORK5CYII=",
  mimeType: "image/png",
};
async function fixture(_t) {
  const scratch =
    process.env.FORGE_TEST_ROOT ||
    path.join(os.homedir(), ".hermes/cache/scratch");
  await fs.mkdir(scratch, { recursive: true });
  const root = await fs.mkdtemp(path.join(scratch, "forge-image-assets-"));
  const project = { id: "test-project", path: path.join(root, "project") };
  await fs.mkdir(project.path);
  return { root, project, store: new Attachments(path.join(root, "data")) };
}
test("legacy visual frame gets explicitly normalized Build copy, not an original claim", async (t) => {
  const { project, store } = await fixture(t);
  const saved = await store.add(project, {
    kind: "image",
    name: "old logo.png",
    images: [frame],
  });
  const media = await store.resolve(project, [saved.id]);
  const files = await store.stage(project, media);
  assert.equal(files.length, 1);
  assert.deepEqual(
    await fs.readFile(path.join(project.path, files[0])),
    Buffer.from(frame.data, "base64"),
  );
  assert.equal(media[0].assetProvenance, "normalized");
  assert.match(attachmentPrompt(media), /normalized.*not the original/i);
  assert.doesNotMatch(attachmentPrompt(media), /copied the original binary/);
});

test("staged browser URLs survive static-to-public and public-to-static starter switches", async (t) => {
  const { project, store } = await fixture(t);
  for (const type of ["static", "vite"]) {
    if (type === "vite")
      await fs.writeFile(
        path.join(project.path, "package.json"),
        JSON.stringify({ devDependencies: { vite: "^6" } }),
      );
    const saved = await store.add(project, {
      kind: "image",
      name: "Brand Logo.png",
      source: frame,
      images: [frame],
    });
    const media = await store.resolve(project, [saved.id]);
    await store.stage(project, media);
    const relative = decodeURIComponent(media[0].publicUrl).slice(1);
    assert.deepEqual(
      await fs.readFile(path.join(project.path, relative)),
      Buffer.from(frame.data, "base64"),
      "static URL must exist",
    );
    assert.deepEqual(
      await fs.readFile(path.join(project.path, "public", relative)),
      Buffer.from(frame.data, "base64"),
      "same URL must exist after adopting Vite/Next public directory",
    );
  }
});

test("asset staging never overwrites an unrelated existing file", async (t) => {
  const { project, store } = await fixture(t);
  const saved = await store.add(project, {
    kind: "image",
    name: "Brand.png",
    source: frame,
    images: [frame],
  });
  const media = await store.resolve(project, [saved.id]);
  await fs.mkdir(path.join(project.path, "assets/forge-uploads"), {
    recursive: true,
  });
  const locations = [saved.id.slice(0, 8), saved.id].map((id) =>
    path.join(project.path, "assets/forge-uploads", `${id}-Brand.png`),
  );
  for (const file of locations) await fs.writeFile(file, "UNRELATED_FILE");
  await assert.rejects(
    () => store.stage(project, media),
    /đã|timbal|konflik|berbeda|overwrite|sudah ada/i,
  );
  for (const file of locations)
    assert.equal(await fs.readFile(file, "utf8"), "UNRELATED_FILE");
  assert.equal(media[0].publicUrl, undefined);
});

test("image directories and files reject symlinks without publishing private sources", async (t) => {
  for (const variant of [
    "assets",
    "public",
    "file",
    "private",
    "private-root",
  ]) {
    const { root, project, store } = await fixture(t);
    const outside = path.join(root, "outside");
    await fs.mkdir(outside);
    if (variant === "private" || variant === "private-root") {
      if (variant === "private") {
        await fs.mkdir(store.root, { recursive: true });
        await fs.symlink(outside, path.join(store.root, project.id));
      } else {
        await fs.mkdir(path.dirname(store.root), { recursive: true });
        await fs.symlink(outside, store.root);
      }
      await assert.rejects(() =>
        store.add(project, {
          kind: "image",
          name: "Private.png",
          source: frame,
          images: [frame],
        }),
      );
    } else {
      const saved = await store.add(project, {
        kind: "image",
        name: "Private.png",
        source: frame,
        images: [frame],
      });
      const media = await store.resolve(project, [saved.id]);
      if (variant === "file") {
        await fs.mkdir(path.join(project.path, "assets/forge-uploads"), {
          recursive: true,
        });
        const target = path.join(outside, "private.png");
        await fs.writeFile(target, "PRIVATE_CONTENT");
        await fs.symlink(
          target,
          path.join(
            project.path,
            "assets/forge-uploads",
            `${saved.id}-Private.png`,
          ),
        );
        await assert.rejects(() => store.stage(project, media));
        assert.equal(await fs.readFile(target, "utf8"), "PRIVATE_CONTENT");
      } else {
        await fs.symlink(outside, path.join(project.path, variant));
        await assert.rejects(() => store.stage(project, media), /aman/);
      }
      assert.equal(media[0].publicUrl, undefined);
    }
    assert.deepEqual(
      await fs.readdir(outside),
      variant === "file" ? ["private.png"] : [],
    );
  }
});

test("same-prefix IDs have distinct encoded asset names and identical restaging is idempotent", async (t) => {
  const { project, store } = await fixture(t);
  const items = [
    "abcdef12-1234-4321-8765-123456789abc",
    "abcdef12-1234-4321-8765-123456789abd",
  ].map((id) => ({
    id,
    kind: "image",
    name: "Name with space.png",
    images: [frame],
    source: frame,
  }));
  await store.stage(project, items);
  assert.notEqual(items[0].publicUrl, items[1].publicUrl);
  for (const item of items) {
    assert.ok(item.publicUrl.includes("%20"));
    assert.equal(item.publicUrl.includes(" "), false);
    assert.deepEqual(
      await fs.readFile(path.join(project.path, item.workspacePath)),
      Buffer.from(frame.data, "base64"),
    );
  }
  assert.equal((await store.stage(project, items)).length, 2);
});
