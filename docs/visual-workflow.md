# Visual workflow and recovery

Forge extends the existing layout rather than adding a new workspace. The top strip links **Brief (Plan/Ask) → Design (existing Agent identity/skills) → Build (composer) → Review (Preview panel)**. These controls select the next action; they do not claim a stage is complete.

## Use

1. Open a project and start its Preview using the existing confirmation. Capture never installs dependencies or starts a preview itself.
2. In Preview, open **Screenshot · before / after · click-to-edit**. Choose desktop 1440×900 or mobile-width 390×844 and a local path.
3. **Ambil screenshot** stores a real PNG plus measured DOM findings locally. **Baseline sebelum Build** creates a real checkpoint and captures its current preview. **Gunakan untuk Build berikutnya** associates that baseline with the next Build, provided the code, checkpoint, preview session and current run have not changed. If stale (including after Ask or retention), use **Lepas baseline untuk Build dengan checkpoint baru**, confirm, then send Build yourself; the old capture is never silently associated. Automatic capture and manual baseline selection are separate options.
4. Alternatively enable **Capture otomatis sebelum/sesudah Build**. Save the desired viewport/path with that checkbox. Forge captures the checkpoint baseline *before* attachment staging or agent execution, then captures the same path/viewport after the same run completes. Missing browser/preview or capture errors do not turn completed code work into a failed run. No baseline is manufactured by restoring the project.
5. Open the checkpoint comparison. Accept and Undo send the exact displayed run and checkpoint IDs. Undo retains the existing confirmation and safety-checkpoint restore implementation. Historical images remain historical; changed pixels are not a quality score.
6. Click the **snapshot inspector** PNG, or use its keyboard-accessible DOM selector. A bounded, unique-at-capture CSS selector, tag, safe text, accessible label/role and bounding box are shown. Type a change instruction and use **Masukkan konteks ke composer**. This does not send or execute an agent turn. Existing percentage annotations remain separate.
7. **Review screenshot dengan AI…** asks permission to send the *selected actual PNG* to the displayed provider/model. The image is passed through the existing `Attachments` and agent media pipeline. Results appear in chat; the Build review run is not replaced. Human and AI review statuses are independent of local DOM checks and build/test statuses.

## Safety and limitations

- Capture uses a new Chrome/Chromium profile, no saved browser login, `--password-store=basic --use-mock-keychain`, disabled extensions/sync/background networking, local-origin Fetch interception, blocked file/WebSocket requests, denied downloads and blocked popup creation. A per-capture HTTP forward proxy permits only the exact preview origin, pins forwarding to its loopback port, rejects CONNECT/upgrades, and never follows redirects. Chromium's implicit loopback bypass is disabled with `<-loopback>`; no direct fallback is configured. This applies to service/dedicated/shared-worker HTTP traffic as well as pages; QUIC and non-proxied WebRTC UDP are disabled. It is not an OS network sandbox or protection against a compromised browser/preview server. No Forge auth token enters the project page. Tests never approve macOS Keychain prompts or use the user's real browser profile.
- Screenshots are a **fresh isolated load of the running project's preview**, not a copy of the embedded iframe's logged-in session or transient form state. External assets/fonts are blocked. Mobile is a CSS viewport preset, not full phone/UA/touch emulation. Capture settling is bounded; it cannot establish that an arbitrary app's data requests are finished.
- Local findings are horizontal overflow, basic unnamed-control heuristics and observed runtime/network errors. They are not a WCAG audit, compliance result or visual-quality score. Input values, password fields, storage/cookies and arbitrary attributes are not collected as DOM context. Editable regions, entire shadow hosts (including closed roots), and frames/plugins are conservatively masked rather than inspected. Page script execution is paused while masking/capturing. Mask counts/policy are stored with captures. Ordinary text, images, canvas and accessible labels are **not secret-scanned**; inspect every PNG before consenting to upload.
- Inspector hit selection chooses the smallest captured bounding box containing the point. Verify the visible tag/text for overlapping elements. Shadow DOM, nested frames and editable controls are excluded. Source mapping is explicitly unavailable. DOM text is untrusted data, not instructions.
- Target freshness checks the preview session, observed run, source-file metadata fingerprint and a 10-minute lifetime. It does **not** guarantee that dynamic server data or live DOM state has remained unchanged. Stale target selection/composition is rejected and requires recapture.
- Explicit AI review currently supports **Codex models advertising `image` input**. Other providers or unverified capabilities fail before image submission. The existing image attachment pipeline also rejects frames exceeding 3,000,000 base64 characters; larger locally stored PNGs remain viewable but are not silently truncated or substituted. No real paid provider was invoked during verification; the protocol fixture is explicitly test-only.
- Up to 24 captures and 120,000,000 PNG bytes are retained per project, newest first; one PNG is limited to 12,000,000 bytes. Retention only removes generated capture files, never project source or checkpoints. PNGs live under `FORGE_DATA_DIR/visual-captures/<projectId>/`, metadata in the existing SQLite settings store. Images require API authentication; no static public image route is added.
- Drafts are bounded to 40,000 characters per project, with mode/provider/model/tab and a target reference only. Credential fields are not accepted. Do not paste secrets into prompt text. The browser fallback cache keeps at most ten drafts, catches malformed storage/quota failures, and is same-origin; acknowledged server drafts survive launcher port changes. Local/server conflicts require a recovery choice rather than silently dropping unsent text.
- Server state is authoritative for active/completed/interrupted work. A real restart marks orphan running jobs and requested image reviews interrupted without replay. Image-review retry requires new upload consent. Reconnect refreshes server state and event generation/cursor; it never repeats Build, terminal, deployment or submissions. Unsaved streaming fragments are not reconstructed. A 401 stops reconnect with instructions to reopen from the launcher. Retry is an explicit, confirmed new run. Composer input/submission is locked until draft hydration finishes; failed loads expose a retry control.

## API contract

All routes require `Authorization: Bearer <launcher token>` and normal origin checks. JSON errors use HTTP 400, invalid authentication HTTP 401. IDs are returned by Forge; do not invent checkpoint/run IDs.

| Method / route | Body or query | Result |
|---|---|---|
| GET `/api/visual` | `projectId` | `{captures, run, auto, viewport, path, lastError, pendingBaselineId?}` |
| POST `/api/visual/options` | `{projectId, auto:boolean, viewport:"desktop"\|"mobile", path}` | Persisted local capture options |
| POST `/api/visual/capture` | `{projectId, kind:"snapshot"\|"baseline"\|"after", viewport, path, runId?, checkpointId?}` | Capture metadata, safe DOM snapshot, findings; no image bytes in JSON |
| GET `/api/visual/image` | `projectId`, `id` | Authenticated PNG, `Cache-Control: no-store`; cross-project, traversal, symlink and hardlink reads rejected |
| POST `/api/visual/baseline` | `{projectId, captureId:string\|null}` | Select fresh manual baseline; null explicitly deselects even a missing/stale retained ID |
| POST `/api/visual/target` | `{projectId, captureId, index}` | Freshness-checked untrusted DOM context with unavailable source mapping |
| POST `/api/visual/review` | `{projectId, captureId, provider, model, confirmed:true}` | Starts read-only image review; `{ok,captureId,attachmentId}` |
| POST `/api/visual/human-review` | `{projectId,captureId,confirmed:true}` | Records manual review of this image only |
| POST `/api/review/accept` | `{projectId,runId,checkpointId}` | Exact-current-run acceptance, existing checkpoint result |
| POST `/api/review/undo` | `{projectId,runId,checkpointId,confirmed:true}` | Existing safe restore, exact run/checkpoint match required |
| GET `/api/session` | `projectId` | `{revision,draft}`; read-only |
| POST `/api/session` | `{projectId,expected:revision,draft:{text,mode,provider,model,tab,target?}}` | Compare-and-swap persistence; unknown fields dropped |
| GET `/api/state` | — | Adds `generation` and `session.projectId`; existing preview/active/approval/deployment state remains authoritative |
| GET `/api/events` | `after`, `generation` | Cursor reconciliation against current server generation |

`POST /api/chat` additionally accepts an optional `baselineId`; otherwise a selected manual baseline is consumed. Opt-in automatic captures use persisted visual options. Requests without either retain normal Build behavior.

## Reproduce verification (isolated, no live restart)

From the feature worktree:

```sh
export TMPDIR="$HOME/.hermes/cache/scratch"
npm run check
node --test tests/visual-ui.smoke.mjs
```

`tests/visual-fixtures.mjs` starts a separate server with temporary HOME, data/projects/backups and `FORGE_PORT=0`. Its preview is a tiny local Node HTML server; no dependency install is needed. `tests/fixtures/visual-codex.mjs` is an **explicit fake provider only for tests**, selected through the existing `FORGE_CODEX_BIN` mechanism. Native Chrome capture and UI rendering are real. The UI smoke prints its evidence directory, preserves PNGs for inspection and stops only owned test processes.

The UI smoke exercises actual capture controls, coordinate-based DOM selection, composer insertion without agent execution, keyboard activation of automatic capture, Build through the composer, before/after images, exact-run Accept, unsent-draft/target reload, and tab/draft restoration after a server restart on a different port. It measures the compact review panel for horizontal overflow and checks runtime exceptions. API tests additionally exercise auth/project isolation, stale targets, unsupported vision, exact PNG bytes entering the provider pipeline, manual baseline association, safe Undo, linked-artifact rejection, missing-preview Build behavior and interrupted-run recovery.

Independent review, installation, merge/push and live-server restart remain the parent's responsibility; this feature worktree does not perform them.
