# Design Kit phase one — implementation evidence

## Approval and ownership

The user explicitly requested implementation of the approved phase one in the isolated `feat/design-kit-phase-one` worktree, including TDD, `npm run check`, and an explicit-file commit after the security gate. This is the delegated implementer. Independent specification/quality review, interactive UI smoke, merge and GitHub verification remain assigned to the parent. No live Forge restart, merge, push, new package, credential change, or real project/data test was performed.

## Delivered slices

Local raw logs are under `.design-kit-logs/` in this worktree; they are deliberately not committed. Each row has `<stem>-red.log` (exit 1 with a behavioral assertion) and `<stem>-green.log` (exit 0).

| Stem | Behavior / observed RED | GREEN command |
| --- | --- | --- |
| `01-skills` | `/design` missing; new built-ins not resolving | `node --experimental-strip-types --test tests/design-kit.test.mjs tests/phase1.test.mjs` |
| `02-identity` | Persistent identity service absent | `node --experimental-strip-types --test tests/design-identity.test.mjs` |
| `03-validation` | Invalid input was accepted | same identity test command |
| `04-preservation` | Existing user files were overwritten without import/conflict protection | same identity test command |
| `05-boundaries` | Symlinks allowed, concurrent saves both accepted, malformed canonical document not handled | same identity test command |
| `06-references` | Nonexistent attachment accepted | same identity test command |
| `07-context` | Shared context assembler absent | `node --experimental-strip-types --test tests/design-context.test.mjs` |
| `08-api` | GET identity endpoint returned 404 | `node --experimental-strip-types --test tests/design-api.test.mjs` |
| `09-editor` | Race-safe editor controller absent | `node --experimental-strip-types --test tests/design-ui.test.mjs` |
| `10-ui` | Identity form absent from Agent Center | same UI test command |
| `11-import-preservation` | Later save discarded imported original notes | same identity test command |
| `12-strict-input` | Null field accepted rather than validated | same identity test command |

API/editor test drafts initially had syntax errors. These were not accepted as RED evidence: the syntax was corrected, implementation temporarily removed, the behavioral RED was observed, and implementation restored before GREEN. Earlier context logs included identity tests twice through a shared import; fixture extraction removed that duplication in the final suite.

## Verification and findings

- `npm run check`: successful in `check-fourth.log`, 109 tests passed, 0 failed, ESLint clean, TypeScript and Vite build succeeded. Vite reports the existing large-chunk advisory (Monaco); no bundle-size compliance claim is made.
- `node --experimental-strip-types --test tests/integrations.test.mjs`: `security-gate.log`, 14 passed, 0 failed. This runs before staging.
- HTTP tests start a throwaway server with scratch HOME/data/projects/backups, random local port, no provider credentials, and shut down only that child. Important harness finding: `FORGE_DESKTOP=1` treats stdin EOF as shutdown, so the fixture must keep stdin piped, not ignored. This fixed a full-suite-only connection refusal without changing production lifecycle code.
- UI verification here is SSR of actual form markup plus state-controller tests for acknowledged saves, failed saves retaining drafts, reload errors and disposed/late requests. Browser screenshots, keyboard walkthrough and real viewport checks are not claimed; parent owns interactive smoke.
- Provider context is exercised for Ask/Plan/Build across Codex, Gemini, Ollama, OpenRouter and Vikey dispatch; supported multi-agent routes also receive the saved identity. Tests use dispatch spies rather than paid model calls. Forge Guide remains its separate path.
- Scope discovery corrected the proposal's endpoint name: existing catalog is `/api/agent-center`, not `/api/agent-context`. New routes are GET `/api/design-identity` and POST `/api/design-identity/save`.

## Source of truth and limitations

`DESIGN.md` canonical JSON holds the full identity; `design.tokens.json` is a derived export. Explicit import retains existing Markdown verbatim in imported notes and a checkpoint. Modified/unowned exports are refused, not force-overwritten. Serialized revision checks prevent concurrent Forge writes and detect external changes. Per-file atomic renames are not a two-file crash transaction: interrupted export/canonical updates surface as conflicts, with checkpoint recovery. Filesystem protection does not promise safety against a hostile process concurrently replacing directory trees; only trusted local projects should be opened.

No automatic visual QA, reference fetching/uploading, dependency installation, universal visual style, or full DTCG-compliance claim was introduced. User identity content is bounded advisory project context, not trusted system instructions. Drafts are intentionally not persisted until Save and do not follow project switches.

## Changed paths

- Backend: `server/design-skills.mjs`, `server/skills.mjs`, `server/design-identity.mjs`, `server/agent-context.mjs`, `server/index.mjs`.
- UI: `src/DesignIdentity.tsx`, `src/design-identity-editor.ts`, `src/AgentCenter.tsx`, `src/styles.css` (only feature selectors).
- Tests: `tests/design-kit.test.mjs`, `tests/design-identity.test.mjs`, `tests/design-fixtures.mjs`, `tests/design-context.test.mjs`, `tests/design-api.test.mjs`, `tests/design-ui.test.mjs`.
- Documentation: `README.md`, this ledger, and `docs/plans/design-kit-phase-one.md`.

Final post-format verification passed: `feature-final.log` 18/18 tests, `check-final.log` 109/109 tests plus lint/TypeScript/production build, `security-gate-final.log` 14/14 tests; all commands exited 0 and `git diff --check` was clean. Independent review is intentionally not represented as completed by this implementer.
