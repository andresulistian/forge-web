import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

test("compact identity form renders labeled editable fields, structured tokens and integration", async (t) => {
  const file = new URL("../src/DesignIdentity.tsx", import.meta.url);
  assert.equal(
    await fs.access(file).then(
      () => true,
      () => false,
    ),
    true,
    "identity form must be available in Agent Center",
  );
  const output = await build({
    entryPoints: [fileURLToPath(file)],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    packages: "external",
    jsx: "automatic",
  });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "forge-design-ui-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.symlink(
    path.resolve("node_modules"),
    path.join(dir, "node_modules"),
  );
  const bundle = path.join(dir, "form.mjs");
  await fs.writeFile(bundle, output.outputFiles[0].text);
  const { DesignIdentityFields } = await import(bundle);
  const { identityToDraft } = await model();
  const html = renderToStaticMarkup(
    createElement(DesignIdentityFields, {
      draft: identityToDraft(identity()),
      onChange: () => {},
      disabled: false,
    }),
  );
  for (const text of [
    "Arah visual",
    "Audiens",
    "Produk",
    "Keputusan desain",
    "Batasan",
    "Referensi",
    "Warna",
    "Tipografi",
    "Spacing",
    "Radius",
    "Shadow",
    "Tambah token",
  ])
    assert.ok(html.includes(text), text);
  assert.match(html, /Nama token Warna 1/);
  assert.match(html, /Nilai token Warna 1/);
  const center = await fs.readFile(
    new URL("../src/AgentCenter.tsx", import.meta.url),
    "utf8",
  );
  assert.match(center, /<DesignIdentity[^>]*key=\{project.id\}/);
});
const identity = () => ({
  direction: "Warm",
  audience: "Readers",
  product: "Articles",
  constraints: "Keep logo",
  decisions: "Text nav",
  references: [],
  importedNotes: "",
  tokens: {
    colors: { accent: { $type: "color", $value: "#123456" } },
    typography: {},
    spacing: {},
    radius: {},
    shadows: {},
  },
});
const snapshot = () => ({
  identity: identity(),
  revision: "rev1",
  exists: true,
  needsImport: false,
  existingDocument: "",
  exportConflict: false,
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
async function model() {
  const mod = await import("../src/design-identity-editor.ts").catch(
    () => ({}),
  );
  assert.equal(
    typeof mod.DesignIdentityEditor,
    "function",
    "editor with race-safe state must exist",
  );
  return mod;
}
test("editor saves only acknowledged identity and retains draft on errors", async () => {
  const { DesignIdentityEditor } = await model();
  const requests = [];
  const pending = deferred();
  const editor = new DesignIdentityEditor("one", async (route, body) => {
    requests.push({ route, body });
    return body ? pending.promise : snapshot();
  });
  const unsubscribe = editor.subscribe(() => {});
  await editor.load();
  editor.edit((d) => ({ ...d, direction: "Edited" }));
  const saving = editor.save(false);
  assert.equal(editor.state.status, "saving");
  assert.equal(editor.state.dirty, true);
  pending.reject(Error("disk full"));
  await saving;
  assert.equal(editor.state.status, "error");
  assert.equal(editor.state.draft.direction, "Edited");
  assert.equal(editor.state.dirty, true);
  assert.equal(requests.at(-1).body.projectId, "one");
  assert.equal(requests.at(-1).body.expected, "rev1");
  unsubscribe();
});
test("project disposal ignores late load/save and token rows round-trip without editing JSON", async () => {
  const { DesignIdentityEditor, identityToDraft, draftToIdentity } =
    await model();
  assert.deepEqual(draftToIdentity(identityToDraft(identity())), identity());
  const bad = identityToDraft(identity());
  bad.tokenRows.colors.push({ ...bad.tokenRows.colors[0] });
  assert.throws(() => draftToIdentity(bad), /unik/);
  const pending = deferred();
  let notices = 0;
  const editor = new DesignIdentityEditor("old", () => pending.promise);
  const off = editor.subscribe(() => {
    notices++;
  });
  const loading = editor.load();
  off();
  const before = notices;
  pending.resolve(snapshot());
  await loading;
  assert.equal(notices, before);
  const savingDeferred = deferred();
  const second = new DesignIdentityEditor("old", (_r, body) =>
    body ? savingDeferred.promise : Promise.resolve(snapshot()),
  );
  const off2 = second.subscribe(() => {
    notices++;
  });
  await second.load();
  second.edit((d) => ({ ...d, direction: "Changed" }));
  const saving = second.save(false);
  off2();
  const beforeSave = notices;
  savingDeferred.resolve({ ...snapshot(), revision: "rev2" });
  await saving;
  assert.equal(notices, beforeSave);
});
test("editor acknowledges save, validates rows and reload failure cannot leave stale editable data", async () => {
  const { DesignIdentityEditor } = await model();
  let fail = false;
  const editor = new DesignIdentityEditor("one", async (_r, body) => {
    if (fail) throw Error("offline");
    return body
      ? { ...snapshot(), identity: body.identity, revision: "rev2" }
      : snapshot();
  });
  editor.subscribe(() => {});
  await editor.load();
  editor.edit((d) => ({ ...d, direction: "Saved value" }));
  await editor.save(false);
  assert.equal(editor.state.status, "saved");
  assert.equal(editor.state.dirty, false);
  assert.equal(editor.state.snapshot.revision, "rev2");
  fail = true;
  await editor.load();
  assert.equal(editor.state.snapshot, null);
  assert.equal(editor.state.status, "error");
});
