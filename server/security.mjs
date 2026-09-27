import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { privateName } from "./workspace.mjs";
import { sanitizeEnv } from "./env.mjs";

const ignored = new Set([
  "node_modules",
  ".git",
  ".forge",
  ".next",
  ".expo",
  "coverage",
  "vendor",
]);
const generated = new Set(["dist", "build", "out"]);
const textExtensions = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".json",
  ".html",
  ".css",
  ".map",
  ".py",
  ".sh",
  ".yaml",
  ".yml",
  ".toml",
  ".vue",
  ".svelte",
]);
const patterns = [
  [
    "private-key",
    "Private key",
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  ],
  [
    "github-token",
    "GitHub token",
    /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/,
  ],
  [
    "openai-key",
    "OpenAI API key",
    /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{25,}\b/,
  ],
  ["aws-key", "AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  [
    "hardcoded-secret",
    "Kredensial hardcoded",
    /\b(?:api[_-]?key|secret[_-]?key|client[_-]?secret|password|auth[_-]?token)\b\s*[=:]\s*["'`]([^"'`\s]{12,})["'`]/i,
  ],
];

function issue(severity, code, file, message, fix) {
  return {
    severity,
    code,
    file,
    message,
    fix,
    blocking: severity !== "warning",
  };
}

export async function scanFiles(
  root,
  { artifact = false, uploadsSource = false } = {},
) {
  const findings = [];
  let count = 0;
  const walk = async (dir, depth = 0) => {
    if (depth > 14) {
      findings.push(
        issue(
          "error",
          "scan-limit",
          path.relative(root, dir),
          "Folder terlalu dalam untuk diperiksa.",
          "Kurangi kedalaman folder proyek.",
        ),
      );
      return;
    }
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full);
      if (entry.isSymbolicLink()) {
        findings.push(
          issue(
            "high",
            "symlink",
            relative,
            "Tautan simbolik tidak bisa dipastikan aman untuk dikirim.",
            "Hapus tautan dari paket deploy atau ganti dengan file yang benar-benar dibutuhkan.",
          ),
        );
        continue;
      }
      if (entry.isDirectory()) {
        if (!artifact && generated.has(entry.name)) continue;
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (++count > 20000) {
        findings.push(
          issue(
            "error",
            "scan-limit",
            relative,
            "Terlalu banyak file untuk diperiksa.",
            "Pisahkan folder yang tidak diperlukan untuk deploy.",
          ),
        );
        return;
      }
      const environmentFile =
        /^\.env(?:\.|$)/i.test(entry.name) && !/\.example$/i.test(entry.name);
      const credentialFile =
        /^(?:credentials|service-account.*|google-services)\.json$/i.test(
          entry.name,
        ) ||
        /\.(?:pem|key|p12|pfx|keystore|jks)$/i.test(entry.name) ||
        /^\.(npmrc|yarnrc|pypirc|netrc|git-credentials|pgpass)$/.test(
          entry.name,
        ) ||
        /^(id_rsa|id_ecdsa|id_ed25519|id_dsa|known_hosts|authorized_keys)$/.test(
          entry.name,
        );
      if (privateName(entry.name) || environmentFile || credentialFile) {
        const exposure = artifact || uploadsSource;
        findings.push(
          issue(
            exposure ? "critical" : "warning",
            "sensitive-file",
            relative,
            exposure
              ? "File kredensial dapat ikut terkirim saat deploy."
              : "File sensitif lokal terdeteksi; pastikan tidak masuk hasil build.",
            "Pindahkan kredensial ke environment variable layanan dan keluarkan file dari paket deploy.",
          ),
        );
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!textExtensions.has(ext) && !/^\.env(?:\.|$)/i.test(entry.name))
        continue;
      const stat = await fs.stat(full);
      if (stat.size > 10 * 1024 * 1024) {
        findings.push(
          issue(
            "error",
            "scan-limit",
            relative,
            "File teks terlalu besar untuk diperiksa menyeluruh.",
            "Pisahkan atau kecilkan file ini, lalu pindai ulang.",
          ),
        );
        continue;
      }
      const contents = await fs.readFile(full, "utf8");
      for (const [code, label, regex] of patterns) {
        if (regex.test(contents))
          findings.push(
            issue(
              "critical",
              code,
              relative,
              `${label} terdeteksi; nilainya tidak ditampilkan.`,
              "Hapus nilai dari source, pindahkan ke environment variable, dan rotasi kredensial yang terpapar.",
            ),
          );
      }
    }
  };
  await walk(root);
  return findings;
}

export async function auditDependencies(root) {
  let pkg;
  try {
    pkg = JSON.parse(
      await fs.readFile(path.join(root, "package.json"), "utf8"),
    );
  } catch (error) {
    if (error.code === "ENOENT") return [];
    return [
      issue(
        "error",
        "invalid-package",
        "package.json",
        "package.json tidak dapat dibaca.",
        "Perbaiki format JSON package.json.",
      ),
    ];
  }
  if (!Object.keys(pkg.dependencies || {}).length) return [];
  try {
    await fs.access(path.join(root, "package-lock.json"));
  } catch {
    return [
      issue(
        "error",
        "missing-lock",
        "package.json",
        "Dependensi belum memiliki package-lock.json untuk diaudit.",
        "Jalankan npm install --package-lock-only dan pindai ulang.",
      ),
    ];
  }

  const output = await new Promise((resolve) => {
    const child = spawn("npm", ["audit", "--json", "--omit=dev", "--package-lock-only", "--ignore-scripts"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: sanitizeEnv(),
    });
    let data = "";
    let stopped = false;
    const timer = setTimeout(() => {
      stopped = true;
      child.kill();
    }, 20000);
    child.stdout.on("data", (chunk) => {
      data += chunk.toString();
      if (data.length > 4_000_000) {
        stopped = true;
        child.kill();
      }
    });
    child.stderr.on("data", () => {}); // Never return registry credentials or raw errors.
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(stopped ? null : data);
    });
  });
  try {
    const result = JSON.parse(output);
    if (result.error || !result.metadata?.vulnerabilities)
      throw Error("audit failed");
    return Object.entries(result.vulnerabilities || {})
      .filter(([, value]) => ["high", "critical"].includes(value.severity))
      .map(([name, value]) =>
        issue(
          value.severity,
          "dependency",
          "package-lock.json",
          `Dependensi ${name.slice(0, 100)} memiliki kerentanan ${value.severity}.`,
          "Periksa npm audit, perbarui dependensi dengan Agent, jalankan tes, lalu pindai ulang.",
        ),
      );
  } catch {
    return [
      issue(
        "error",
        "audit-unavailable",
        "package-lock.json",
        "Audit npm tidak selesai atau registry tidak dapat dihubungi.",
        "Periksa koneksi npm registry, lalu pindai ulang.",
      ),
    ];
  }
}

export async function securityAudit(
  project,
  { target = "web", hosting = "cloudflare", directory, artifact = false, uploadsSource } = {},
) {
  const findings = await scanFiles(directory || project.path, {
    artifact,
    uploadsSource: uploadsSource ?? (!artifact && (target !== "web" || hosting === "vercel")),
  });
  if (!artifact) findings.push(...(await auditDependencies(project.path)));
  return {
    passed: !findings.some((item) => item.blocking),
    findings,
    checkedAt: new Date().toISOString(),
  };
}
