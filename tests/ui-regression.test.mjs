import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const read = (file) =>
  fs.readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("ChatGPT-style chat and attachments remain one integrated composer", async () => {
  const [app, attachments, styles] = await Promise.all([
    read("src/App.tsx"),
    read("src/Attachments.tsx"),
    read("src/styles.css"),
  ]);
  const composer = app.indexOf('<div className="composer">');
  const picker = app.indexOf("<AttachmentPicker", composer);
  const textarea = app.indexOf(
    '<textarea\n                  aria-label="Pesan untuk Forge"',
    picker,
  );
  const tools = app.indexOf('<div className="composer-tools">', textarea);
  assert.ok(composer >= 0, "chat composer must exist");
  assert.ok(
    picker > composer && textarea > picker && tools > textarea,
    "attachment picker, message input, and chat tools must stay inside one composer",
  );
  assert.match(app, /\["ask", "plan", "build"\]/);
  assert.match(app, /aria-label="Kirim pesan"/);
  assert.match(app, /aria-label="Hentikan agent"/);
  assert.match(app, /className="conversation"/);
  assert.match(app, /className="message-attachments"/);
  assert.match(attachments, /multiple/);
  assert.match(attachments, /onDrop=/);
  assert.match(attachments, /Lampirkan file/);
  assert.match(styles, /\.composer \.attachment-picker/);
  assert.match(styles, /\.message\.user/);
});

test("Vikey has a dedicated provider option and editable API key field", async () => {
  const panel = await read("src/IntegrationsPanel.tsx");
  assert.match(panel, /<option value="vikey">Vikey AI<\/option>/);
  assert.match(panel, /https:\/\/api\.vikey\.ai\/v1/);
  assert.match(panel, /type="password"/);
  assert.match(panel, /value=\{provider\.apiKey\}/);
});

test("dark and light themes persist and also update Monaco", async () => {
  const [app, editor, styles] = await Promise.all([
    read("src/App.tsx"),
    read("src/MonacoCodeEditor.tsx"),
    read("src/styles.css"),
  ]);
  assert.match(app, /localStorage\.getItem\("forge-theme"\)/);
  assert.match(app, /document\.documentElement\.dataset\.theme = theme/);
  assert.match(app, /className="theme-toggle"/);
  assert.match(editor, /theme === "light" \? "light" : "vs-dark"/);
  assert.match(styles, /@import "\.\/theme.css"/);
  assert.match(
    await read("src/theme.css"),
    /:root\[data-theme=['"]light['"]\]/,
  );
});

test("Dedicated Chat and Codex-style multi-agent controls cannot disappear", async () => {
  const [app, styles, server, agents, codex, providers] = await Promise.all([
    read("src/App.tsx"),
    read("src/styles.css"),
    read("server/index.mjs"),
    read("server/agents.mjs"),
    read("server/codex.mjs"),
    read("server/api-providers.mjs"),
  ]);
  assert.match(app, /useState<WorkspaceView>\("chat"\)/);
  assert.match(app, /label="Opsi chat"/);
  assert.match(app, /Multi-Agent · Codex\/Vikey\/OpenRouter/);
  assert.match(app, /aria-label="Status multi-agent"/);
  assert.match(app, /multiAgentSupported/);
  assert.match(styles, /\.workspace\.dedicated-chat/);
  assert.match(styles, /\.agent-team-status/);
  assert.match(server, /multiAgentProjects/);
  assert.match(server, /b\.multiAgent === true && b\.mode === "build"/);
  assert.match(agents, /multiAgent = false/);
  assert.match(codex, /Multi-agent mode is enabled/);
  assert.match(providers, /async runMultiAgent/);
  for (const role of ["Explorer", "Builder", "Reviewer"])
    assert.match(providers, new RegExp(role));
});

test("OpenRouter tool runs allow up to 120 steps", async () => {
  const providers = await read("server/api-providers.mjs");
  assert.match(providers, /const OPENROUTER_MAX_TOOL_STEPS = 120/);
  assert.match(providers, /maxSteps = OPENROUTER_MAX_TOOL_STEPS/);
  assert.match(
    providers,
    /finalize: false, maxSteps: OPENROUTER_MAX_TOOL_STEPS/,
  );
});

test("cumulative Mac features cannot silently disappear from a release", async () => {
  const [app, deployCenter, server, providers, agents, attachments, styles] =
    await Promise.all([
      read("src/App.tsx"),
      read("src/DeployCenter.tsx"),
      read("server/index.mjs"),
      read("server/api-providers.mjs"),
      read("server/agents.mjs"),
      read("server/attachments.mjs"),
      read("src/styles.css"),
    ]);
  for (const marker of [
    "<GuideChat",
    "<BrowserTests",
    "Clear Workspace",
    "Hapus proyek",
    "resolvingApproval === a.id",
  ])
    assert.match(
      app,
      new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      marker,
    );
  assert.match(deployCenter, /<MonitoringPanel/);
  assert.match(deployCenter, /<ReleasePanel/);
  assert.match(app, /Cloudflare Preview siap:/);
  assert.match(app, /Buka Preview/);
  assert.match(styles, /\.deploy-result/);
  assert.match(server, /url\.pathname === "\/api\/projects\/delete"/);
  assert.match(server, /url\.pathname === "\/api\/projects\/clear"/);
  assert.match(server, /attachments\.stage\(p, media\)/);
  assert.match(providers, /runOpenRouter/);
  assert.match(providers, /toolModels/);
  assert.match(agents, /provider\.startsWith\("api:"\)/);
  assert.match(attachments, /extractPdfText/);
  assert.match(attachments, /inspectZip/);
  // v0.9.0 Kanban board and its server wiring.
  assert.match(app, /<KanbanPanel/);
  assert.match(app, /\["kanban", "Kanban"\]/);
  assert.match(app, /kanban-updated/);
  assert.match(app, /kanbanTaskId/);
  assert.match(server, /url\.pathname === "\/api\/kanban"/);
  assert.match(server, /case "\/api\/kanban\/verify"/);
  assert.match(server, /kanban\.review\(p, run\.id, "accepted"\)/);
  assert.match(server, /kanban\.review\(p, run\.id, "undone"\)/);
  assert.match(styles, /\.kanban-columns/);
});

test("approval sound, new-tab preview, and editable annotations stay available", async () => {
  const [app, annotations, notifications, styles] = await Promise.all([
    read("src/App.tsx"),
    read("src/PreviewAnnotations.tsx"),
    read("src/notifications.ts"),
    read("src/styles.css"),
  ]);
  assert.match(app, /playApprovalSound/);
  assert.match(app, /Buka preview di tab baru/);
  assert.match(app, /<PreviewAnnotations/);
  assert.match(app, /Kirim ke chat/);
  assert.match(annotations, /Edit annotation/);
  assert.match(annotations, /Hapus marker/);
  assert.match(notifications, /createOscillator/);
  assert.match(styles, /\.annotation-layer/);
  assert.match(styles, /\.annotation-marker/);
});

test("workspace adapts to narrow and short browser viewports", async () => {
  const styles = await read("src/styles.css");
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /height: 100dvh/);
  assert.match(styles, /\.conversation \{[\s\S]*?overflow: auto/);
  // Actual 390/1024/1440 widths, both themes and screenshots: simple-ui.smoke.mjs.
  assert.match(styles, /width: min\(840px, 100%\)/);
  assert.match(styles, /\.composer-tools \{[\s\S]*?flex-wrap: wrap/);
  assert.match(styles, /\.tabs \{[\s\S]*?overflow-x: auto/);
  assert.match(styles, /\.workspace \{[\s\S]*?min-width: 0/);
});

test("project and workspace deletion default to recoverable folder removal", async () => {
  const app = await read("src/App.tsx");
  assert.match(
    app,
    /setDeleting\(\{ project: selected, deleteFiles: true \}\)/,
  );
  assert.match(app, /setClearingWorkspace\(\{ deleteFiles: true \}\)/);
  assert.match(app, /nama dapat digunakan kembali/);
  assert.match(app, /Dapat dipulihkan dari Trash Mac/);
});

test("agent progress remains visible for the entire active streamed turn", async () => {
  const [app, styles] = await Promise.all([
    read("src/App.tsx"),
    read("src/styles.css"),
  ]);
  assert.match(app, /aria-label="Progress agent Forge"/);
  assert.match(app, /className="agent-progress-track"/);
  assert.match(app, /visibleEvents\s*\.slice\(-3\)/);
  assert.doesNotMatch(app, /active === selected\?\.id && !live/);
  assert.match(styles, /\.agent-progress-track/);
  assert.match(styles, /@keyframes agent-progress/);
});
