#!/usr/bin/env node
// Explicit test-only Codex protocol fixture. Never used by production.
import { createInterface } from "node:readline";
import fs from "node:fs/promises";
import path from "node:path";
let cwd;
let seq = 0;
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
createInterface({ input: process.stdin }).on("line", async (line) => {
  const m = JSON.parse(line);
  if (!m.id) return;
  let result = {};
  if (m.method === "model/list")
    result = {
      data: [
        {
          model: "fixture-vision",
          displayName: "Test vision",
          isDefault: true,
          inputModalities: ["text", "image"],
        },
        { model: "fixture-text", inputModalities: ["text"] },
      ],
      nextCursor: null,
    };
  if (m.method === "thread/start") {
    cwd = m.params.cwd;
    result = { thread: { id: "fixture-thread" } };
  }
  if (m.method === "turn/start") {
    const id = "fixture-turn-" + ++seq;
    result = { turn: { id } };
    await fs.writeFile(
      path.join(process.env.HOME, "fixture-last-input.json"),
      JSON.stringify(m.params.input),
    );
    send({ id: m.id, result });
    if (
      m.params.input[0].text.includes("HOLD_FOR_RESTART") ||
      (m.params.input.some((i) => i.type === "image") &&
        (await fs.access(path.join(process.env.HOME, "hold-image-review")).then(
          () => true,
          () => false,
        )))
    )
      return;
    setTimeout(async () => {
      if (m.params.sandboxPolicy.type === "workspaceWrite")
        await fs.writeFile(
          path.join(cwd, "page.html"),
          "<html><body><h1>After fixture Build</h1><button>Changed</button></body></html>",
        );
      send({
        method: "item/completed",
        params: {
          item: {
            type: "agentMessage",
            text: "Explicit fixture response, not production AI.",
          },
        },
      });
      send({
        method: "turn/completed",
        params: { turn: { id, status: "completed" } },
      });
    }, 100);
    return;
  }
  send({ id: m.id, result });
});
