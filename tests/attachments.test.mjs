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
} from "../server/attachments.mjs";
import { Codex } from "../server/codex.mjs";
import { Gemini } from "../server/gemini.mjs";
const image = {
  mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=",
};
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
