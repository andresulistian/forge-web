import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

test(
  "design API requires auth, validates project/input, persists and exposes selective catalog",
  { timeout: 30000 },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "forge-design-http-"));
    const child = spawn(process.execPath, ["server/index.mjs"], {
      env: {
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
    t.after(async () => {
      if (child.exitCode === null) {
        child.kill();
        await new Promise((r) => child.once("exit", r));
      }
      await fs.rm(root, { recursive: true, force: true });
    });
    const { url, token } = await new Promise((resolve, reject) => {
      createInterface({ input: child.stdout }).once("line", (l) =>
        resolve(JSON.parse(l)),
      );
      child.once("error", reject);
      child.once("exit", (code) => reject(Error(`Backend exited ${code}`)));
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-6000);
    });
    const request = async (route, body, auth = true) => {
      try {
        return await fetch(url + "/api/" + route, {
          method: body ? "POST" : "GET",
          headers: {
            ...(auth ? { Authorization: "Bearer " + token } : {}),
            "Content-Type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (error) {
        throw Error(
          `${route}: ${error.message}; child exit=${child.exitCode}; ${stderr}`,
        );
      }
    };
    assert.equal(
      (await request("design-identity", undefined, false)).status,
      401,
    );
    const project = await (
      await request("projects/create", { name: "Design HTTP" })
    ).json();
    const get = await request("design-identity?projectId=" + project.id);
    assert.equal(get.status, 200, "design identity endpoint must exist");
    const initial = await get.json();
    const identity = {
      direction: "Calm utilitarian",
      audience: "Operators",
      product: "Console",
      constraints: "Keep logo",
      decisions: "Dense table",
      references: [],
      tokens: {
        colors: {},
        typography: {},
        spacing: {},
        radius: {},
        shadows: {},
      },
    };
    const saved = await request("design-identity/save", {
      projectId: project.id,
      identity,
      expected: initial.revision,
    });
    assert.equal(saved.status, 200);
    const value = await saved.json();
    assert.equal(
      (await (await request("design-identity?projectId=" + project.id)).json())
        .revision,
      value.revision,
    );
    assert.equal(
      (
        await request("design-identity/save", {
          projectId: project.id,
          identity,
          expected: initial.revision,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request("design-identity/save", {
          projectId: project.id,
          identity: { ...identity, direction: [] },
          expected: value.revision,
        })
      ).status,
      400,
    );
    assert.equal(
      (await request("design-identity?projectId=missing")).status,
      400,
    );
    assert.equal((await request("design-identity")).status, 400);
    const center = await (
      await request("agent-center?projectId=" + project.id)
    ).json();
    assert.equal(
      center.skills.filter((s) =>
        [
          "/design",
          "/design-system",
          "/polish",
          "/design-review",
          "/responsive",
        ].includes(s.command),
      ).length,
      5,
    );
    assert.ok(center.skills.every((s) => !Object.hasOwn(s, "prompt")));
    const source = await fs.readFile(
      new URL("../server/index.mjs", import.meta.url),
      "utf8",
    );
    assert.match(source, /prepareAgentContext\(/);
    assert.match(source, /enrichedText = preparedContext.text/);
  },
);
