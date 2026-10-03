# Design Kit phase one — approved implementation

Approval: user explicitly requested implementation of the already approved phase one, on feat/design-kit-phase-one. Parent owns independent review, UI smoke, merge and publication; this implementer never touches live data or restarts Forge.

## Design
- Five selective, curated built-in design guides; first slash command remains the selector and existing custom commands retain precedence on collisions.
- A compact Indonesian identity editor in Agent Center. Project-keyed lifecycle prevents stale responses. Explicit save feedback and revision conflicts.
- Portable DESIGN.md is the canonical identity (bounded machine-readable JSON section plus human-readable guidance). design.tokens.json is a derived export. Existing unowned files are never replaced; explicit import keeps original Markdown as context. Existing token files require resolution by the user rather than overwrite.
- Fixed filenames, no arbitrary path input; reject symlinks/hardlinks and changed project roots, bound fields/tokens/references. Checkpoint before changes. No network or uploads from references.
- Shared context assembly before existing provider routing, applies ask/plan/build and multi-agent. No automatic visual QA.

## Test-first vertical plan
1. tests/design-kit.test.mjs + server/design-skills.mjs + server/skills.mjs: resolve each guide selectively, retain legacy/custom compatibility. Observe missing-guide RED then GREEN.
2. tests/design-identity.test.mjs + server/design-identity.mjs: save/reload/isolation and portable canonical files. RED missing behavior then GREEN. Extend with conflict, import, bounded validation, path and checkpoint failure slices.
3. tests/design-context.test.mjs + server/agent-context.mjs + server/index.mjs: shared assembly and authenticated GET/POST APIs; all provider paths consume the assembled text. RED then GREEN.
4. tests/design-ui.test.mjs + src/DesignIdentity.tsx + src/AgentCenter.tsx + src/styles.css: accessible compact editor with loading/error/save and project switch safety; RED then GREEN. Existing skill picker remains.
5. README usage/API/limits; npm run check and security gate `node --experimental-strip-types --test tests/integrations.test.mjs`; stage explicit feature files only and commit.

Evidence logs live in .design-kit-logs/ (not committed). Test fixtures only beneath scratch via TMPDIR. No new dependencies.
