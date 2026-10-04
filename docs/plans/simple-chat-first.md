# Chat-first Forge — approved design and execution ledger

Approval: user explicitly requested implementation of the approved chat-first design (no additional approval needed). Parent delegated implementation in this isolated worktree; independent specification and quality review remain the parent's responsibility.

## Design

Chat is the default, including legacy Builder preferences. Preserve drafts, project selection and last tool tab without exposing a workbench on load. Compact project toggle/title, Preview and Tools header. Tools expose existing routes, workflow, settings and destructive operations; no Simple/Advanced mode. Preview is explicit, closable and never starts a process merely by opening. Keep approvals, errors and Stop visible. Collapse optional composer settings and usage. Use the verified shipped Hermes neutral light palette and system font, not Hermes branding or an asserted pixel match. Preserve dark preference.

## Test-first vertical plan

1. `tests/simple-ui.smoke.mjs`: legacy Builder preference opens chat-only; Preview opens/closes, draft stays and no preview starts. RED on current build, then change `src/App.tsx` shell and a shared contextual disclosure. GREEN in real isolated Chrome.
2. Extend smoke: keyboard Tools/close/focus, all feature routes, sidebar preference, workflow and guide entry; change shell routes without backend edits. Update existing visual UI/race smokes to use contextual entrypoints, preserving all assertions.
3. Extend smoke: light/dark 390/1024/1440 widths, text contrast and screenshots. Refactor `src/styles.css` and `src/visual-workflow.css` semantic tokens, no remote fonts; preserve dark styling.
4. Run check, visual workflow/race and simplified UI smokes. Security gate then commit explicit files. No merge/push/restart/live data/Hermes edits.

Tests use isolated HOME/data/projects/backups and fresh Chrome profile with basic password store/mock keychain. Evidence stays in scratch outside git. Existing capture network/masking and backend code remain unchanged.

## Progress

- Baseline supplied by parent: check passed (137 tests), clean e1fc77c.
- Completed vertical RED→GREEN slices with real isolated Chrome:
  - `forge-simple-red.log`: legacy Builder preference wrongly exposed workbench; `forge-simple-green.log`: corrected.
  - `forge-simple-tools-red.log`: no contextual Tools entry; `forge-simple-tools-green.log`: all primary tool routes, Escape and focus return.
  - `forge-simple-style-red.log`: legacy tinted canvas; `forge-simple-style-green.log`: neutral theme, readable measure, both themes and three viewport widths.
  - `forge-simple-picker-red.log`: permanent 770px settings box; final browser suite: contextual model chip.
  - `forge-simple-focus-red.log`: project drawer ignored Escape; `forge-simple-guide-red.log`: Guide did not receive focus; `forge-simple-guide-green.log`: drawer/modal/Guide keyboard behavior passes.
  - `forge-simple-safety-red.log`: mobile preview hid Stop; `forge-simple-safety-green.log`: Stop remains visible and interrupts the fixture. Extended the test-only Codex fixture to acknowledge interruption.
  - `forge-simple-preview-red.log`: browser tests always exposed; `forge-simple-preview-green.log`: explicit disclosure.
  - `forge-simple-narrow-focus-red.log`: focusing composer before hidden chat was revealed lost focus; final suite proves focus after rendering at 390px.
- Refactored original CSS declarations to shared semantic tokens (including visual workflow); removed remote font import, legacy light override blocks and obsolete fixed-height workspace squeezing rather than appending an override pile.
- Preserved existing static coverage while updating label/selector expectations for contextual paths. Browser helper now clicks visible enabled controls with CDP pointer events; async DOM/effect assertions wait for actual UI state instead of racing React effects.
- Final `forge-simple-check.log`: lint + 137/137 tests + build passed. `forge-simple-browser.log`: 6/6 browser smokes passed, including full snapshot/build/accept/recovery and both race checks. Logs/screenshots live outside git in the parent scratch folder.
- Repeat browser runs caught focus timing problems: focus now moves synchronously after layout when chat is revealed and when a true modal mounts, avoiding a delayed frame stealing focus from a subsequently opened modal. The protocol fixture now emits `turn/started` and completes interrupted turns. Two consecutive full simplified-shell runs passed after these fixes.
- See `simple-chat-first-access.md` for the access checklist and measured coverage. Independent parent review remains required before merge/install.
