import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Attachments, attachmentPrompt } from "../server/attachments.mjs";
const frame = {
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
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

test("restaging keeps exact URL, workspace path and copy count despite generated public mirror and framework changes", async (t) => {
  for (const initial of ["static", "vite"]) {
    const { project, store } = await fixture(t);
    const manifest = path.join(project.path, "package.json");
    if (initial === "vite")
      await fs.writeFile(
        manifest,
        JSON.stringify({ dependencies: { vite: "^6" } }),
      );
    const saved = await store.add(project, {
      kind: "image",
      name: "Stable logo.png",
      source: frame,
      images: [frame],
    });
    const first = await store.resolve(project, [saved.id]);
    await store.stage(project, first);
    const location = { url: first[0].publicUrl, path: first[0].workspacePath };
    const copies = async () =>
      (await fs.readdir(project.path, { recursive: true }))
        .filter((f) => f.endsWith(`${saved.id}-Stable logo.png`))
        .sort();
    const before = await copies();
    assert.equal(before.length, 2);
    for (const switchFramework of [false, true]) {
      if (switchFramework)
        await fs.writeFile(
          manifest,
          JSON.stringify(
            initial === "static" ? { dependencies: { vite: "^6" } } : {},
          ),
        );
      const next = await store.resolve(project, [saved.id]);
      await store.stage(project, next);
      assert.deepEqual(
        { url: next[0].publicUrl, path: next[0].workspacePath },
        location,
        "layout must not change when its mirror creates public/",
      );
      assert.deepEqual(
        await copies(),
        before,
        "repeat must not create additional copies",
      );
      const relative = decodeURIComponent(location.url).slice(1);
      for (const base of [project.path, path.join(project.path, "public")])
        assert.deepEqual(
          await fs.readFile(path.join(base, relative)),
          Buffer.from(frame.data, "base64"),
        );
    }
  }
});

test("the existing static URL serves identical bytes after actually starting Vite's public-directory server", async (t) => {
  const { root, project, store } = await fixture(t);
  const saved = await store.add(project, {
    kind: "image",
    name: "Framework logo.png",
    source: frame,
    images: [frame],
  });
  const first = await store.resolve(project, [saved.id]);
  await store.stage(project, first);
  const location = { url: first[0].publicUrl, path: first[0].workspacePath };
  const bytes = Buffer.from(frame.data, "base64");
  const server = createServer(async (req, res) => {
    if (req.url !== location.url) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader("Content-Type", "image/png");
    res.end(
      await fs.readFile(
        path.join(project.path, decodeURIComponent(location.url).slice(1)),
      ),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port,
    url = `http://127.0.0.1:${port}${location.url}`;
  assert.deepEqual(Buffer.from(await (await fetch(url)).arrayBuffer()), bytes);
  await new Promise((resolve) => server.close(resolve));
  await fs.writeFile(
    path.join(project.path, "package.json"),
    JSON.stringify({ type: "module", devDependencies: { vite: "^6" } }),
  );
  const again = await store.resolve(project, [saved.id]);
  await store.stage(project, again);
  assert.deepEqual(
    { url: again[0].publicUrl, path: again[0].workspacePath },
    location,
  );
  assert.equal(
    (await fs.readdir(project.path, { recursive: true })).filter((file) =>
      file.endsWith(`${saved.id}-Framework logo.png`),
    ).length,
    2,
  );
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(
        new URL("../node_modules/vite/bin/vite.js", import.meta.url),
      ),
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      cwd: project.path,
      env: { PATH: process.env.PATH, HOME: root, TMPDIR: root },
      stdio: "ignore",
    },
  );
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      const force = setTimeout(() => child.kill("SIGKILL"), 1000);
      await exit;
      clearTimeout(force);
    }
  });
  let response;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) break;
    } catch {
      /* Vite starting */
    }
    if (child.exitCode !== null)
      throw Error("Vite fixture exited before serving the mirrored URL");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(
    response?.status,
    200,
    "the old URL must really serve through Vite, not only exist on disk",
  );
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  console.log("Vite asset evidence", root, location);
});
