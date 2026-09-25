import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(process.execPath, ["--env-file-if-exists=.env", "server/index.mjs"], {
  cwd: root,
  env: { ...process.env, FORGE_DESKTOP: "1" },
  stdio: ["inherit", "pipe", "inherit"],
});
let buffer = "";
let opened = false;
function handleLine(line) {
  if (opened) { if (line) process.stdout.write(line + "\n"); return; }
  try {
    const { url, token } = JSON.parse(line);
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(url) || !/^[a-f0-9]{64}$/.test(token)) throw Error("Unexpected startup response");
    const address = `${url}/#token=${token}`;
    opened = true;
    const browser = spawn("xdg-open", [address], { detached: true, stdio: "ignore" });
    browser.on("error", () => console.log(`Buka alamat ini di browser: ${address}`));
    browser.unref();
    console.log("Forge berjalan. Tutup terminal ini untuk menghentikan Forge.");
  } catch {
    if (line) process.stdout.write(line + "\n");
  }
}
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) !== -1) {
    handleLine(buffer.slice(0, newline));
    buffer = buffer.slice(newline + 1);
  }
});
child.stdout.on("end", () => { if (buffer) handleLine(buffer); });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code || 0; });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
