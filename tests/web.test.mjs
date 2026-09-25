import test from "node:test";
import assert from "node:assert/strict";
import { MemoryCredentialStore } from "../server/credentials.mjs";
import { WebResearch, publicIPv4, publicUrl, readPublicPage, shouldBrowse } from "../server/web.mjs";
import { Agents } from "../server/agents.mjs";

test("automatic search responds to current information but skips local data and secrets", () => {
  assert.equal(shouldBrowse("Berapa harga terbaru laptop ini?"), true);
  assert.equal(shouldBrowse("Buka https://example.org/docs"), true);
  assert.equal(shouldBrowse("Jelaskan file .env untuk harga terbaru"), false);
  assert.equal(shouldBrowse("api_key=sk-abcdefghijklmnopqrstuvwxyz terbaru"), false);
  assert.equal(shouldBrowse("Buat form sederhana"), false);
});

test("page reader blocks private hosts, DNS answers, ports, and HTTP", async () => {
  assert.equal(publicIPv4("127.0.0.1"), false);
  assert.equal(publicIPv4("169.254.169.254"), false);
  assert.equal(publicIPv4("192.168.1.1"), false);
  assert.equal(publicIPv4("8.8.8.8"), true);
  for (const address of ["http://example.org", "https://localhost", "https://user:pw@example.org", "https://example.org:8443", "https://127.0.0.1"])
    assert.equal(publicUrl(address), null);
  let requested = false;
  await assert.rejects(readPublicPage("https://example.org/", 0,
    async () => [{ address: "10.0.0.1" }],
    () => { requested = true; }), /publik/);
  assert.equal(requested, false);
});

test("web mode requires a key, off mode makes no requests, and search results include sources", async () => {
  const credentials = new MemoryCredentialStore();
  const requests = [];
  const web = new WebResearch({ credentials,
    fetchImpl: async (_url, options) => {
      requests.push(options.headers["X-Subscription-Token"]);
      return Response.json({ web: { results: [
        { title: "Dokumentasi", url: "https://example.org/docs", description: "Deskripsi halaman" },
        { title: "Alamat lokal", url: "https://127.0.0.1/private", description: "Rahasia" },
      ] } });
    },
    pageReader: async () => "Isi halaman yang diperiksa",
  });
  assert.equal(await web.prepare("Berita hari ini", "off"), null);
  assert.equal((await web.prepare("Berita hari ini", "auto")).sources.length, 0);
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

test("direct URLs work without a search key and fall back from fetch extraction to browser render", async () => {
  const steps = [];
  const web = new WebResearch({
    credentials: new MemoryCredentialStore(),
    pageReader: async () => { steps.push("fetch"); return "blocked"; },
    browserReader: async () => {
      steps.push("browser");
      return { title: "Rendered page", text: "Rendered content ".repeat(30), dom: "<main>Rendered</main>", screenshot: "/tmp/capture.png", method: "browser" };
    },
  });
  const result = await web.prepare("Redesign https://example.org/", "auto");
  assert.deepEqual(steps, ["fetch", "browser"]);
  assert.equal(result.sources[0].method, "browser");
  assert.equal(result.sources[0].screenshot, true);
  assert.match(result.context, /Rendered content/);
});

test("a blocked URL uses site search last and returns clear attempt diagnostics", async () => {
  const credentials = new MemoryCredentialStore();
  await credentials.set("web:brave", "key");
  const web = new WebResearch({
    credentials,
    pageReader: async () => { throw Error("HTTP fetch blocked"); },
    browserReader: async () => { throw Error("Browser blocked"); },
    fetchImpl: async (url) => {
      assert.match(String(url), /site%3Aexample.org/);
      return Response.json({ web: { results: [{ title: "Cached page", url: "https://example.org/about", description: "Search fallback" }] } });
    },
  });
  const result = await web.prepare("Review https://example.org/", "web");
  assert.equal(result.diagnostics[0].attempts.length, 2);
  assert.equal(result.diagnostics[0].attempts.every((attempt) => !attempt.ok), true);
  assert.equal(result.sources.some((source) => source.url.endsWith("/about")), true);
});

test("research context reaches each selected agent and API provider without changing user text", async () => {
  const agents = new Agents(() => {}, "/tmp/forge-test-runtime");
  const seen = [];
  agents.codex.models = async () => [{ model: "model" }];
  agents.apiProviders.store = { messages: () => [] };
  for (const name of ["codex", "gemini", "ollama", "bonsai"]) {
    agents[name].turn = async (...args) => seen.push({ name, args });
    agents[name].active = null;
  }
  agents.apiProviders.turn = async (...args) => seen.push({ name: "api", args });
  agents.apiProviders.active = null;
  const project = { id: "sample" };
  for (const provider of ["codex", "gemini", "ollama", "bonsai", "api:one"])
    await agents.turn(project, "ask", "Pertanyaan", provider, "model", [], "Pertanyaan", "\nSumber: https://example.org");
  assert.equal(seen.length, 5);
  for (const item of seen.slice(0, 4)) assert.match(item.args[2], /Sumber: https:\/\/example.org/);
  assert.equal(seen[4].args[2], "Pertanyaan");
  assert.match(seen[4].args.at(-2), /Sumber: https:\/\/example.org/);
  assert.deepEqual(seen[4].args.at(-1), []);
});
