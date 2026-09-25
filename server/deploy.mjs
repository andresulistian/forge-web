import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { privateName } from "./workspace.mjs";
import { securityAudit } from "./security.mjs";
import { ReleaseHistory, releaseUrl } from "./releases.mjs";

const hosting = new Set(["cloudflare", "vercel"]);
const databases = new Set(["none", "supabase", "firebase", "local"]);
const environments = new Set(["preview", "production"]);
const mobileProfiles = new Set(["preview", "production"]);
const targets = new Set(["web", "ios", "android"]);

function cleanName(value, fallback) {
  const name = String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 58);
  if (!name) throw Error("Nama deploy tidak valid.");
  return name;
}

function bundleId(value, fallback) {
  const id = String(value || fallback).slice(0, 150);
  if (!/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9-]+){1,}$/.test(id))
    throw Error("App identifier harus seperti com.nama.aplikasi.");
  return id;
}

export function validateDeployConfig(input = {}, projectName = "app") {
  const config = {
    hosting: String(input.hosting || "cloudflare"),
    database: String(input.database || "none"),
    environment: String(input.environment || "preview"),
    mobileProfile: String(input.mobileProfile || "preview"),
    projectName: cleanName(input.projectName, projectName),
    appId: bundleId(
      input.appId,
      `com.forge.${cleanName(projectName, "app").replaceAll("-", "")}`,
    ),
  };
  if (!hosting.has(config.hosting)) throw Error("Hosting tidak didukung.");
  if (!databases.has(config.database)) throw Error("Database tidak didukung.");
  if (!environments.has(config.environment))
    throw Error("Environment deploy tidak valid.");
  if (!mobileProfiles.has(config.mobileProfile))
    throw Error("Profil mobile tidak valid.");
  return config;
}

async function readPackage(project) {
  try {
    return JSON.parse(
      await fs.readFile(path.join(project.path, "package.json"), "utf8"),
    );
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw Error("package.json proyek tidak valid.");
  }
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export class DeployManager {
  constructor(dataDir, emit, store = null, fetcher = globalThis.fetch) {
    this.root = path.join(dataDir, "deploy");
    this.emit = emit;
    this.store = store;
    this.releases = new ReleaseHistory(store, fetcher);
    this.active = null;
  }
  configFile(project) {
    return path.join(this.root, project.id + ".json");
  }
  async config(project) {
    const stored = this.store?.setting("deploy", project.id);
    if (stored) return validateDeployConfig(stored, project.name);
    try {
      const config = validateDeployConfig(
        JSON.parse(await fs.readFile(this.configFile(project), "utf8")),
        project.name,
      );
      this.store?.setSetting("deploy", project.id, config);
      return config;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return validateDeployConfig({}, project.name);
    }
  }
  async save(project, input) {
    const config = validateDeployConfig(input, project.name);
    if (this.store) {
      this.store.setSetting("deploy", project.id, config);
      return config;
    }
    await fs.mkdir(this.root, { recursive: true });
    const file = this.configFile(project);
    await fs.writeFile(file + ".tmp", JSON.stringify(config, null, 2));
    await fs.rename(file + ".tmp", file);
    return config;
  }
  async inspect(project) {
    const pkg = await readPackage(project);
    const deps = {
      ...(pkg?.dependencies || {}),
      ...(pkg?.devDependencies || {}),
    };
    const expo = Boolean(
      deps.expo || (await exists(path.join(project.path, "app.json"))),
    );
    const config = await this.config(project);
    return {
      config,
      projectType: expo ? "expo" : pkg ? "web" : "static",
      expo,
      buildScript: pkg?.scripts?.build || null,
      devScript: pkg?.scripts?.dev || null,
      easConfigured: await exists(path.join(project.path, "eas.json")),
      credentials: {
        cloudflare: Boolean(
          process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID,
        ),
        vercel: Boolean(process.env.VERCEL_TOKEN),
        expo: Boolean(process.env.EXPO_TOKEN),
        supabase: Boolean(
          process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY,
        ),
        firebase: Boolean(process.env.FIREBASE_TOKEN),
      },
      requirements: {
        web: [
          pkg?.scripts?.build
            ? `Build: npm run build (${pkg.scripts.build})`
            : "Situs statis: file publik akan disalin ke staging aman",
          config.hosting === "cloudflare"
            ? "Cloudflare API token + account ID"
            : "Vercel token atau sesi CLI",
        ],
        mobile: expo
          ? [
              "Proyek Expo/React Native terdeteksi",
              (await exists(path.join(project.path, "eas.json")))
                ? "eas.json tersedia"
                : "eas.json belum tersedia",
              "Akun Expo dan kredensial signing",
              "Akun developer Apple/Google untuk submit toko",
            ]
          : [
              "Proyek ini masih web",
              "Buat proyek Expo/React Native sebelum build iOS/Android",
              "Pindahkan UI dan fitur yang sesuai ke komponen native",
            ],
      },
    };
  }
  async security(project, target = "web") {
    if (!targets.has(target)) throw Error("Target deploy tidak valid.");
    const config = await this.config(project);
    return securityAudit(project, { target, hosting: config.hosting });
  }
  async requireSecurity(project, target, options = {}) {
    const config = await this.config(project);
    const result = await securityAudit(project, { target, hosting: config.hosting, ...options });
    this.emit("security-result", { projectId: project.id, result });
    if (!result.passed)
      throw Error(`Security Gate memblokir deploy: ${result.findings.filter((item) => item.blocking).length} temuan. Buka Deploy Center untuk memperbaikinya.`);
  }
  async stageStatic(project) {
    const dest = path.join(this.root, "artifacts", project.id, "web");
    await fs.rm(dest, { recursive: true, force: true });
    await fs.mkdir(dest, { recursive: true });
    const allowed = new Set([
      ".html",
      ".css",
      ".js",
      ".mjs",
      ".json",
      ".svg",
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".webp",
      ".ico",
      ".woff",
      ".woff2",
      ".ttf",
      ".map",
      ".txt",
      ".xml",
      ".wasm",
    ]);
    let count = 0;
    const walk = async (from, to, depth = 0) => {
      if (depth > 8 || count > 20000) return;
      for (const entry of await fs.readdir(from, { withFileTypes: true })) {
        if (
          privateName(entry.name) ||
          entry.name.startsWith(".") ||
          entry.isSymbolicLink() ||
          /^(package(-lock)?|credentials|google-services|service-account.*)\.json$/i.test(
            entry.name,
          )
        )
          continue;
        const source = path.join(from, entry.name);
        const target = path.join(to, entry.name);
        if (entry.isDirectory()) {
          await fs.mkdir(target, { recursive: true });
          await walk(source, target, depth + 1);
        } else if (allowed.has(path.extname(entry.name).toLowerCase())) {
          const stat = await fs.stat(source);
          if (stat.size <= 25 * 1024 * 1024) {
            await fs.copyFile(source, target);
            count++;
          }
        }
      }
    };
    await walk(project.path, dest);
    if (!(await exists(path.join(dest, "index.html"))))
      throw Error("Deploy web statis memerlukan index.html.");
    return dest;
  }
  async outputDirectory(project) {
    for (const name of ["dist", "build", "out", "public"]) {
      const dir = path.join(project.path, name);
      if ((await exists(dir)) && (await fs.stat(dir)).isDirectory()) return dir;
    }
    throw Error("Folder hasil build tidak ditemukan (dist/build/out/public).");
  }
  command(child, projectId, label) {
    return new Promise((resolve, reject) => {
      this.active.child = child;
      this.emit("deploy-log", { projectId, text: `\n$ ${label}\n` });
      let output = "";
      for (const stream of [child.stdout, child.stderr])
        stream.on("data", (chunk) => {
          output = (output + chunk.toString()).slice(-30000);
          this.emit("deploy-log", {
            projectId,
            text: chunk.toString().slice(0, 20000),
          });
        });
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0
          ? resolve(output)
          : reject(Error(`${label} gagal (kode ${code}).`)),
      );
    });
  }
  spawn(project, executable, args, label, extraEnv = {}) {
    const child = spawn(executable, args, {
      cwd: project.path,
      env: { ...process.env, ...extraEnv, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    return this.command(child, project.id, label);
  }
  recordRelease(projectId, details) {
    try { this.releases.record(projectId, details); }
    catch { this.emit("runtime-warning", { message: "Riwayat rilis gagal disimpan; periksa database Forge." }); }
  }
  run(project, target, operation = "build") {
    if (!targets.has(target)) throw Error("Target deploy tidak valid.");
    if (!new Set(["build", "submit"]).has(operation))
      throw Error("Operasi deploy tidak valid.");
    if (this.active) throw Error("Deploy lain masih berjalan.");
    this.active = { projectId: project.id, target, operation, child: null };
    this.emit("deploy-started", { projectId: project.id, target, operation });
    void this.execute(project, target, operation)
      .then(({ config, url }) => {
        this.recordRelease(project.id, {
          provider: target === "web" ? config.hosting : "expo",
          projectName: config.projectName, environment: target === "web" ? config.environment : config.mobileProfile,
          target, operation, status: "success", url: url || null,
        });
        this.emit("deploy-completed", {
          projectId: project.id,
          target,
          operation,
          ok: true,
        });
      })
      .catch(async (error) => {
        const config = await this.config(project).catch(() => null);
        if (config) this.recordRelease(project.id, {
          provider: target === "web" ? config.hosting : "expo",
          projectName: config.projectName, environment: target === "web" ? config.environment : config.mobileProfile,
          target, operation, status: "failed", url: null,
        });
        this.emit("deploy-completed", {
          projectId: project.id,
          target,
          operation,
          ok: false,
          error: error.message,
        });
      })
      .finally(() => {
        this.active = null;
      });
    return { started: true, target, operation };
  }
  async execute(project, target, operation) {
    await this.requireSecurity(project, target);
    const config = await this.config(project);
    const info = await this.inspect(project);
    if (target === "web") {
      if (info.buildScript)
        await this.spawn(project, "npm", ["run", "build"], "npm run build");
      const output = info.buildScript
        ? await this.outputDirectory(project)
        : await this.stageStatic(project);
      await this.requireSecurity(project, target, { directory: output, artifact: true });
      if (config.hosting === "cloudflare") {
        const args = [
          "--yes",
          "wrangler@latest",
          "pages",
          "deploy",
          output,
          "--project-name",
          config.projectName,
        ];
        if (config.environment === "preview")
          args.push("--branch=forge-preview");
        const outputText = await this.spawn(
          project,
          "npx",
          args,
          `Cloudflare Pages · ${config.environment}`,
        );
        return { config, url: releaseUrl(outputText, "cloudflare") };
      } else {
        const args = ["--yes", "vercel@latest", "--yes"];
        if (config.environment === "production") args.push("--prod");
        const outputText = await this.spawn(
          project,
          "npx",
          args,
          `Vercel · ${config.environment}`,
          process.env.VERCEL_TOKEN
            ? { VERCEL_TOKEN: process.env.VERCEL_TOKEN }
            : {},
        );
        return { config, url: releaseUrl(outputText, "vercel") };
      }
    }
    if (!info.expo)
      throw Error(
        "Proyek belum Expo/React Native. Gunakan Siapkan dengan Agent.",
      );
    if (!info.easConfigured)
      throw Error(
        "eas.json belum ada. Jalankan persiapan Expo terlebih dahulu.",
      );
    const platform = target === "ios" ? "ios" : "android";
    const args = ["--yes", "eas-cli@latest"];
    if (operation === "submit")
      args.push(
        "submit",
        "--platform",
        platform,
        "--profile",
        config.mobileProfile,
        "--non-interactive",
      );
    else
      args.push(
        "build",
        "--platform",
        platform,
        "--profile",
        config.mobileProfile,
        "--non-interactive",
      );
    await this.spawn(
      project,
      "npx",
      args,
      `EAS ${operation} · ${platform}`,
      process.env.EXPO_TOKEN ? { EXPO_TOKEN: process.env.EXPO_TOKEN } : {},
    );
    return { config, url: null };
  }
  async releaseHistory(project, target = "web") {
    if (!targets.has(target)) throw Error("Target tidak valid.");
    if (target !== "web") return {
      online: false, note: "Riwayat build lokal; rilis App Store/Play Store tidak dapat di-rollback dari Forge.",
      entries: this.releases.local(project.id).filter((entry) => entry.target === target),
    };
    return this.releases.list(project.id, await this.config(project));
  }
  async rollback(project, id) {
    if (this.active) throw Error("Tunggu deploy selesai sebelum rollback.");
    const config = await this.config(project);
    const release = await this.releases.verify(config, id);
    if (this.active) throw Error("Deploy lain dimulai saat memeriksa rilis.");
    this.active = { projectId: project.id, target: "web", operation: "rollback", child: null };
    this.emit("deploy-started", { projectId: project.id, target: "web", operation: "rollback" });
    void (async () => {
      if (config.hosting === "cloudflare")
        await this.releases.rollbackCloudflare(config, release.id);
      else
        await this.spawn(project, "npx", ["--yes", "vercel@latest", "rollback", release.id, "--project", config.projectName, "--yes", "--timeout", "60s"], "Vercel · rollback", process.env.VERCEL_TOKEN ? { VERCEL_TOKEN: process.env.VERCEL_TOKEN } : {});
      this.recordRelease(project.id, {
        provider: config.hosting, projectName: config.projectName, environment: "production",
        target: "web", operation: "rollback", status: "success", rollbackOf: release.id, url: release.url,
      });
      this.emit("deploy-completed", { projectId: project.id, target: "web", operation: "rollback", ok: true });
    })().catch((error) => {
      this.emit("deploy-completed", { projectId: project.id, target: "web", operation: "rollback", ok: false, error: error.message });
    }).finally(() => { this.active = null; });
    return { started: true, target: "web", operation: "rollback" };
  }
  stop(projectId) {
    if (!this.active || this.active.projectId !== projectId)
      throw Error("Tidak ada deploy aktif untuk proyek ini.");
    const child = this.active.child;
    if (this.active.operation === "rollback" && !child)
      throw Error("Rollback online sudah dimulai dan tidak dapat dihentikan.");
    if (child) {
      if (process.platform === "win32") child.kill();
      else process.kill(-child.pid, "SIGTERM");
    }
    return { ok: true };
  }
}
