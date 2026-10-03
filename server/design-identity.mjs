import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";

const files = ["DESIGN.md", "design.tokens.json"];
const marker = "<!-- forge-design-identity:v1 -->";
export const emptyIdentity = () => ({
  direction: "",
  audience: "",
  product: "",
  constraints: "",
  decisions: "",
  references: [],
  tokens: { colors: {}, typography: {}, spacing: {}, radius: {}, shadows: {} },
  importedNotes: "",
});
const hash = (value) => createHash("sha256").update(value).digest("hex");
const render = (identity) =>
  `${marker}\n# Identitas desain proyek\n\nSumber kebenaran: blok JSON berikut. Edit melalui Agent Center atau ubah blok ini dengan hati-hati. design.tokens.json adalah export turunan. Referensi tidak diambil otomatis.\n\n\`\`\`json\n${JSON.stringify(identity, null, 2)}\n\`\`\`\n`;

const object = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
const controls = (value, multiline = false) =>
  [...value].some(
    (char) =>
      char.charCodeAt(0) < 32 && !(multiline && "\n\r\t".includes(char)),
  );
const types = {
  colors: "color",
  typography: "fontFamily",
  spacing: "dimension",
  radius: "dimension",
  shadows: "string",
};
export function validateIdentity(input) {
  if (
    !object(input) ||
    Buffer.byteLength(JSON.stringify(input)) > 48000 ||
    Object.keys(input).some((key) => !Object.hasOwn(emptyIdentity(), key))
  )
    throw Error("Identitas tidak valid atau terlalu besar (maksimal 48 KB).");
  const result = emptyIdentity();
  for (const key of [
    "direction",
    "audience",
    "product",
    "constraints",
    "decisions",
    "importedNotes",
  ]) {
    const value = input[key] === undefined ? "" : input[key];
    if (
      typeof value !== "string" ||
      value.length > (key === "importedNotes" ? 16000 : 2000) ||
      controls(value, true)
    )
      throw Error(`Identitas ${key} harus teks terbatas.`);
    result[key] = value;
  }
  if (!Array.isArray(input.references) || input.references.length > 20)
    throw Error("Referensi maksimal 20 URL atau attachment:id.");
  for (const ref of input.references) {
    if (typeof ref !== "string" || ref.length > 1000)
      throw Error("Referensi tidak valid.");
    if (
      /^attachment:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        ref,
      )
    ) {
      result.references.push(ref);
      continue;
    }
    let url;
    try {
      url = new URL(ref);
    } catch {
      throw Error("Referensi harus URL http/https atau attachment:id.");
    }
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      /\s/.test(ref)
    )
      throw Error("Referensi harus URL http/https tanpa kredensial.");
    result.references.push(ref);
  }
  if (
    !object(input.tokens) ||
    Object.keys(input.tokens).some((key) => !Object.hasOwn(types, key))
  )
    throw Error(
      "Token harus kelompok colors, typography, spacing, radius, shadows.",
    );
  for (const [group, type] of Object.entries(types)) {
    const entries =
      input.tokens[group] === undefined ? {} : input.tokens[group];
    if (!object(entries) || Object.keys(entries).length > 40)
      throw Error("Token maksimal 40 per kelompok.");
    for (const [name, token] of Object.entries(entries)) {
      if (
        !/^[a-zA-Z][a-zA-Z0-9-]{0,39}$/.test(name) ||
        ["constructor", "prototype"].includes(name) ||
        !object(token) ||
        Object.keys(token).length !== 2 ||
        token.$type !== type ||
        !Object.hasOwn(token, "$value")
      )
        throw Error("Token memiliki nama atau $type/$value tidak valid.");
      const value = token.$value;
      if (type === "dimension") {
        if (
          !object(value) ||
          Object.keys(value).length !== 2 ||
          !Number.isFinite(value.value) ||
          value.value < 0 ||
          value.value > 10000 ||
          !["px", "rem", "em"].includes(value.unit)
        )
          throw Error("Token dimensi harus nilai 0–10000 dan unit px/rem/em.");
      } else {
        if (
          typeof value !== "string" ||
          !value.trim() ||
          value.length > 200 ||
          controls(value)
        )
          throw Error("Token teks maksimal 200 karakter.");
        if (
          type === "color" &&
          !/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)
        )
          throw Error(
            "Token warna harus hex #RGB, #RGBA, #RRGGBB atau #RRGGBBAA.",
          );
      }
      result.tokens[group][name] = structuredClone(token);
    }
  }
  return result;
}

const locks = new Map();
async function rootFor(workspace, project) {
  if (!project || workspace.get(project.id).path !== project.path)
    throw Error("Proyek tidak valid.");
  const root = await fs.realpath(project.path);
  if (root !== project.path || !(await fs.lstat(root)).isDirectory())
    throw Error("Path proyek berubah atau tidak aman. Buka ulang proyek.");
  return root;
}
async function readBounded(root, name) {
  let handle;
  try {
    handle = await fs.open(
      path.join(root, name),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1)
      throw Error("File desain harus file biasa tanpa link.");
    if (stat.size > 64000)
      throw Error("File desain terlalu besar (maksimal 64 KB).");
    const buffer = Buffer.alloc(64001);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 64000)
      throw Error("File desain terlalu besar (maksimal 64 KB).");
    return new TextDecoder("utf-8", { fatal: true }).decode(
      buffer.subarray(0, bytesRead),
    );
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error.code === "ELOOP") throw Error("Symlink file desain tidak aman.");
    throw error;
  } finally {
    await handle?.close();
  }
}

export class DesignIdentity {
  constructor(workspace) {
    this.workspace = workspace;
  }
  async get(project) {
    await locks.get(project?.path)?.catch(() => {});
    return this.snapshot(project);
  }
  async snapshot(project) {
    const root = await rootFor(this.workspace, project);
    const contents = await Promise.all(
      files.map((name) => readBounded(root, name)),
    );
    const [doc, tokenText] = contents;
    const owned = doc?.startsWith(marker);
    let identity = emptyIdentity();
    if (owned) {
      try {
        const match = doc.match(/```json\n([\s\S]*)\n```\n$/);
        identity = validateIdentity(JSON.parse(match[1]));
        const prefix = render(emptyIdentity()).split("```json\n")[0];
        if (!doc.startsWith(prefix)) throw Error("Unknown document content");
      } catch {
        throw Error(
          "DESIGN.md tidak valid. Pulihkan atau perbaiki dokumen; tidak ada file yang ditimpa.",
        );
      }
    }
    let exportConflict = tokenText !== null && !owned;
    if (owned && tokenText !== null) {
      try {
        exportConflict =
          JSON.stringify(JSON.parse(tokenText)) !==
          JSON.stringify(identity.tokens);
      } catch {
        exportConflict = true;
      }
    }
    return {
      identity,
      revision: hash(JSON.stringify(contents)),
      exists: doc !== null,
      needsImport: doc !== null && !owned,
      existingDocument: owned ? "" : doc || "",
      exportConflict,
    };
  }
  async save(project, input) {
    const key = project?.path;
    const prior = locks.get(key) || Promise.resolve();
    const pending = prior
      .catch(() => {})
      .then(() => this.saveUnlocked(project, input));
    locks.set(key, pending);
    try {
      return await pending;
    } finally {
      if (locks.get(key) === pending) locks.delete(key);
    }
  }
  async saveUnlocked(
    project,
    { identity, expected, importExisting = false } = {},
  ) {
    const previous = await this.snapshot(project);
    if (previous.revision !== expected)
      throw Error("Identitas berubah. Muat ulang sebelum menyimpan.");
    if (previous.exportConflict)
      throw Error(
        "File token milik pengguna atau berubah. Pindahkan file tersebut atau pulihkan sesuai DESIGN.md sebelum menyimpan.",
      );
    if (previous.needsImport && importExisting !== true)
      throw Error(
        "DESIGN.md sudah ada. Konfirmasi impor untuk mempertahankan dokumen lama.",
      );
    let value = validateIdentity(identity);
    if (previous.needsImport)
      value = validateIdentity({
        ...value,
        importedNotes: previous.existingDocument,
      });
    else if (previous.identity.importedNotes) {
      if (
        identity.importedNotes !== undefined &&
        identity.importedNotes !== previous.identity.importedNotes
      )
        throw Error(
          "Catatan dokumen impor tidak boleh diganti diam-diam. Edit DESIGN.md secara eksplisit jika diperlukan.",
        );
      value = validateIdentity({
        ...value,
        importedNotes: previous.identity.importedNotes,
      });
    }
    for (const ref of value.references.filter((item) =>
      item.startsWith("attachment:"),
    )) {
      try {
        const base = await fs.realpath(this.workspace.dataDir);
        const target = path.join(
          base,
          "attachments",
          project.id,
          ref.slice(11) + ".json",
        );
        if ((await fs.realpath(target)) !== target) throw Error("link");
        const stat = await fs.lstat(target);
        if (!stat.isFile() || stat.nlink !== 1) throw Error("file");
      } catch {
        throw Error(
          "Referensi lampiran harus sudah ada di proyek ini. Tidak ada upload otomatis.",
        );
      }
    }
    await this.workspace.checkpoint(
      project,
      "Sebelum menyimpan identitas desain",
    );
    const checked = await this.snapshot(project);
    if (checked.revision !== expected)
      throw Error("Identitas berubah selama checkpoint. Muat ulang.");
    const root = await rootFor(this.workspace, project);
    const outputs = [
      render(value),
      JSON.stringify(value.tokens, null, 2) + "\n",
    ];
    const before = await Promise.all(
      files.map((name) => readBounded(root, name)),
    );
    if (hash(JSON.stringify(before)) !== expected)
      throw Error("Identitas berubah. Muat ulang.");
    const staged = files.map(() =>
      path.join(root, `.forge-design-${randomUUID()}.tmp`),
    );
    let tokenWritten = false;
    try {
      for (const [index, target] of staged.entries()) {
        const handle = await fs.open(target, "wx", 0o600);
        try {
          await handle.writeFile(outputs[index]);
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
      if ((await this.snapshot(project)).revision !== expected)
        throw Error("Identitas berubah. Muat ulang.");
      // Derived export first; canonical document commits last. A crash is detected as
      // an export conflict, never reported as saved. Checkpoint remains recoverable.
      await fs.rename(staged[1], path.join(root, files[1]));
      tokenWritten = true;
      await rootFor(this.workspace, project);
      if ((await readBounded(root, files[0])) !== before[0])
        throw Error("Identitas berubah. Muat ulang.");
      await fs.rename(staged[0], path.join(root, files[0]));
    } catch (error) {
      if (
        tokenWritten &&
        (await readBounded(root, files[1]).catch(() => null)) === outputs[1]
      ) {
        if (before[1] === null) await fs.unlink(path.join(root, files[1]));
        else {
          await fs.writeFile(staged[1], before[1], { flag: "wx", mode: 0o600 });
          await fs.rename(staged[1], path.join(root, files[1]));
        }
      }
      throw error;
    } finally {
      await Promise.all(staged.map((file) => fs.rm(file, { force: true })));
    }
    const saved = await this.snapshot(project);
    if (
      JSON.stringify(saved.identity) !== JSON.stringify(value) ||
      saved.exportConflict
    )
      throw Error("Identitas berubah sesudah simpan. Muat ulang.");
    return saved;
  }
}
