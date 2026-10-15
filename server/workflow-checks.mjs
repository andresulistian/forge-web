import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const SCRIPT_NAMES = ["lint", "test", "build"];
const ENV_KEYS = ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TMP", "TEMP", "SystemRoot", "ComSpec", "PATHEXT", "LANG", "LC_ALL"];
export function checkEnvironment(source = process.env) {
  const env = { CI: "1", FORCE_COLOR: "0" };
  for (const key of ENV_KEYS) if (typeof source[key] === "string") env[key] = source[key];
  return env;
}
export function redactCheckOutput(value) {
  return String(value || "")
    .replace(/-----BEGIN [^-]*(?:PRIVATE KEY|CERTIFICATE)-----[\s\S]*?-----END [^-]+-----/g, "[redacted key/certificate]")
    .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{12,}/g, "[redacted token]")
    .replace(/((?:api[_ -]?key|token|password|secret|credential)\s*[=:]\s*)[^\s,;]+/gi, "$1[redacted]")
    .slice(-6000);
}
function runScript(cwd, name, signal, timeoutMs) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve({ name, ok: false, cancelled: true, output: "Dihentikan." });
    let settled = false;
    let output = "";
    let timedOut = false;
    const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", name], {
      cwd, env: checkEnvironment(), shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
    });
    const kill = () => { try { if (process.platform === "win32") child.kill(); else process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", kill);
      resolve({ name, ...result, output: redactCheckOutput(result.output || output) });
    };
    signal?.addEventListener("abort", kill, { once: true });
    if (signal?.aborted) kill();
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output = (output + chunk.toString()).slice(-20000); });
    child.once("error", (error) => finish({ ok: false, output: error.message }));
    child.once("close", (exitCode, exitSignal) => finish({ ok: exitCode === 0 && !timedOut && !signal?.aborted, exitCode, exitSignal, timedOut, cancelled: !!signal?.aborted }));
  });
}
async function approvedOrAborted(approve, request, signal) {
  if (signal?.aborted) return false;
  let cancel;
  const aborted = new Promise((resolve) => { cancel = () => resolve(false); signal?.addEventListener("abort", cancel, { once: true }); });
  try { return await Promise.race([Promise.resolve().then(() => approve(request)), aborted]) === true; }
  finally { signal?.removeEventListener("abort", cancel); }
}

/** Execute only declared scripts after explicit approval. No installs, deploys or API calls. */
export async function runProjectChecks(project, { approve, signal, timeoutMs = 180000 } = {}) {
  if (typeof approve !== "function") throw Error("Pengujian memerlukan handler persetujuan.");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 180000) throw Error("Timeout pengujian tidak valid.");
  const manifest = path.join(project.path, "package.json");
  let raw;
  let scripts;
  try {
    const stat = await fs.lstat(manifest);
    if (!stat.isFile() || stat.size > 1000000) throw Error("package.json harus berupa file biasa maksimal 1 MB.");
    raw = await fs.readFile(manifest, "utf8");
    scripts = JSON.parse(raw).scripts || {};
  } catch (error) { return { ok: false, blocked: true, results: [{ name: "manifest", ok: false, output: error.message }] }; }
  if (typeof scripts.test !== "string" || !scripts.test.trim())
    return { ok: false, blocked: true, results: [{ name: "test", ok: false, output: "Script npm test belum tersedia. Tambahkan pengujian; lint/build saja bukan bukti penerimaan." }] };
  const names = SCRIPT_NAMES.filter((name) => typeof scripts[name] === "string" && scripts[name].trim());
  const accepted = await approvedOrAborted(approve, {
    command: names.map((name) => `npm run ${name}`).join(" && "),
    reason: `Jalankan pemeriksaan proyek ini? Script proyek mengeksekusi kode lokal, bukan sandbox OS.\n${names.map((name) => `${name}: ${scripts[name]}`).join("\n")}`,
  }, signal);
  if (!accepted || signal?.aborted)
    return { ok: false, blocked: true, results: [{ name: "approval", ok: false, output: "Pengujian tidak disetujui atau dihentikan." }] };
  if (await fs.readFile(manifest, "utf8") !== raw)
    return { ok: false, blocked: true, results: [{ name: "manifest", ok: false, output: "package.json berubah sesudah persetujuan. Minta persetujuan ulang." }] };
  const results = [];
  for (const name of names) {
    if (await fs.readFile(manifest, "utf8") !== raw)
      return { ok: false, blocked: true, results: [...results, { name: "manifest", ok: false, output: "package.json berubah selama pengujian." }] };
    const result = await runScript(project.path, name, signal, timeoutMs);
    results.push(result);
    if (!result.ok) break;
  }
  if (await fs.readFile(manifest, "utf8") !== raw)
    return { ok: false, blocked: true, results: [...results, { name: "manifest", ok: false, output: "package.json berubah selama pengujian." }] };
  return { ok: results.length === names.length && results.every((item) => item.ok), blocked: results.some((item) => item.cancelled || item.timedOut), results };
}
