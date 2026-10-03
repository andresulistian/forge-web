# Approved visual workflow implementation

Approval: user explicitly requested ALL approved phases implemented end-to-end on feat/visual-workflow, without merge/push/live restart. Existing design and implementation approval are carried forward. Parent performs independent review and installation; this implementer is already the delegated child.

## Design / acceptance
- Extend native isolated CDP browser runner: real PNG + bounded DOM snapshot and measured findings at desktop/mobile viewport. No external network, input values, auth injection or source-mapping guesses.
- Persist authenticated project captures outside source; bind checkpoint/run/path/viewport and capture time. Capture baseline before Build only when opted in; unavailable capture must not fail code work. Never restore to manufacture baseline.
- Click captured-preview inspector (explicitly snapshot, not live iframe) to select bounded DOM context; user instruction feeds composer without sending. Preserve percentage annotations.
- Explicit image-review consent creates real image attachments for supported vision providers, not prompt-only review.
- Durable server draft settings restore selection/tab/mode/provider and bounded unsent text across port changes. Server run state authoritative; restart interrupts orphan runs, reconnect never replays actions, 401 stops retry.
- Compact Brief → Design → Build → Review controls in current layout. Completion derived separately from run, build checks, captures and acceptance.

## Vertical test-first sequence
1. Native capture: extend tests/browser-tests.test.mjs with actual installed-Chrome capture assertions (PNG, dimensions, overflow, bounded safe DOM). RED before production change. Extend server/browser-tests.mjs only; preserve existing browser tests.
2. Visual persistence/security/comparison: tests/visual-workflow.test.mjs exercise store isolation, limits, stale associations and before/after. Implement server/visual-workflow.mjs, authenticated routes and Build hooks in server/index.mjs. Capture failures recorded independently.
3. Recovery and run-bound review: tests/recovery.test.mjs cover interrupted restart, sanitized bounded settings, stale review rejection and no credential storage. Integrate server state and src/api.ts reconnect semantics.
4. UI: tests for workflow derivation and safe target composition, then src/VisualReview.tsx / src/workflow.ts and App integration. Real browser smoke after build exercises capture, snapshot target, reload/drafts and comparison controls.
5. Full npm run check, isolated real-browser/API integration/security gate; stage explicit feature paths and commit. Logs/screenshots/data outside tracked source.

Each slice records actual RED/GREEN commands and log paths in progress.md. No new dependency. All temporary HOME/FORGE directories live under scratch. Never read real credentials or live database, run project installs, or stop live processes.
