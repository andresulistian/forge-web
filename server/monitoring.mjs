import https from "node:https";
import { lookup } from "node:dns/promises";
import { publicIPv4, publicUrl } from "./web.mjs";

const intervals = new Set([5, 15, 30, 60]);

export function validateMonitor(input = {}) {
  if (typeof input.url !== "string" || input.url.length > 300) throw Error("URL monitoring tidak valid.");
  const address = input.url.trim();
  const url = address ? publicUrl(address) : null;
  let original = null;
  try { if (address) original = new URL(address); } catch { /* invalid URL */ }
  if (address && (!url || original.search || original.hash || original.port && original.port !== "443"))
    throw Error("Gunakan URL HTTPS publik tanpa parameter atau kredensial.");
  if (typeof input.expected !== "string" || input.expected.length > 100 || /[\r\n]/.test(input.expected))
    throw Error("Teks yang diharapkan terlalu panjang.");
  const interval = Number(input.interval || 15);
  if (!intervals.has(interval)) throw Error("Interval monitoring tidak didukung.");
  if (typeof input.enabled !== "boolean") throw Error("Status monitoring tidak valid.");
  if (input.enabled && !url) throw Error("Isi URL publik untuk mengaktifkan monitoring.");
  return { url: url?.href || "", expected: input.expected.trim(), interval, enabled: input.enabled };
}

export async function probePublicSite(address, expected = "", resolve = lookup, request = https.request) {
  const url = publicUrl(address);
  if (!url || url.search || url.hash) throw Error("Alamat monitoring harus HTTPS publik tanpa parameter.");
  const addresses = await resolve(url.hostname, { family: 4, all: true });
  if (!addresses.length || addresses.some(({ address: ip }) => !publicIPv4(ip)))
    throw Error("Alamat monitoring bukan alamat publik.");
  const ip = addresses[0].address;
  const start = Date.now();
  return new Promise((done, fail) => {
    const req = request(url, {
      method: "GET", timeout: 8000,
      headers: { "User-Agent": "Forge-Web/0.3 (health-check)", Accept: "text/html,text/plain,application/json", "Accept-Encoding": "identity" },
      lookup: (_host, _options, callback) => callback(null, ip, 4),
    }, (res) => {
      let size = 0;
      const parts = [];
      res.on("data", (part) => {
        size += part.length;
        if (size > 260000) return req.destroy(Error("Respons situs terlalu besar."));
        parts.push(part);
      });
      res.on("error", fail);
      res.on("end", () => {
        const status = res.statusCode || 0;
        const content = Buffer.concat(parts).toString("utf8");
        const ok = status >= 200 && status < 300 && (!expected || content.includes(expected));
        done({ ok, status, latencyMs: Date.now() - start,
          reason: ok ? "Situs merespons normal." : status >= 300 && status < 400
            ? "Situs mengalihkan permintaan; periksa URL akhir secara langsung."
            : status >= 200 && status < 300 ? "Teks yang diharapkan tidak ditemukan." : `HTTP ${status}` });
      });
    });
    req.on("timeout", () => req.destroy(Error("Situs tidak merespons dalam 8 detik.")));
    req.on("error", fail);
    req.end();
  });
}

export class Monitoring {
  constructor(store, emit, probe = probePublicSite) {
    this.store = store;
    this.emit = emit;
    this.probe = probe;
    this.running = new Set();
  }
  status(projectId) {
    return { config: this.store.setting("monitor-config", projectId) || { url: "", expected: "", interval: 15, enabled: false },
      checks: this.store.setting("monitor-checks", projectId) || [] };
  }
  save(projectId, input) {
    const config = validateMonitor(input);
    this.store.setSetting("monitor-config", projectId, config);
    return this.status(projectId);
  }
  async check(projectId) {
    const { config } = this.status(projectId);
    if (!config.url) throw Error("Simpan URL monitoring terlebih dahulu.");
    if (this.running.has(projectId)) throw Error("Pemeriksaan situs masih berlangsung.");
    this.running.add(projectId);
    try {
      let result;
      try { result = await this.probe(config.url, config.expected); }
      catch (error) { result = { ok: false, status: null, latencyMs: null, reason: String(error.message).slice(0, 160) }; }
      const checkedAt = new Date().toISOString();
      const checks = [{ ...result, checkedAt, url: config.url }, ...this.status(projectId).checks].slice(0, 30);
      this.store.setSetting("monitor-checks", projectId, checks);
      this.emit("monitor-result", { projectId, ok: result.ok, checkedAt });
      return this.status(projectId);
    } finally { this.running.delete(projectId); }
  }
  async tick() {
    for (const projectId of this.store.settingKeys("monitor-config")) {
      const { config, checks } = this.status(projectId);
      if (!config.enabled || this.running.has(projectId)) continue;
      const last = Date.parse(checks[0]?.checkedAt || "") || 0;
      if (Date.now() - last >= config.interval * 60000)
        await this.check(projectId).catch(() => {});
    }
  }
}
