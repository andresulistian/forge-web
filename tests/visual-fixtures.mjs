import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export async function isolatedForge(t) {
  const scratch =
    process.env.FORGE_TEST_ROOT ||
    path.join(os.homedir(), ".hermes", "cache", "scratch");
  await fs.mkdir(scratch, { recursive: true });
  const root = await fs.mkdtemp(path.join(scratch, "forge-visual-api-"));
  let child,
    connection,
    stderr = "";
  const start = async () => {
    child = spawn(process.execPath, ["server/index.mjs"], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: {
        FORGE_CODEX_BIN: fileURLToPath(
          new URL("./fixtures/visual-codex.mjs", import.meta.url),
        ),
        PATH: process.env.PATH,
        HOME: root,
        TMPDIR: root,
        FORGE_DATA_DIR: path.join(root, "data"),
        FORGE_PROJECTS_DIR: path.join(root, "projects"),
        FORGE_BACKUP_DIR: path.join(root, "backups"),
        FORGE_PORT: "0",
        FORGE_DESKTOP: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr.on("data", (data) => {
      stderr = (stderr + data).slice(-4000);
    });
    connection = await new Promise((resolve, reject) => {
      createInterface({ input: child.stdout }).once("line", (line) =>
        resolve(JSON.parse(line)),
      );
      child.once("error", reject);
      child.once("exit", (code) => reject(Error(`Exit ${code}: ${stderr}`)));
    });
    return connection;
  };
  const stop = async () => {
    if (child?.exitCode === null) {
      const exited = new Promise((r) => child.once("exit", r));
      child.kill();
      await exited;
    }
  };
  await start();
  t.after(stop);
  const request = (route, body, auth = true) =>
    fetch(connection.url + "/api/" + route, {
      method: body ? "POST" : "GET",
      headers: {
        ...(auth ? { Authorization: "Bearer " + connection.token } : {}),
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  const json = async (route, body) => {
    const response = await request(route, body);
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    return data;
  };
  return {
    root,
    request,
    json,
    start,
    stop,
    get connection() {
      return connection;
    },
  };
}

export async function fixturePreview(forge) {
  const project = await forge.json("projects/create", {
    name: "Visual fixture",
  });
  await fs.writeFile(
    path.join(project.path, "package.json"),
    JSON.stringify({ type: "module", scripts: { dev: "node fixture.mjs" } }),
  );
  await fs.writeFile(
    path.join(project.path, "fixture.mjs"),
    `import http from 'node:http'; import fs from 'node:fs/promises'; http.createServer(async (_q,r)=>{r.setHeader('Content-Type','text/html');r.end(await fs.readFile(new URL('./page.html',import.meta.url),'utf8'));}).listen(Number(process.env.PORT),'127.0.0.1');`,
  );
  await fs.writeFile(
    path.join(project.path, "page.html"),
    '<html><head><meta name="viewport" content="width=device-width"></head><body><h1>Before</h1><button>Edit me</button><input type="password" value="PRIVATE_VALUE"><div style="width:1600px">Overflow</div></body></html>',
  );
  await forge.json("preview/start", { projectId: project.id, confirmed: true });
  return project;
}
