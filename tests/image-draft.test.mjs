import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeDraft } from "../server/session-recovery.mjs";
import { DraftController } from "../src/session-draft.ts";
const id = "12345678-1234-4321-8765-123456789abc";
test("durable draft keeps only image IDs and validated roles, never client media or paths", async () => {
  const draft = {
    text: "Image draft",
    attachments: [
      {
        id,
        imageUsage: "reference",
        data: "private pixels",
        source: { data: "secret" },
        name: "ignored",
        publicUrl: "/not-trusted",
      },
    ],
  };
  const expected = [{ id, imageUsage: "reference" }];
  assert.deepEqual(sanitizeDraft(draft).attachments, expected);
  assert.throws(() =>
    sanitizeDraft({ text: "", attachments: [{ id, imageUsage: "evil" }] }),
  );
  assert.throws(() =>
    sanitizeDraft({ text: "", attachments: [{ id, imageUsage: null }] }),
  );
  assert.throws(() =>
    sanitizeDraft({ text: "", attachments: [{ id: "../../other" }] }),
  );
  const controller = new DraftController("project", async () => ({
    revision: 1,
    draft,
  }));
  await controller.load();
  assert.deepEqual(controller.draft.attachments, expected);
  controller.edit(draft);
  assert.deepEqual(controller.draft.attachments, expected);
  assert.doesNotMatch(
    JSON.stringify(controller.draft),
    /private pixels|secret|publicUrl|ignored/,
  );
});
