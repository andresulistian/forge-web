import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fixture, sample } from "./design-fixtures.mjs";
const identity = sample();
test("identity validates bounded fields, tokens and references without coercion", async (t) => {
  const { workspace, project } = await fixture(t);
  const design = await service(workspace);
  const expected = (await design.get(project)).revision;
  for (const invalid of [
    null,
    [],
    { ...sample(), direction: 123 },
    { ...sample(), audience: "x".repeat(2001) },
    { ...sample(), unknown: true },
    { ...sample(), references: ["javascript:alert(1)"] },
    { ...sample(), references: ["https://user:password@example.com"] },
    { ...sample(), references: Array(21).fill("https://example.com") },
    {
      ...sample(),
      tokens: { colors: { accent: { $type: "color", $value: "not a color" } } },
    },
    {
      ...sample(),
      tokens: {
        spacing: {
          gap: { $type: "dimension", $value: { value: -1, unit: "px" } },
        },
      },
    },
    {
      ...sample(),
      tokens: {
        typography: { body: { $type: "fontFamily", $value: "x".repeat(201) } },
      },
    },
    {
      ...sample(),
      tokens: {
        radius: {
          corner: {
            $type: "dimension",
            $value: { value: 1, unit: "javascript" },
          },
        },
      },
    },
    {
      ...sample(),
      tokens: {
        colors: Object.fromEntries(
          Array.from({ length: 41 }, (_, i) => [
            `c${i}`,
            { $type: "color", $value: "#123456" },
          ]),
        ),
      },
    },
  ]) {
    await assert.rejects(
      () => design.save(project, { identity: invalid, expected }),
      /Identitas|Token|Referensi/,
    );
  }
  assert.equal((await design.get(project)).revision, expected);
  assert.equal((await workspace.history(project)).length, 0);
});
test("existing documents require explicit import; revisions and modified exports cannot be clobbered", async (t) => {
  const { workspace, project } = await fixture(t);
  const design = await service(workspace);
  const doc = path.join(project.path, "DESIGN.md");
  const legacy = "# Brand milik pengguna\nJangan ubah warna logo.\n";
  await fs.writeFile(doc, legacy);
  const before = await design.get(project);
  assert.equal(before.needsImport, true);
  await assert.rejects(
    () =>
      design.save(project, { identity: sample(), expected: before.revision }),
    /impor/i,
  );
  assert.equal(await fs.readFile(doc, "utf8"), legacy);
  const saved = await design.save(project, {
    identity: sample(),
    expected: before.revision,
    importExisting: true,
  });
  assert.equal(saved.identity.importedNotes, legacy);
  await assert.rejects(
    () =>
      design.save(project, { identity: sample(), expected: before.revision }),
    /berubah/,
  );
  await fs.writeFile(
    path.join(project.path, "design.tokens.json"),
    '{"user":"keep"}',
  );
  const changed = await design.get(project);
  assert.equal(changed.exportConflict, true);
  await assert.rejects(
    () =>
      design.save(project, { identity: sample(), expected: changed.revision }),
    /token.*berubah|token.*milik/i,
  );
  assert.equal(
    await fs.readFile(path.join(project.path, "design.tokens.json"), "utf8"),
    '{"user":"keep"}',
  );
});
test("unowned token file is preserved and checkpoint failures do not write", async (t) => {
  const { workspace, project } = await fixture(t);
  const design = await service(workspace);
  const tokenFile = path.join(project.path, "design.tokens.json");
  await fs.writeFile(tokenFile, "original");
  let before = await design.get(project);
  await assert.rejects(
    () =>
      design.save(project, { identity: sample(), expected: before.revision }),
    /token/i,
  );
  assert.equal(await fs.readFile(tokenFile, "utf8"), "original");
  await fs.unlink(tokenFile);
  before = await design.get(project);
  workspace.checkpoint = async () => {
    throw Error("checkpoint failed");
  };
  await assert.rejects(
    () =>
      design.save(project, { identity: sample(), expected: before.revision }),
    /checkpoint failed/,
  );
  assert.equal((await design.get(project)).revision, before.revision);
});
test("fixed design files reject symlinks, hardlinks, large files and changed project roots", async (t) => {
  const { workspace, project, root } = await fixture(t);
  const design = await service(workspace);
  const outside = path.join(root, "outside.txt");
  await fs.writeFile(outside, "outside");
  const doc = path.join(project.path, "DESIGN.md");
  for (const link of [
    () => fs.symlink(outside, doc),
    () => fs.link(outside, doc),
  ]) {
    await link();
    await assert.rejects(() => design.get(project), /aman|link|biasa/i);
    await fs.unlink(doc);
  }
  await fs.writeFile(doc, "x".repeat(65001));
  await assert.rejects(() => design.get(project), /besar|KB/);
  await fs.unlink(doc);
  const original = project.path;
  await fs.rename(original, original + "-moved");
  await fs.symlink(original + "-moved", original);
  await assert.rejects(() => design.get(project), /proyek|aman/i);
  assert.equal(await fs.readFile(outside, "utf8"), "outside");
});
test("save rechecks files after checkpoint and serializes simultaneous revisions", async (t) => {
  const { workspace, project } = await fixture(t);
  const design = await service(workspace);
  const initial = await design.get(project);
  const outcomes = await Promise.allSettled([
    design.save(project, { identity: sample(), expected: initial.revision }),
    design.save(project, {
      identity: { ...sample(), direction: "other" },
      expected: initial.revision,
    }),
  ]);
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
  const saved = await design.get(project);
  const doc = path.join(project.path, "DESIGN.md");
  workspace.checkpoint = async () => {
    await fs.writeFile(doc, "external edit");
  };
  await assert.rejects(
    () =>
      design.save(project, { identity: sample(), expected: saved.revision }),
    /berubah/,
  );
  assert.equal(await fs.readFile(doc, "utf8"), "external edit");
});
test("malformed owned documents fail closed instead of silently resetting identity", async (t) => {
  const { workspace, project } = await fixture(t);
  const design = await service(workspace);
  await fs.writeFile(
    path.join(project.path, "DESIGN.md"),
    "<!-- forge-design-identity:v1 -->\n```json\n{broken}\n```\n",
  );
  await assert.rejects(() => design.get(project), /DESIGN.md.*valid/i);
});
test("attachment references must already exist in this project, without fetching or uploading", async (t) => {
  const { workspace, project } = await fixture(t);
  const design = await service(workspace);
  const ref = "attachment:12345678-1234-1234-1234-123456789abc";
  const initial = await design.get(project);
  await assert.rejects(
    () =>
      design.save(project, {
        identity: { ...sample(), references: [ref] },
        expected: initial.revision,
      }),
    /lampiran/i,
  );
  const dir = path.join(workspace.dataDir, "attachments", project.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, ref.slice(11) + ".json"),
    '{"kind":"image"}',
  );
  const saved = await design.save(project, {
    identity: { ...sample(), references: [ref] },
    expected: initial.revision,
  });
  assert.deepEqual(saved.identity.references, [ref]);
  const other = await workspace.create("Attachment Other");
  const otherRevision = (await design.get(other)).revision;
  await assert.rejects(
    () =>
      design.save(other, { identity: saved.identity, expected: otherRevision }),
    /lampiran/i,
  );
});
test("imported source remains preserved on later saves and cannot be silently replaced", async (t) => {
  const { workspace, project } = await fixture(t);
  const design = await service(workspace);
  await fs.writeFile(path.join(project.path, "DESIGN.md"), "# Keep original\n");
  let current = await design.get(project);
  current = await design.save(project, {
    identity: sample(),
    expected: current.revision,
    importExisting: true,
  });
  const updated = await design.save(project, {
    identity: { ...sample(), direction: "New direction" },
    expected: current.revision,
  });
  assert.equal(updated.identity.importedNotes, "# Keep original\n");
  await assert.rejects(
    () =>
      design.save(project, {
        identity: { ...updated.identity, importedNotes: "replacement" },
        expected: updated.revision,
      }),
    /catatan.*impor/i,
  );
});
test("null fields, malformed attachment IDs and aggregate oversize are rejected before writes", async (t) => {
  const { workspace, project } = await fixture(t);
  const design = await service(workspace);
  const expected = (await design.get(project)).revision;
  const large = {
    ...sample(),
    importedNotes: "字".repeat(16000),
    direction: "a".repeat(2000),
  };
  for (const input of [
    { ...sample(), direction: null },
    { ...sample(), tokens: { ...sample().tokens, colors: null } },
    { ...sample(), references: ["attachment:" + "-".repeat(36)] },
    large,
  ]) {
    await assert.rejects(
      () => design.save(project, { identity: input, expected }),
      /Identitas|Token|Referensi/,
    );
    assert.equal((await design.get(project)).revision, expected);
  }
});
async function service(workspace) {
  const module = await import("../server/design-identity.mjs").catch(
    () => ({}),
  );
  assert.equal(
    typeof module.DesignIdentity,
    "function",
    "persistent design identity service must exist",
  );
  return new module.DesignIdentity(workspace);
}
test("identity persists portably across service reload and isolates projects", async (t) => {
  const { workspace, project } = await fixture(t);
  const design = await service(workspace);
  const before = await design.get(project);
  const saved = await design.save(project, {
    identity: sample(),
    expected: before.revision,
  });
  assert.equal(saved.identity.direction, identity.direction);
  assert.deepEqual(
    (await (await service(workspace)).get(project)).identity,
    saved.identity,
  );
  assert.match(
    await fs.readFile(path.join(project.path, "DESIGN.md"), "utf8"),
    /Editorial hangat/,
  );
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(path.join(project.path, "design.tokens.json"), "utf8"),
    ),
    saved.identity.tokens,
  );
  const other = await workspace.create("Other Design");
  assert.equal((await design.get(other)).identity.direction, "");
  assert.ok(
    (await workspace.history(project)).some((x) =>
      /identitas desain/.test(x.label),
    ),
  );
  const portable = await workspace.create("Portable");
  for (const file of ["DESIGN.md", "design.tokens.json"])
    await fs.copyFile(
      path.join(project.path, file),
      path.join(portable.path, file),
    );
  assert.deepEqual((await design.get(portable)).identity, saved.identity);
});
