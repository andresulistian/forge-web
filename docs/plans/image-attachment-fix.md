# Uploaded image integration — approved scope and test ledger

Approval: delegated user instruction to fix uploaded images end-to-end in this isolated worktree; explicit implementation/commit permission, no merge/push/install/live restart. Existing approved chat-first design is unchanged. Purple accent work is explicitly excluded. Parent performs independent specification/quality and installation-path review after handoff.

## Design

Upload stores private original source bytes and bounded visual frames. Drafts store IDs and validated image roles only; sent messages contain safe display metadata, never source/frame bytes. Authenticated project-scoped previews return bounded verified PNG/JPEG frames, never arbitrary filesystem URLs or SVG/HTML. Build checkpoints first, stages only Auto/page assets, then assembles context once with actual encoded URLs and persists matching metadata. Ask/Plan/upload do not write project files. Reference-only stays private. Intent overrides resolve by saved project ID, never client source bytes. Sent-image reuse is explicit; previous attachments are never bulk republished. Compact thumbnails and Auto/Aset halaman/Referensi desain controls live in the existing composer/chat; preview remains on demand.

Original files use full attachment UUIDs and exclusive writes. Existing identical bytes may be reused, but conflicting files and symlinks are rejected. Static/framework mirrors preserve the supplied browser URL when a starter changes after context delivery. Legacy images without original source get an explicitly labelled normalized frame, never an original-binary claim.

## Vertical plan / execution evidence

All logs below are outside the repository under `/Users/andresulistian/.hermes/cache/scratch/`.

| Slice | Behavioral RED | GREEN / acceptance evidence |
| --- | --- | --- |
| Actual HTTP upload → Build → provider context | `forge-image-http-red.log`: real image part and staged source existed, dispatched text omitted its URL | `image-upload.http.test.mjs`; final full gate checks the delivered URL, original bytes and stored message metadata together |
| Authenticated private thumbnail | `forge-image-preview-red.log`: route404 instead of200 | PNG/JPEG, Bearer auth401, cross-project404, strict IDs, no-store/nosniff, corrupt format and symlink rejection |
| ID-scoped image roles | `forge-image-role-red.log`: object selection400 instead of200 | Reference remains private; source/name spoof ignored; invalid/duplicate/cross-project roles rejected; string ID clients retained |
| Legacy/path/collision behavior | Existing legacy/encoding/framework RED logs retained; `forge-image-resume-focused.log` and `forge-image-overwrite-red.log`: unrelated file overwritten instead of rejected | `image-assets.test.mjs`: normalized provenance, encoded URLs, static/public mirrors, full-UUID collision isolation and idempotent identical restaging |
| Real file-chooser thumbnail | `forge-image-ui-red.log`: decoded draft thumbnail absent | `image-ui.smoke.mjs`: real filesystem files through Chrome file chooser/input; naturalWidth>0; no chip mock |
| Draft roles / sent reuse | `forge-image-draft-red.log`: saved IDs absent; `forge-image-role-ui-red.log`: selector absent | ID-only sanitized server/browser drafts, reload/restart recovery, sent thumbnails, role display, explicit reuse/removal; removal revokes its blob; failed fetch has an actionable fallback |
| Transparent vision normalization | `forge-image-alpha-red.log`: PNG logo JPEG-flattened | Pixel alpha0/255 verified; original bytes unchanged; PNG dimensions <=1600 and encoded frame <=2,900,000, including generated noisy raster |
| Project-switch races | `forge-image-race-red.log`: project switching blocked during upload | Delayed real upload/thumbnail cannot populate another project; cancellation and stale-result guards; scoped cleanup; image URLs discarded/revoked outside view |
| Delivered-URL landing fixture | `forge-image-landing-red.log`: fixture page did not contain dispatched asset URLs | Explicit test-only fixture consumes actual provider text URLs; exact original PNG/JPEG decoded at390/1440; contain logo / cover raster; light/dark chat screenshots; historic IDs load after isolated restart on a different origin |
| Unsupported local vision | `forge-image-providers-red.log`: text-only Ollama dispatched instead of rejecting | Metadata-only local `/api/show` check, including legacy projector metadata; no classifier call; existing Codex/Gemini/API/Ollama multimodal transport tests retained |
| Private storage guards | `forge-image-symlink-red.log`: upload accepted a linked project store; `forge-image-root-symlink-red.log`: recursive mkdir created a child through linked root | Guard parent before child creation, no-follow reads, reject hardlinks/unsafe raster, exclusive private writes; no outside files or directories created |
| Strict role enums | `forge-image-null-role-red.log`: explicit null incorrectly treated as Auto | Null/bad enums rejected server-side; omitted roles still default Auto |

The HTTP suite additionally verifies Ask/Plan leave the entire project file list unchanged; matching Build message/provider paths; restore to the pre-Build checkpoint excludes image staging and fixture generation; source/metadata/drafts remain isolated by project; private preview survives restart.

## Root cause

The integrated chat route assembled attachment context before `stage()` supplied `workspacePath/publicUrl`. The existing helper-only test assembled them in the opposite order, so the binary was staged but the model never received its URL. UI rendered filename/icon only; draft persistence excluded attachment IDs. Browser canvas normalization JPEG-flattened alpha even though original source bytes were preserved.

## Verification and boundaries

Commands run against isolated scratch HOME/TMPDIR/data/projects/backups/profiles, never user projects or personal browser profiles:

```sh
npm run check
node --test tests/simple-ui.smoke.mjs tests/review-ui.smoke.mjs tests/visual-ui.smoke.mjs tests/visual-races.smoke.mjs tests/image-ui.smoke.mjs
```

Recorded gates: `forge-image-check.log` (149 tests, lint and TypeScript/Vite build) and `forge-image-browser-all.log` (16 real-browser tests). `forge-image-final-security.log` records the added-line/new-file secret/artifact gate; `git diff --check` also passed. The full-tree scanner still flags two unchanged existing test fixtures in `tests/recovery.test.mjs` and `tests/web.test.mjs`; no new finding or private artifact is introduced. Existing large Monaco chunk warning is unchanged.

Final image screenshots are listed in the browser log; latest evidence root: `/Users/andresulistian/.hermes/cache/scratch/forge-visual-api-ZYdoiE/`. Screenshots were inspected at desktop/mobile and light/dark; fixture images actually decoded. Logs and generated media remain outside tracked source. Chrome is isolated with `--password-store=basic --use-mock-keychain`; only owned test processes are stopped.

Semantic image selection/style advice uses the ordinary multimodal request, not another classifier or deterministic aesthetic score. Auto means an available candidate, not a requirement to insert every image. Guidance respects explicit intent, supplied URLs, logo alpha/aspect ratio, deliberate photo crop/focal point, readable overlays and the project's DESIGN.md palette. The integration fixture is plumbing evidence, not production AI's semantic or aesthetic judgment. Its JPEG is a generated photo-like raster, not externally sourced photography. No real provider inference, cloud credential call, paid operation or live-server restart was performed. Optional image enlargement is not added; thumbnails and existing project preview suffice. Source is committed for parent review only, not installed or merged.
