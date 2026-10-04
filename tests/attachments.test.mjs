import { encodeWav } from "../src/audio.ts";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  Attachments,
  validateLink,
  publicIPv4,
  attachmentPrompt,
  imageInputs,
  audioInputs,
  extractPdfText,
  inspectZip,
} from "../server/attachments.mjs";
import { Codex } from "../server/codex.mjs";
import { Gemini } from "../server/gemini.mjs";
const image = {
  mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
};
function storedZip(name, content) {
  const filename = Buffer.from(name),
    data = Buffer.from(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(filename.length, 28);
  const directoryOffset = local.length + filename.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + filename.length, 12);
  eocd.writeUInt32LE(directoryOffset, 16);
  return Buffer.concat([local, filename, data, central, filename, eocd]);
}
test("attachment IDs are project scoped; images validated, malformed payloads rejected", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "forge-media-"));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const a = new Attachments(tmp),
    p = { id: "one" };
  const item = await a.add(p, {
    kind: "image",
    name: "reference.png",
    images: [image],
  });
  assert.equal(item.kind, "image");
  assert.equal(item.images, undefined);
  const resolved = await a.resolve(p, [item.id]);
  assert.equal(resolved[0].images[0].mimeType, "image/png");
  await assert.rejects(() => a.resolve({ id: "two" }, [item.id]));
  await assert.rejects(() => a.resolve(p, ["../../escape"]));
  await assert.rejects(() =>
    a.add(p, { kind: "image", images: [{ data: "aGVsbG8=" }] }),
  );
});
test("links reject localhost, credentials, private and reserved addresses", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
  ])
    assert.equal(publicIPv4(ip), false, ip);
  assert.equal(publicIPv4("8.8.8.8"), true);
  for (const url of [
    "http://example.com",
    "file:///etc/passwd",
    "https://127.1/",
    "https://user:pass@example.com/",
    "https://example.com:8443/",
  ])
    assert.throws(() => validateLink(url));
  assert.equal(
    validateLink("https://example.com/docs").hostname,
    "example.com",
  );
});
test("text, PDF, and ZIP attachments become usable agent context", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "forge-files-"));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const store = new Attachments(tmp),
    projectRoot = path.join(tmp, "project");
  await fs.mkdir(projectRoot);
  const project = { id: "files", path: projectRoot };
  const code = await store.add(project, {
    kind: "code",
    name: "app.ts",
    mimeType: "text/typescript",
    size: 21,
    data: Buffer.from("export const ready=true;").toString("base64"),
  });
  const zipBytes = storedZip(
    "requirements.md",
    "Build a friendly landing page",
  );
  const archive = await store.add(project, {
    kind: "archive",
    name: "brief.zip",
    mimeType: "application/zip",
    size: zipBytes.length,
    data: zipBytes.toString("base64"),
  });
  const resolved = await store.resolve(project, [code.id, archive.id]);
  assert.match(attachmentPrompt(resolved), /export const ready=true/);
  assert.match(attachmentPrompt(resolved), /friendly landing page/);
  const staged = await store.stage(project, resolved);
  assert.equal(staged.length, 2);
  assert.equal(
    await fs.readFile(path.join(projectRoot, staged[0]), "utf8"),
    "export const ready=true;",
  );
  assert.equal(inspectZip(zipBytes)[0].name, "requirements.md");
  const pdf = Buffer.from(
    "%PDF-1.4\n1 0 obj<< /Length 42 >>stream\nBT (Hello Forge PDF) Tj ET\nendstream\nendobj\n%%EOF",
    "latin1",
  );
  assert.match(extractPdfText(pdf), /Hello Forge PDF/);
});
test("Build stages uploaded images as public project assets", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "forge-image-assets-"));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const store = new Attachments(path.join(tmp, "media"));
  for (const variant of ["static", "vite"]) {
    const projectRoot = path.join(tmp, variant);
    await fs.mkdir(projectRoot);
    if (variant === "vite")
      await fs.writeFile(
        path.join(projectRoot, "package.json"),
        JSON.stringify({ devDependencies: { vite: "^6.0.0" } }),
      );
    const project = { id: variant, path: projectRoot };
    const uploaded = await store.add(project, {
      kind: "image",
      name: "Brand Logo.png",
      size: Buffer.from(image.data, "base64").length,
      source: image,
      images: [image],
    });
    const media = await store.resolve(project, [uploaded.id]);
    const staged = await store.stage(project, media);
    const prefix =
      variant === "vite" ? "public/forge-assets/" : "assets/forge-uploads/";
    assert.equal(staged.length, 1);
    assert.ok(staged[0].startsWith(prefix));
    assert.deepEqual(
      await fs.readFile(path.join(projectRoot, staged[0])),
      Buffer.from(image.data, "base64"),
    );
    const prompt = attachmentPrompt(media);
    assert.match(prompt, /already copied the original binary/);
    assert.match(prompt, /Use this exact existing asset/);
    assert.match(
      prompt,
      variant === "vite"
        ? /browser URL is \/forge-assets\//
        : /browser URL is \/assets\/forge-uploads\//,
    );
  }
  await assert.rejects(
    () =>
      store.add(
        { id: "disguised", path: path.join(tmp, "disguised") },
        {
          kind: "image",
          name: "logo.html",
          source: {
            data: Buffer.from("<script>alert(1)</script>").toString("base64"),
            mimeType: "image/png",
          },
          images: [image],
        },
      ),
    /tidak sesuai/,
  );
});
test("video context reports complete audio and sampled frames", () => {
  const media = [
    {
      kind: "video",
      name: "demo.mp4",
      duration: 60,
      images: [
        { ...image, timestamp: 5 },
        { ...image, timestamp: 55 },
      ],
    },
  ];
  assert.match(attachmentPrompt(media), /complete audio track/);
  assert.match(attachmentPrompt(media), /5.0s, 55.0s/);
  assert.equal(imageInputs(media, "gemini")[0].data, image.data);
  assert.match(imageInputs(media, "codex")[0].url, /^data:image\/png;base64,/);
});
test("Codex multimodal turn contains real image content", async () => {
  const c = new Codex(() => {});
  c.connect = async () => ({});
  let input;
  c.request = async (method, p) => {
    if (method === "thread/start") return { thread: { id: "t" } };
    input = p.input;
    return { turn: { id: "x" } };
  };
  await c.turn({ id: "p", path: "/tmp/p" }, "ask", "describe", "gpt-6-astra", [
    { images: [image] },
  ]);
  assert.equal(input[1].type, "image");
  assert.match(input[1].url, /iVBOR/);
});
test("Gemini multimodal prompt contains real image content", async () => {
  const g = new Gemini(() => {});
  g.session = async () => ({
    sessionId: "s",
    modes: { availableModes: [{ id: "plan" }] },
  });
  let prompt;
  g.request = async (method, p) => {
    if (method === "session/prompt") prompt = p.prompt;
    return { stopReason: "end_turn" };
  };
  await g.turn({ id: "p" }, "ask", "describe", "flash", [{ images: [image] }]);
  await g.completion;
  assert.equal(prompt[1].mimeType, "image/png");
  assert.equal(prompt[1].data, image.data);
});

test("full WAV audio is stored and sent to both provider protocols", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "forge-audio-"));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const pcm = new Float32Array(16000);
  pcm[0] = 1;
  pcm[15999] = -1;
  const wav = encodeWav(pcm);
  const view = new DataView(wav.buffer);
  assert.equal(view.getUint32(40, true), 32000);
  assert.equal(view.getInt16(44, true), 32767);
  assert.equal(view.getInt16(wav.length - 2, true), -32768);
  const audio = {
    data: Buffer.from(wav).toString("base64"),
    mimeType: "audio/wav",
  };
  const store = new Attachments(tmp),
    project = { id: "p" };
  const meta = await store.add(project, {
    kind: "audio",
    name: "voice.wav",
    audio,
  });
  assert.equal(meta.duration, 1);
  assert.equal(meta.audio, undefined);
  const media = await store.resolve(project, [meta.id]);
  assert.equal(audioInputs(media, "gemini")[0].data, audio.data);
  assert.match(audioInputs(media, "codex")[0].url, /^data:audio\/wav;base64,/);
  await assert.rejects(
    () =>
      store.add(project, {
        kind: "video",
        name: "clip.mp4",
        duration: 1,
        images: [image],
      }),
    /Audio wajib/,
  );
});

test("audio is included in a Gemini model prompt, never only a text label", async () => {
  const g = new Gemini(() => {});
  g.session = async () => ({
    sessionId: "s",
    modes: { availableModes: [{ id: "plan" }] },
  });
  let prompt;
  g.request = async (method, p) => {
    if (method === "session/prompt") prompt = p.prompt;
    return { stopReason: "end_turn" };
  };
  const audio = {
    data: Buffer.from(encodeWav(new Float32Array(16000))).toString("base64"),
    mimeType: "audio/wav",
  };
  await g.turn({ id: "p" }, "ask", "analyze audio", "pro", [{ audio }]);
  await g.completion;
  assert.equal(prompt[1].type, "audio");
  assert.equal(prompt[1].data, audio.data);
});
