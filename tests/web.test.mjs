import test from "node:test";
import assert from "node:assert/strict";
import { MemoryCredentialStore } from "../server/credentials.mjs";
import {
  WebResearch,
  publicIPv4,
  publicUrl,
  readPublicPage,
  shouldBrowse,
} from "../server/web.mjs";
import { Agents } from "../server/agents.mjs";

test("automatic search responds to current information but skips local data and secrets", () => {
  assert.equal(shouldBrowse("Berapa harga terbaru laptop ini?"), true);
  assert.equal(shouldBrowse("Buka https://example.org/docs"), true);
  assert.equal(shouldBrowse("Jelaskan file .env untuk harga terbaru"), false);
  assert.equal(
    shouldBrowse("api_key=sk-abcdefghijklmnopqrstuvwxyz terbaru"),
    false,
  );
  assert.equal(shouldBrowse("Buat form sederhana"), false);
});

test("page reader blocks private hosts, DNS answers, ports, and HTTP", async () => {
  assert.equal(publicIPv4("127.0.0.1"), false);
  assert.equal(publicIPv4("169.254.169.254"), false);
  assert.equal(publicIPv4("192.168.1.1"), false);
  assert.equal(publicIPv4("8.8.8.8"), true);
  for (const address of [
    "http://example.org",
    "https://localhost",
    "https://user:pw@example.org",
    "https://example.org:8443",
    "https://127.0.0.1",
  ])
    assert.equal(publicUrl(address), null);
  let requested = false;
  await assert.rejects(
    readPublicPage(
      "https://example.org/",
      0,
      async () => [{ address: "10.0.0.1" }],
      () => {
        requested = true;
      },
    ),
    /publik/,
  );
  assert.equal(requested, false);
});

test("web mode requires a key, off mode makes no requests, and search results include sources", async () => {
  const credentials = new MemoryCredentialStore();
  const requests = [];
  const web = new WebResearch({
    credentials,
    fetchImpl: async (_url, options) => {
      requests.push(options.headers["X-Subscription-Token"]);
      return Response.json({
        web: {
          results: [
            {
              title: "Dokumentasi",
              url: "https://example.org/docs",
              description: "Deskripsi halaman",
            },
            {
              title: "Alamat lokal",
              url: "https://127.0.0.1/private",
              description: "Rahasia",
            },
          ],
        },
      });
    },
    pageReader: async () => "Isi halaman yang diperiksa",
  });
  assert.equal(await web.prepare("Berita hari ini", "off"), null);
  assert.equal(
    (await web.prepare("Berita hari ini", "auto")).sources.length,
    0,
  );
  await assert.rejects(web.prepare("Berita hari ini", "web"), /API key/);
  await web.save("brave-test-key");
  const result = await web.prepare("Berita hari ini", "web");
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].url, "https://example.org/docs");
  assert.match(result.context, /Isi halaman yang diperiksa/);
  assert.doesNotMatch(JSON.stringify(result), /brave-test-key/);
  assert.deepEqual(requests, ["brave-test-key"]);
  await web.remove();
  assert.equal((await web.status()).configured, false);
});

test("research context reaches each selected agent and API provider without changing user text", async () => {
  const agents = new Agents(() => {}, "/tmp/forge-test-runtime");
  const seen = [];
  agents.codex.models = async () => [{ model: "model" }];
  agents.apiProviders.store = { messages: () => [] };
  for (const name of ["codex", "gemini", "ollama"]) {
    agents[name].turn = async (...args) => seen.push({ name, args });
    agents[name].active = null;
  }
  agents.apiProviders.turn = async (...args) =>
    seen.push({ name: "api", args });
  agents.apiProviders.active = null;
  const project = { id: "sample" };
  for (const provider of ["codex", "gemini", "ollama", "api:one"])
    await agents.turn(
      project,
      "ask",
      "Pertanyaan",
      provider,
      "model",
      [],
      "Pertanyaan",
      "\nSumber: https://example.org",
    );
  assert.equal(seen.length, 4);
  for (const item of seen.slice(0, 3))
    assert.match(item.args[2], /Sumber: https:\/\/example.org/);
  assert.equal(seen[3].args[2], "Pertanyaan");
  assert.match(seen[3].args[6], /Sumber: https:\/\/example.org/);
});
