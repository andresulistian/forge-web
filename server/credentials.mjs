import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { sanitizeEnv } from "./env.mjs";

const run = promisify(execFile);

export class CredentialStore {
  constructor({
    platform = process.platform,
    exec = run,
    spawnImpl = spawn,
  } = {}) {
    this.platform = platform;
    this.exec = exec;
    this.spawn = spawnImpl;
  }

  service(key) {
    return `forge-web:${key}`;
  }

  async set(key, value) {
    if (!value) return;
    if (this.platform === "darwin") {
      await this.exec("security", [
        "add-generic-password",
        "-a",
        "Forge Web",
        "-s",
        this.service(key),
        "-w",
        value,
        "-U",
      ]);
      return;
    }
    if (this.platform === "linux") {
      await new Promise((resolve, reject) => {
        const child = this.spawn(
          "secret-tool",
          [
            "store",
            "--label=Forge Web",
            "service",
            "forge-web",
            "account",
            key,
          ],
          { stdio: ["pipe", "ignore", "pipe"], env: sanitizeEnv() },
        );
        let diagnostic = "";
        child.stderr.on("data", (chunk) => {
          diagnostic = (diagnostic + chunk).slice(-300);
        });
        child.on("error", (error) =>
          reject(
            Error(
              `secret-tool tidak tersedia: ${error.message}. Instal paket libsecret.`,
            ),
          ),
        );
        child.on("close", (code) =>
          code === 0
            ? resolve()
            : reject(
                Error(
                  `Keyring Linux tidak dapat menyimpan API key. Pastikan Secret Service aktif dan terbuka. ${diagnostic}`,
                ),
              ),
        );
        child.stdin.on("error", () => {});
        child.stdin.end(value);
      });
      return;
    }
    throw Error("Penyimpanan credential aman belum tersedia di sistem ini.");
  }

  async get(key) {
    if (this.platform === "darwin") {
      try {
        const { stdout } = await this.exec("security", [
          "find-generic-password",
          "-a",
          "Forge Web",
          "-s",
          this.service(key),
          "-w",
        ]);
        return stdout.trim();
      } catch {
        return "";
      }
    }
    if (this.platform === "linux") {
      try {
        const { stdout } = await this.exec("secret-tool", [
          "lookup",
          "service",
          "forge-web",
          "account",
          key,
        ]);
        return stdout.trim();
      } catch {
        return "";
      }
    }
    return "";
  }

  async delete(key) {
    if (this.platform === "linux") {
      try {
        await this.exec("secret-tool", [
          "clear",
          "service",
          "forge-web",
          "account",
          key,
        ]);
      } catch {
        /* Missing credentials are already deleted. */
      }
      return;
    }
    if (this.platform !== "darwin") return;
    try {
      await this.exec("security", [
        "delete-generic-password",
        "-a",
        "Forge Web",
        "-s",
        this.service(key),
      ]);
    } catch {
      /* Missing credentials are already deleted. */
    }
  }
}

export class MemoryCredentialStore {
  constructor() {
    this.values = new Map();
  }
  async set(key, value) {
    if (value) this.values.set(key, value);
  }
  async get(key) {
    return this.values.get(key) || "";
  }
  async delete(key) {
    this.values.delete(key);
  }
}
