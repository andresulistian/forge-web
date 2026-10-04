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

## Independent image review follow-up

Approval: the user's delegated instruction explicitly authorizes the three precise review fixes, strict behavioral RED/GREEN probes, security/regression gates and a commit in `fix/image-attachment-design`, starting from `4de9d2fb0d053992ec0506e33b6d3e811c790474`. The existing approved design remains in force. No purple changes, live installation/restart, merge or push. Parent re-review remains required.

### Vertical plan and root causes

1. **Failed metadata recovery — `src/App.tsx`, browser recovery tests.** The metadata catch enabled the draft with empty hydrated state. Autosave then treated failure as deliberate removal and replaced saved ID/role selections with `[]`; its success message erased the warning. Keep unresolved selections separate from display metadata, persist them while text is edited, and block sending/new attachments/reuse until retry or explicit discard for reupload. Retry only metadata, never replay the draft/Build. Reset and invalidate requests on project/controller changes and discard. Guard errors as well as successes, including A→B→A.
2. **Verified raster acceptance — `server/attachments.mjs`, `server/raster-decoder.mjs`, safe preview error.** Signatures did not establish that any pixel could decode; a complete 2001×1 raster also bypassed normalized-frame bounds. Discover existing libraries first (sharp/pngjs/jpeg-js/canvas absent), then use the existing installed Chrome/Chromium sandbox and CDP/proxy infrastructure. Header reads are allocation preflight only. Native WebCodecs `ImageDecoder` must decode every complete frame successfully. PNG container CRC and standard, streaming Node zlib verification are additional checks because actual Chrome probes tolerated damaged CRC/Adler checksums, including later APNG frames. No handwritten pixel decoder is used.
3. **Restaging layout — existing public-location helper and tests.** A static mirror creates `public/`; treating that side effect as a framework decision changed the same asset's URL/path and created two extra copies. Reuse the existing filename's original layout before consulting current project/framework state; retain byte-equality/no-follow preflight and the two existing serving copies. Do not add another metadata file or asset copy.

### Behavioral evidence (outside the repository)

All paths below are under `/Users/andresulistian/.hermes/cache/scratch/`.

| Slice | RED | GREEN / coverage |
| --- | --- | --- |
| Saved metadata JSON503 | `forge-review-recovery-red.log`: saved reference ID/role replaced with `[]` | `image-recovery.smoke.mjs`: text edit/server readback retains selection; private preview200; persistent retry/reupload warning; metadata-only retry retains current text and role; no message or active run |
| Actual HTTP503 and controller race | `forge-review-head-ui-red.log`: same lost selection with CDP HTTP503; stale A→B→A failure warned on a newer controller | Original HEAD App was temporarily rebuilt only in the disposable worktree and immediately restored. Final browser gate verifies scoped drafts and ignores stale failure; explicit discard invalidates a pending successful retry |
| Signature-only PNG | `forge-review-raster-red.log`: eight-byte PNG accepted200 | NEW uploads and legacy private reads reject it400; valid raster succeeds |
| PNG checksums/pixels | `forge-review-raster-corrupt-red.log`: corrupt CRC accepted200; `forge-review-raster-all-green.log` records subsequent Adler-checksum RED | Bad CRC, malformed/truncated zlib, bad Adler, invalid filter, insufficient pixel rows and missing PNG terminator all reject in upload and legacy preview |
| Animated compression | `forge-review-raster-animation-red.log`: later APNG Adler corruption accepted200 | Native decoding plus separately bounded standard zlib checks cover later frames too |
| Frame dimensions/bytes | `forge-review-raster-bounds-red.log`: valid2001×1 and >2,900,000-character frame accepted200 | Width and height limits for PNG/JPEG, upload and legacy preview; helpful reupload error; originals stay separate and unchanged, including a valid exact12MB PNG |
| Stable restaging | `forge-review-restage-red.log`: repeat changes `/assets/forge-uploads/…` to `/forge-assets/…` | Exact same URL/path/two-copy count after repeat and real manifest changes, both directions. `forge-review-restage-vite-green.log` additionally starts actual installed Vite on the disposable project and reads identical bytes200 through the original static URL |
| Decoder lifecycle/security | `forge-review-raster-shutdown-red.log`: shutdown leaves an owned Chrome live; `forge-review-raster-env-red.log`: actual spawn inherits a Forge-prefixed sentinel | Shutdown drains/cancels decoding and closes its owned sandbox before process exit. Decoder child gets only PATH and its private HOME/TMPDIR. Real spawn is instrumented, not replaced with a fake decoder |

The old 1×1 test PNG fixtures had incorrect IDAT CRCs. Only their checksum bytes were corrected; pixel payloads, transparency, dimensions and image intent remain unchanged. This is not a weakening of malformed-image assertions.

### Decoder boundaries and prerequisite

- No new package/dependency or installation: package manifests/lockfile are unchanged. Verification uses installed Chrome `154.0.8037.94` on macOS; Linux discovery paths are included but not exercised here.
- Chrome/Chromium with native `ImageDecoder` support is now required for accepting or serving uncached rasters. If unavailable or unsupported, fail closed with a retry/install-browser explanation; never fall back to signature-only acceptance. No user profile or Keychain is accessed.
- PNG/JPEG normalized frames: at most1600 per dimension and2,900,000 base64 characters. Original PNG/JPEG/WebP/GIF: at most12MB,32768 per dimension and40 million pixels. Animated inputs are limited to128 frames and40 million aggregate logical pixels. Oversized inputs reject; the server does not normalize them.
- One native decoder at a time, at most16 waiting validations, and at most64 successful content hashes (no source bytes retained in the cache). PNG inflation discards expanded data and stops at the dimension-derived RGBA16/Adam7 bound. Compression verification has a shared5-second deadline; native decoding has its own5-second deadline and terminates the owned browser on timeout/failure.
- Private scratch profiles, default Chrome sandbox (no `--no-sandbox`), basic password store/mock Keychain, no shell, no input-controlled executable/URL. A loopback-only constant empty CSP document provides the secure context. The exact-origin proxy denies all other browser-wide traffic, CONNECT and upgrades; after initialization CDP denies every page/worker request. Untrusted image bytes are only a base64 byte-array argument to the native decoder, never HTML/script content.
- Auth, strict project/ID storage guards, no-store, nosniff and reference-only privacy remain covered by the HTTP suite. Legacy corrupt/oversized previews fail safely and advise reupload; no private data migration is performed.

Primary standards/source snapshots were retrieved into scratch, not vendored or copied as a decoder:

```text
https://w3c.github.io/webcodecs/        (native complete-frame decoding/resource release)
https://www.w3.org/TR/png-3/           (PNG/APNG framing and specified CRC algorithm)
https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/image-decoders/image_decoder.h
```

### Final gate and limitations

`npm run check` (lint, all Node tests, TypeScript/Vite build) and the full five existing browser suites plus `image-recovery.smoke.mjs` and `image-raster.smoke.mjs` are run again after changes. Final logs: `forge-review-fix-final-check.log`, `forge-review-fix-final-browser.log`; parsed totals and decoder-process readback: `forge-review-fix-final-verification.json`. Added-line/untracked-source security and dependency gate is recorded before staging in `forge-review-fix-security-gate.json`; production dependency audit and full-tree scanner are in `forge-review-security-full.json`. `git diff --check` is required before commit.

The full-tree scanner still reports only the two unchanged fixture findings in `tests/recovery.test.mjs` and `tests/web.test.mjs`; production dependency audit reports no findings. No manifest/lockfile change or new dependency. The unchanged large Monaco/Vite chunk warning remains. An initial concurrent seven-suite browser run exposed a2-second Chrome startup metadata HTTP deadline; this was increased to the existing5-second startup budget without relaxing the native decode deadline, and the full concurrent suite was rerun successfully. Decoder shutdown was then hardened and every final gate rerun. The owned scratch decoders from earlier probes were terminated by exact captured PIDs/profile paths; readback records zero remaining owned decoders. No personal browser or live Forge process was stopped.

Fixtures prove transport, decodability, bounds, privacy, persistence and rendered integration only—not production AI semantic image judgment. Provider fixtures remain local; no real paid/model call or cloud credential operation. The parent independently re-reviews this commit before any merge/installation.
