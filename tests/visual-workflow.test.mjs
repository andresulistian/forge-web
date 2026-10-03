import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { isolatedForge, fixturePreview } from "./visual-fixtures.mjs";

test(
  "authenticated real capture persists exact baseline and bounded DOM, isolates projects, rejects stale targets",
  { timeout: 90000 },
  async (t) => {
    const forge = await isolatedForge(t);
    const p = await fixturePreview(forge);
    const q = await forge.json("projects/create", { name: "Other" });
    const response = await forge.request("visual/capture", {
      projectId: p.id,
      kind: "baseline",
      viewport: "mobile",
      path: "/",
    });
    assert.equal(
      response.status,
      200,
      "real capture API must be available: " + (await response.clone().text()),
    );
    const baseline = await response.json();
    assert.equal(baseline.kind, "baseline");
    assert.ok(baseline.checkpointId);
    assert.equal(baseline.runId, null);
    assert.equal(baseline.viewport.width, 390);
    assert.ok(baseline.measurements.horizontalOverflow > 0);
    const image = await forge.request(
      `visual/image?projectId=${p.id}&id=${baseline.id}`,
    );
    const png = Buffer.from(await image.arrayBuffer());
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.equal(
      (
        await forge.request(
          `visual/image?projectId=${p.id}&id=${baseline.id}`,
          undefined,
          false,
        )
      ).status,
      401,
    );
    assert.equal(
      (await forge.request(`visual/image?projectId=${q.id}&id=${baseline.id}`))
        .status,
      400,
    );
    const state = await forge.json(`visual?projectId=${p.id}`);
    assert.equal(state.captures[0].id, baseline.id);
    const target = await forge.json("visual/target", {
      projectId: p.id,
      captureId: baseline.id,
      index: baseline.elements.findIndex((e) => e.tag === "button"),
    });
    assert.equal(target.element.text, "Edit me");
    assert.equal(target.element.source, null);
    assert.ok(!JSON.stringify(target).includes("PRIVATE_VALUE"));
    await fs.writeFile(path.join(p.path, "page.html"), "<h1>After</h1>");
    assert.equal(
      (
        await forge.request("visual/target", {
          projectId: p.id,
          captureId: baseline.id,
          index: 0,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await forge.request("visual/capture", {
          projectId: p.id,
          kind: "after",
          runId: "wrong",
          checkpointId: baseline.checkpointId,
          viewport: "mobile",
          path: "/",
        })
      ).status,
      400,
    );
    for (const bad of [
      "//example.com",
      "/\\example.com",
      "http://example.com",
      "/\n",
    ]) {
      assert.equal(
        (
          await forge.request("visual/capture", {
            projectId: p.id,
            kind: "snapshot",
            viewport: "mobile",
            path: bad,
          })
        ).status,
        400,
      );
    }
    await forge.stop();
    await forge.start();
    assert.equal(
      (await forge.json(`visual?projectId=${p.id}`)).captures[0].id,
      baseline.id,
    );
    assert.equal(
      (
        await forge.request("visual/capture", {
          projectId: p.id,
          kind: "snapshot",
          viewport: "desktop",
          path: "/",
        })
      ).status,
      400,
    );
  },
);

test(
  "manual baseline binds its exact checkpoint to next Build; PNG rejects linked artifacts",
  { timeout: 60000 },
  async (t) => {
    const forge = await isolatedForge(t);
    const p = await fixturePreview(forge);
    const baseline = await forge.json("visual/capture", {
      projectId: p.id,
      kind: "baseline",
      viewport: "mobile",
      path: "/",
    });
    await forge.json("visual/baseline", {
      projectId: p.id,
      captureId: baseline.id,
    });
    await forge.json("chat", {
      projectId: p.id,
      text: "Manual baseline Build",
      mode: "build",
      provider: "codex",
      model: "fixture-vision",
      webMode: "off",
    });
    let state;
    const end = Date.now() + 20000;
    do {
      state = await forge.json(`visual?projectId=${p.id}`);
      if (state.captures.some((c) => c.kind === "after")) break;
      await new Promise((r) => setTimeout(r, 100));
    } while (Date.now() < end);
    const before = state.captures.find((c) => c.id === baseline.id);
    const after = state.captures.find((c) => c.kind === "after");
    assert.ok(after, state.lastError);
    assert.equal(after.checkpointId, baseline.checkpointId);
    assert.equal(before.runId, after.runId);
    const file = path.join(
      forge.root,
      "data",
      "visual-captures",
      p.id,
      baseline.id + ".png",
    );
    const moved = file + ".original";
    await fs.rename(file, moved);
    await fs.symlink(moved, file);
    assert.equal(
      (await forge.request(`visual/image?projectId=${p.id}&id=${baseline.id}`))
        .status,
      400,
    );
    await fs.unlink(file);
    await fs.link(moved, file);
    assert.equal(
      (await forge.request(`visual/image?projectId=${p.id}&id=${baseline.id}`))
        .status,
      400,
    );
    assert.equal(
      (await forge.request(`visual/image?projectId=${p.id}&id=../../outside`))
        .status,
      400,
    );
  },
);

test(
  "missing preview does not falsely fail completed Build or fabricate captures",
  { timeout: 30000 },
  async (t) => {
    const forge = await isolatedForge(t);
    const p = await forge.json("projects/create", { name: "No preview" });
    await forge.json("visual/options", {
      projectId: p.id,
      auto: true,
      path: "/",
      viewport: "desktop",
    });
    await forge.json("chat", {
      projectId: p.id,
      text: "Build without preview",
      mode: "build",
      provider: "codex",
      model: "fixture-vision",
      webMode: "off",
    });
    let state;
    const end = Date.now() + 10000;
    do {
      state = await forge.json(`visual?projectId=${p.id}`);
      if (state.run.status === "completed") break;
      await new Promise((r) => setTimeout(r, 100));
    } while (Date.now() < end);
    assert.equal(state.run.status, "completed");
    assert.equal(state.captures.length, 0);
    assert.match(state.lastError, /Preview/);
    assert.equal(state.run.buildStatus, "not-run");
  },
);

test(
  "AI review requires consent, rejects unsupported vision, and sends actual selected PNG to provider pipeline",
  { timeout: 45000 },
  async (t) => {
    const forge = await isolatedForge(t);
    const p = await fixturePreview(forge);
    const capture = await forge.json("visual/capture", {
      projectId: p.id,
      kind: "snapshot",
      viewport: "mobile",
      path: "/",
    });
    const body = {
      projectId: p.id,
      captureId: capture.id,
      provider: "codex",
      model: "fixture-vision",
    };
    assert.equal(
      (await forge.request("visual/review", body)).status,
      400,
      "image upload must require explicit consent",
    );
    assert.equal(
      (
        await forge.request("visual/review", {
          ...body,
          confirmed: true,
          model: "fixture-text",
        })
      ).status,
      400,
    );
    const result = await forge.request("visual/review", {
      ...body,
      confirmed: true,
    });
    assert.equal(result.status, 200, await result.clone().text());
    const input = JSON.parse(
      await fs.readFile(
        path.join(forge.root, "fixture-last-input.json"),
        "utf8",
      ),
    );
    const image = input.find((i) => i.type === "image");
    assert.ok(image, "provider receives image content, not just a prompt");
    const png = Buffer.from(
      await (
        await forge.request(`visual/image?projectId=${p.id}&id=${capture.id}`)
      ).arrayBuffer(),
    );
    assert.ok(JSON.stringify(image).includes(png.toString("base64")));
    await new Promise((r) => setTimeout(r, 400));
    const state = await forge.json(`visual?projectId=${p.id}`);
    assert.equal(state.captures[0].aiReview, "reviewed");
    assert.equal(
      state.run,
      null,
      "AI review must not replace Build checkpoint run",
    );
  },
);

test(
  "Build opt-in captures before edits and after same run; review is run-bound with safe Undo",
  { timeout: 90000 },
  async (t) => {
    const forge = await isolatedForge(t);
    const p = await fixturePreview(forge);
    await forge.json("visual/options", {
      projectId: p.id,
      auto: true,
      viewport: "desktop",
      path: "/",
    });
    await forge.json("chat", {
      projectId: p.id,
      text: "Build fixture",
      mode: "build",
      provider: "codex",
      model: "fixture-vision",
      webMode: "off",
      attachments: [],
    });
    let state = await forge.json(`visual?projectId=${p.id}`);
    assert.ok(
      state.captures.some((c) => c.kind === "baseline"),
      "Build must capture baseline before provider edits",
    );
    const deadline = Date.now() + 20000;
    while (
      Date.now() < deadline &&
      !state.captures.some((c) => c.kind === "after")
    ) {
      await new Promise((r) => setTimeout(r, 150));
      state = await forge.json(`visual?projectId=${p.id}`);
    }
    assert.equal(state.run.status, "completed");
    const before = state.captures.find((c) => c.kind === "baseline");
    const after = state.captures.find((c) => c.kind === "after");
    assert.ok(after, JSON.stringify(state.lastError));
    assert.equal(before.runId, after.runId);
    assert.equal(before.checkpointId, after.checkpointId);
    assert.equal(before.viewport.name, after.viewport.name);
    assert.equal(before.path, after.path);
    assert.notEqual(before.sha256, after.sha256);
    assert.ok(before.elements.some((e) => e.text === "Before"));
    assert.ok(after.elements.some((e) => e.text === "After fixture Build"));
    assert.equal(state.run.buildStatus, "not-run");
    assert.equal(
      (
        await forge.request("review/accept", {
          projectId: p.id,
          runId: "stale",
          checkpointId: before.checkpointId,
        })
      ).status,
      400,
    );
    await forge.json("review/accept", {
      projectId: p.id,
      runId: state.run.id,
      checkpointId: before.checkpointId,
    });
    assert.equal(
      (await forge.json(`visual?projectId=${p.id}`)).run.reviewStatus,
      "accepted",
    );
    await forge.json("review/undo", {
      projectId: p.id,
      runId: state.run.id,
      checkpointId: before.checkpointId,
      confirmed: true,
    });
    assert.match(
      await fs.readFile(path.join(p.path, "page.html"), "utf8"),
      /Before/,
    );
    assert.equal(
      (await forge.json(`visual?projectId=${p.id}`)).run.reviewStatus,
      "undone",
    );
    console.log(`comparison evidence: ${forge.root}`);
  },
);
