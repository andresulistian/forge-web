#!/usr/bin/env node
// Explicit test-only Codex protocol fixture. Never used by production.
import { createInterface } from "node:readline";
import fs from "node:fs/promises";
import path from "node:path";
let cwd;
let seq = 0;
let approvalTurn;
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
createInterface({ input: process.stdin }).on("line", async (line) => {
  const m = JSON.parse(line);
  if (!m.id) return;
  if (m.id === "fixture-approval" && m.result) {
    await fs.writeFile(
      path.join(process.env.HOME, "fixture-approval-result.json"),
      JSON.stringify(m.result),
    );
    send({
      method: "turn/completed",
      params: { turn: { id: approvalTurn, status: "completed" } },
    });
    return;
  }
  let result = {};
  if (m.method === "turn/interrupt") {
    send({ id: m.id, result });
    send({
      method: "turn/completed",
      params: { turn: { id: m.params.turnId, status: "interrupted" } },
    });
    return;
  }
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
    send({
      method: "turn/started",
      params: { turn: { id, status: "inProgress" } },
    });
    if (m.params.input[0].text.includes("REQUEST_APPROVAL")) {
      approvalTurn = id;
      send({
        id: "fixture-approval",
        method: "item/commandExecution/requestApproval",
        params: {
          command: "printf fixture-only",
          reason: "Isolated approval fixture; no command is executed.",
        },
      });
      return;
    }
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
      if (m.params.sandboxPolicy.type === "workspaceWrite") {
        const text = m.params.input[0].text;
        const urls = [...text.matchAll(/browser URL is (\/\S+)/g)].map(
          (match) => match[1].replace(/\.$/, ""),
        );
        const imageFixture = text.includes("IMAGE_LANDING_FIXTURE");
        const html = imageFixture
          ? `<html><head><meta name="viewport" content="width=device-width"><style>body{margin:0;font:16px system-ui;color:#173c2c;background:#f5f8f1}main{max-width:1100px;margin:auto;padding:24px}header img{width:180px;height:90px;object-fit:contain}section img{width:100%;height:clamp(220px,40vw,440px);object-fit:cover;object-position:center;border-radius:16px}h1{font-size:clamp(28px,4vw,48px)}p{line-height:1.6}</style></head><body><main><header><img alt="Supplied transparent logo" src="${urls[0]}"></header><h1>Explicit image integration fixture</h1><p>Not production AI output. This page consumes asset URLs from the actual dispatched prompt.</p><section><img alt="Supplied JPEG fixture" src="${urls[1]}"></section></main></body></html>`
          : "<html><body><h1>After fixture Build</h1><button>Changed</button></body></html>";
        await fs.writeFile(path.join(cwd, "page.html"), html);
      }
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
