# Reviewed visual-workflow defect fixes

Scope/approval: user's instruction to fix only the six supplied reviewed defects in `feat/visual-workflow`, based on `b02a4bc`; no merge/push/install/live restart. This is corrective execution of the already-approved feature, not a new design phase.

## Test-first execution

Evidence directory: `/Users/andresulistian/.hermes/cache/scratch/forge-visual-fix-logs`.

| Defect | RED evidence | Fix / GREEN evidence |
|---|---|---|
| Worker network bypass | `isolation-red.log`: real service worker sent `/proof` to a second loopback port | Exact-origin forward proxy, no loopback/direct bypass; `isolation-final.log`, full check |
| Stale selected baseline | `baseline-red.log`: explicit clear returned 400 after completed Ask | Null capture ID deselect API, confirmed UI action, actionable errors; `baseline-green.log` |
| Orphan image review | `restart-red.log`: requested persisted after held fixture review + real isolated restart | Startup requested → interrupted, no provider replay; `restart-green.log` |
| Draft hydration race | `draft-red.log`: composer enabled while session request held | Input/send guard, recoverable retry control; `draft-green.log`, real UI smoke |
| Late target lookup | `target-red.log`: old capture target entered persisted draft after capture switch | Request generation invalidation for lookup/composition, capture change, release and unmount; `target-green.log` |
| Form/closed-shadow/frame masking | `masking-red.log`: changing secrets changed real PNG bytes; `shadow-overflow-red.log`: explicit visible overflowing shadow child reproduced leak | CDP identifies closed roots; opacity suppresses complete subtree, opaque overlays, DOM exclusion, paused page scripts; `isolation-final.log` |

Additional real-browser regression exercises dedicated/shared workers, redirect, WebSocket and popup attempts against a second loopback server while same-origin worker completion succeeds. Screenshots compare actual PNG bytes, not mocked rendering.

## Verification

- `npm run check`: lint + 131 tests + TypeScript/Vite build passed (`check-final.log`). Existing Vite large-chunk warning remains.
- `node --test tests/visual-ui.smoke.mjs tests/visual-races.smoke.mjs`: 3 passed (`ui-final.log`).
- Browser evidence: `/Users/andresulistian/.hermes/cache/scratch/forge-visual-api-QlVqtU` (inspector/comparison/compact PNGs).
- `ordinary-preview-red.log` caught browser background blocks incorrectly failing an ordinary preview. Proxy-wide blocked counts are now separate, explicitly unattributed metadata; ordinary same-origin browser testing passes. `isolation-final.log`: all four real-browser isolation/masking regressions pass.
- All Forge/API fixtures use scratch HOME/data/projects/backups. All Chrome launches use fresh scratch profiles, basic password store and mock Keychain. No real provider invoked.
- Security gate and final explicit-file commit are recorded in the external evidence directory. Independent re-review remains the parent agent's gate; this delegated implementer cannot spawn another child.

## Boundaries

The proxy is a Chromium HTTP network boundary, not an OS sandbox against browser exploits or server-side egress by the already-running preview server. Form masking is conservative and can alter visual appearance; arbitrary text/images/canvas/labels are not secret-scanned. Auto-capture and manual-baseline selection remain separate settings. No automatic retry, Build submission, image upload, project restore or provider replay was added.
