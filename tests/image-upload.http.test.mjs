import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { isolatedForge } from "./visual-fixtures.mjs";
import { until } from "./helpers/visual-browser.mjs";

export const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
  "base64",
);
export async function upload(
  forge,
  project,
  name = "logo brand.png",
  original = true,
) {
  return forge.json("attachments", {
    projectId: project.id,
    item: {
      kind: "image",
      name,
      images: [{ data: png.toString("base64"), mimeType: "image/png" }],
      ...(original
        ? { source: { data: png.toString("base64"), mimeType: "image/png" } }
        : {}),
    },
  });
}
export async function chat(
  forge,
  project,
  ids,
  mode = "build",
  model = "fixture-vision",
) {
  const result = await forge.request("chat", {
    projectId: project.id,
    text: "Build using the supplied image",
    mode,
    model,
    provider: "codex",
    webMode: "off",
    attachments: ids,
  });
  await until(async () => !(await forge.json("state")).active);
  return result;
}
export async function input(forge) {
  return JSON.parse(
    await fs.readFile(path.join(forge.root, "fixture-last-input.json"), "utf8"),
  );
}

test("HTTP Build prompt contains the exact existing binary browser URL", async (t) => {
  const forge = await isolatedForge(t);
  const project = await forge.json("projects/create", {
    name: "Image pipeline",
  });
  const attachment = await upload(forge, project);
  assert.equal((await chat(forge, project, [attachment.id])).status, 200);
  const files = await fs.readdir(project.path, { recursive: true });
  const file = files.find((f) => f.endsWith("logo brand.png"));
  assert.ok(file, "Build staged the image into the project");
  assert.deepEqual(await fs.readFile(path.join(project.path, file)), png);
  const parts = await input(forge);
  assert.equal(parts.filter((p) => p.type === "image").length, 1);
  const browserUrl =
    "/" +
    file
      .replace(/^public\//, "")
      .split(path.sep)
      .map(encodeURIComponent)
      .join("/");
  assert.ok(
    parts[0].text.includes(browserUrl),
    `Delivered context omits staged URL: ${browserUrl}`,
  );
});

test("private image preview is authenticated, project scoped and safe", async (t) => {
  const forge = await isolatedForge(t);
  const project = await forge.json("projects/create", {
    name: "Private image",
  });
  const other = await forge.json("projects/create", { name: "Other project" });
  const attachment = await upload(forge, project);
  const route = `attachments/image?projectId=${project.id}&id=${attachment.id}`;
  assert.equal((await forge.request(route, undefined, false)).status, 401);
  const response = await forge.request(route);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  assert.equal(
    (
      await forge.request(
        `attachments/image?projectId=${other.id}&id=${attachment.id}`,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await forge.request(
        `attachments/image?projectId=${project.id}&id=../../secret`,
      )
    ).status,
    400,
  );
  const file = path.join(
    forge.root,
    "data/attachments",
    project.id,
    attachment.id + ".json",
  );
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  await fs.writeFile(
    file,
    JSON.stringify({
      ...saved,
      images: [
        {
          data: Buffer.from("<svg/>").toString("base64"),
          mimeType: "image/svg+xml",
        },
      ],
    }),
  );
  assert.equal((await forge.request(route)).status, 400);
  await fs.rename(file, file + ".original");
  await fs.symlink(file + ".original", file);
  assert.equal((await forge.request(route)).status, 400);
  assert.equal(
    (await fs.readdir(project.path, { recursive: true })).some((f) =>
      /forge-assets|forge-uploads/.test(f),
    ),
    false,
  );
});

test("reference intent stays private; role overrides are by project ID, not source", async (t) => {
  const forge = await isolatedForge(t);
  const project = await forge.json("projects/create", { name: "Intent" });
  const reference = await upload(forge, project, "moodboard.png");
  const asset = await upload(forge, project, "logo.png");
  assert.equal(
    (
      await chat(forge, project, [
        { id: reference.id, imageUsage: "reference", source: { data: "evil" } },
        { id: asset.id, imageUsage: "asset" },
      ])
    ).status,
    200,
  );
  const parts = await input(forge);
  assert.equal(parts.filter((p) => p.type === "image").length, 2);
  assert.equal(
    parts.filter((p) => p.type === "image")[0].url,
    `data:image/png;base64,${png.toString("base64")}`,
  );
  assert.match(parts[0].text, /reference-only.*not published/i);
  assert.match(
    parts[0].text,
    /Inspect.*logo.*product.*photo.*illustration.*screenshot.*moodboard/is,
  );
  assert.match(parts[0].text, /transparency|transparent/);
  const files = await fs.readdir(project.path, { recursive: true });
  assert.equal(
    files.some((f) => f.endsWith("moodboard.png")),
    false,
  );
  assert.ok(files.some((f) => f.endsWith("logo.png")));
  const messages = await forge.json(`messages?projectId=${project.id}`);
  const saved = messages.find((m) => m.role === "user").attachments;
  assert.equal(saved[0].imageUsage, "reference");
  assert.equal(saved[0].publicUrl, undefined);
  assert.equal(saved[1].imageUsage, "asset");
  assert.ok(saved[1].publicUrl);
  assert.equal(JSON.stringify(saved).includes("base64"), false);
  assert.equal(
    (await chat(forge, project, [{ id: asset.id, imageUsage: "whatever" }]))
      .status,
    400,
  );
  assert.equal(
    (await chat(forge, project, [{ id: asset.id, imageUsage: null }])).status,
    400,
  );
  assert.equal(
    (
      await chat(forge, project, [
        asset.id,
        { id: asset.id, imageUsage: "reference" },
      ])
    ).status,
    400,
  );
  const other = await forge.json("projects/create", { name: "Isolated" });
  assert.equal(
    (await chat(forge, other, [{ id: asset.id, imageUsage: "asset" }])).status,
    400,
  );
});

test("Ask/Plan/upload do not write the project; Build's checkpoint predates public images and metadata is ID-only", async (t) => {
  const forge = await isolatedForge(t);
  const project = await forge.json("projects/create", {
    name: "Read only images",
  });
  const before = await fs.readdir(project.path, { recursive: true });
  const image = await upload(forge, project, "Original source.png");
  assert.deepEqual(await fs.readdir(project.path, { recursive: true }), before);
  for (const mode of ["ask", "plan"]) {
    assert.equal((await chat(forge, project, [image.id], mode)).status, 200);
    assert.deepEqual(
      await fs.readdir(project.path, { recursive: true }),
      before,
      `${mode} must not modify project files`,
    );
    assert.doesNotMatch((await input(forge))[0].text, /browser URL is/);
  }
  assert.equal(
    (await chat(forge, project, [image.id], "ask", "fixture-text")).status,
    400,
  );
  assert.deepEqual(await fs.readdir(project.path, { recursive: true }), before);
  const selections = [
    {
      id: image.id,
      imageUsage: "asset",
      source: { data: "CLIENT_NOT_TRUSTED" },
      name: "spoof",
    },
  ];
  const metadata = await forge.json("attachments/metadata", {
    projectId: project.id,
    attachments: selections,
  });
  assert.equal(metadata[0].name, "Original source.png");
  assert.equal(metadata[0].imageUsage, "asset");
  assert.doesNotMatch(
    JSON.stringify(metadata),
    /CLIENT_NOT_TRUSTED|data:image|base64|"source":|publicUrl|workspacePath/,
  );
  const other = await forge.json("projects/create", { name: "Other" });
  assert.equal(
    (
      await forge.request("attachments/metadata", {
        projectId: other.id,
        attachments: selections,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await forge.request("session", {
        projectId: other.id,
        expected: 0,
        draft: { text: "", attachments: selections },
      })
    ).status,
    400,
  );
  const saved = await forge.json("session", {
    projectId: project.id,
    expected: 0,
    draft: { text: "Unsaved", attachments: selections },
  });
  assert.deepEqual(saved.draft.attachments, [
    { id: image.id, imageUsage: "asset" },
  ]);
  await forge.stop();
  await forge.start();
  assert.deepEqual(
    (await forge.json(`session?projectId=${project.id}`)).draft.attachments,
    [{ id: image.id, imageUsage: "asset" }],
  );
  assert.equal(
    (
      await forge.request(
        `attachments/image?projectId=${project.id}&id=${image.id}`,
      )
    ).status,
    200,
  );
  assert.equal((await chat(forge, project, selections)).status, 200);
  const messages = await forge.json(`messages?projectId=${project.id}`);
  const sent = messages.filter((m) => m.role === "user").at(-1).attachments[0];
  assert.ok((await input(forge))[0].text.includes(sent.publicUrl));
  assert.deepEqual(
    await fs.readFile(path.join(project.path, sent.workspacePath)),
    png,
  );
  const checkpoints = await forge.json(`history?projectId=${project.id}`);
  const checkpoint = checkpoints.find(
    (c) => c.label === "Otomatis sebelum Build",
  );
  assert.ok(checkpoint);
  await forge.json("restore", {
    projectId: project.id,
    id: checkpoint.id,
    confirmed: true,
  });
  assert.deepEqual(
    await fs.readdir(project.path, { recursive: true }),
    before,
    "checkpoint excludes staging and fixture Build writes",
  );
});
