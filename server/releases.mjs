import { randomUUID } from "node:crypto";

const deploymentId = /^[A-Za-z0-9_-]{8,64}$/;
const providers = new Set(["cloudflare", "vercel"]);

export function releaseUrl(output, provider) {
  const suffix = provider === "cloudflare" ? ".pages.dev" : ".vercel.app";
  for (const match of String(output || "").matchAll(
    /https:\/\/[a-z0-9.-]+/gi,
  )) {
    try {
      const url = new URL(match[0]);
      if (url.hostname.endsWith(suffix) && url.hostname !== suffix.slice(1))
        return url.href;
    } catch {
      /* ignore malformed CLI output */
    }
  }
  return null;
}

function normalizeCloudflare(item, projectName) {
  if (
    !item ||
    !deploymentId.test(item.id) ||
    !["production", "preview"].includes(item.environment)
  )
    return null;
  const status =
    item.latest_stage?.status === "success"
      ? "success"
      : item.latest_stage?.status || "unknown";
  return {
    id: item.id,
    provider: "cloudflare",
    projectName,
    target: "web",
    environment: item.environment,
    status,
    createdAt: item.created_on,
    url: releaseUrl(item.url, "cloudflare"),
    rollbackable:
      item.environment === "production" &&
      status === "success" &&
      !item.is_skipped,
    source: "provider",
  };
}

function normalizeVercel(item, projectName) {
  if (!item || item.name !== projectName || !deploymentId.test(item.uid))
    return null;
  const status =
    item.state === "READY"
      ? "success"
      : String(item.state || "unknown").toLowerCase();
  const created = new Date(item.createdAt || item.created || 0);
  return {
    id: item.uid,
    provider: "vercel",
    projectName,
    target: "web",
    environment: item.target === "production" ? "production" : "preview",
    status,
    createdAt: Number.isNaN(created.getTime())
      ? new Date(0).toISOString()
      : created.toISOString(),
    url: releaseUrl(
      item.url
        ? item.url.startsWith("https://")
          ? item.url
          : `https://${item.url}`
        : "",
      "vercel",
    ),
    rollbackable:
      item.target === "production" &&
      status === "success" &&
      item.rollbackCandidate !== false,
    source: "provider",
  };
}

export class ReleaseHistory {
  constructor(store = null, fetcher = globalThis.fetch) {
    this.store = store;
    this.fetcher = fetcher;
    this.fallback = new Map();
  }
  local(projectId) {
    return (
      this.store?.setting("release-history", projectId) ||
      this.fallback.get(projectId) ||
      []
    );
  }
  record(projectId, input) {
    const entry = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      ...input,
      source: "forge",
    };
    const next = [entry, ...this.local(projectId)].slice(0, 50);
    if (this.store) this.store.setSetting("release-history", projectId, next);
    else this.fallback.set(projectId, next);
    return entry;
  }
  credentials(provider) {
    if (provider === "cloudflare") {
      const account = process.env.CLOUDFLARE_ACCOUNT_ID || "";
      const token = process.env.CLOUDFLARE_API_TOKEN || "";
      return token && /^[a-f0-9]{32}$/i.test(account)
        ? { token, account }
        : null;
    }
    return process.env.VERCEL_TOKEN
      ? { token: process.env.VERCEL_TOKEN }
      : null;
  }
  async request(url, token, method = "GET") {
    const response = await this.fetcher(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
    const payload = await response.json();
    if (!response.ok || ("success" in payload && !payload.success))
      throw Error(
        `Layanan deploy menolak permintaan (${response.status}). Periksa token dan izin akun.`,
      );
    return payload;
  }
  async remote(config) {
    if (!providers.has(config.hosting)) throw Error("Hosting tidak didukung.");
    const auth = this.credentials(config.hosting);
    if (!auth)
      throw Error(
        config.hosting === "cloudflare"
          ? "Riwayat online memerlukan CLOUDFLARE_API_TOKEN dan CLOUDFLARE_ACCOUNT_ID."
          : "Riwayat online memerlukan VERCEL_TOKEN.",
      );
    if (config.hosting === "cloudflare") {
      const url = `https://api.cloudflare.com/client/v4/accounts/${auth.account}/pages/projects/${encodeURIComponent(config.projectName)}/deployments?per_page=50`;
      const payload = await this.request(url, auth.token);
      if (!Array.isArray(payload.result))
        throw Error("Format riwayat Cloudflare tidak dikenali.");
      return payload.result
        .map((item) => normalizeCloudflare(item, config.projectName))
        .filter(Boolean);
    }
    const url = new URL("https://api.vercel.com/v7/deployments");
    url.searchParams.set("projectId", config.projectName);
    url.searchParams.set("limit", "50");
    if (
      process.env.VERCEL_ORG_ID &&
      /^(?:team|org)_[A-Za-z0-9_-]+$/.test(process.env.VERCEL_ORG_ID)
    )
      url.searchParams.set("teamId", process.env.VERCEL_ORG_ID);
    const payload = await this.request(url.href, auth.token);
    if (!Array.isArray(payload.deployments))
      throw Error("Format riwayat Vercel tidak dikenali.");
    return payload.deployments
      .map((item) => normalizeVercel(item, config.projectName))
      .filter(Boolean);
  }
  async list(projectId, config) {
    const local = this.local(projectId).filter(
      (entry) =>
        entry.provider === config.hosting &&
        entry.projectName === config.projectName,
    );
    try {
      const remote = await this.remote(config);
      const urls = new Set(remote.map((entry) => entry.url).filter(Boolean));
      return {
        online: true,
        entries: [
          ...remote,
          ...local.filter((entry) => !entry.url || !urls.has(entry.url)),
        ]
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
          .slice(0, 60),
      };
    } catch (error) {
      return { online: false, note: error.message, entries: local };
    }
  }
  async verify(config, id) {
    if (typeof id !== "string" || !deploymentId.test(id))
      throw Error("ID rilis tidak valid.");
    const entries = await this.remote(config);
    const entry = entries.find((item) => item.id === id);
    if (!entry || !entry.rollbackable || entry.environment !== "production")
      throw Error(
        "Rilis produksi ini tidak tersedia untuk rollback. Muat ulang riwayat.",
      );
    return entry;
  }
  async rollbackCloudflare(config, id) {
    const { token, account } = this.credentials("cloudflare");
    const url = `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${encodeURIComponent(config.projectName)}/deployments/${encodeURIComponent(id)}/rollback`;
    return this.request(url, token, "POST");
  }
}
