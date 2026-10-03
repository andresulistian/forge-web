import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Workspace } from "../server/workspace.mjs";

export async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "forge-design-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = new Workspace(
    path.join(root, "data"),
    path.join(root, "projects"),
    path.resolve("templates/starter"),
  );
  await workspace.init();
  t.after(() => workspace.close());
  const project = await workspace.create("Design One");
  return { root, workspace, project };
}
export const sample = () => ({
  direction: "Editorial hangat",
  audience: "Pembaca majalah",
  product: "Portal artikel",
  constraints: "Pertahankan logo",
  decisions: "Navigasi teks",
  references: ["https://example.com/editorial"],
  tokens: {
    colors: { accent: { $type: "color", $value: "#123456" } },
    typography: { body: { $type: "fontFamily", $value: "Georgia" } },
    spacing: {
      section: { $type: "dimension", $value: { value: 24, unit: "px" } },
    },
    radius: {},
    shadows: {},
  },
});
