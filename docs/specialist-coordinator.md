# Specialist coordinator: implementation and validation

## Scope and source

Built against `81c9871e582593d1290424928392085b18066a37` (Forge 0.9.0).
The installed Mac workspace was not accessed or proven identical. This branch is
not an installer, does not modify `main`, and must not replace an unexamined local
working copy. Preserve local commits and uncommitted changes before applying it.
Do not copy `.forge`, `.env`, credentials or provider settings from another build.

`provider-agents.mjs` and `kanban-store.mjs` retain the original adapter and store
implementations byte-for-byte. Their public facades now add coordination and
strict completion gates. UI, uploads, preview, checkpoint, notification and
deployment code are not replaced by this change.

## Executed workflow

The Kanban start operation computes a versioned plan using `planSpecialists`,
persists it, and binds that exact plan to the active project/run. The Agents facade
consumes that binding, not a second independent routing decision. Direct internal
calls without a Kanban binding use Balanced routing.

Routing is deterministic keyword/scope classification, not a learned planner.
Small work uses one appropriate specialist. Cross-layer work can run Explorer,
Backend, Frontend and independent Reviewer. Economy uses one writer and no AI
reviewer; actual test execution and human acceptance still apply. Writers are
sequential and pass bounded reports to each other. Read-only roles use the
provider's existing Plan restrictions. Frontend/backend ownership guidance is
not an OS-enforced per-file access-control boundary.

Codex and OpenRouter use separate role sessions with the same explicitly selected
model. Native Codex sub-agent support is not required. Existing runtime adapters,
workspace permissions, media handling and write approvals are reused. Single
Agent mode keeps its existing execution path. Gemini and local AI remain single
agent. There is no provider/model fallback, no new API key, and no configuration
migration. ViKey is rejected at the Agents facade; removed local ViKey settings
are not recreated. Historical adapter implementation and adapter-only tests are
retained rather than rewriting unrelated integrations.

## Evidence and completion

After writing, Forge asks permission to execute declared `lint`, `test` and `build`
scripts. `test` is mandatory. The runner captures real exit codes/output, strips
obvious token patterns, uses a restricted child environment, and checks that the
manifest did not change after approval or during the checks. It does not install
dependencies or run deploy commands. Project scripts execute local code with the
user's permission; the runner is not an OS sandbox.

The Reviewer must return strict JSON covering every acceptance criterion exactly
once with a status and evidence. Missing/unverified evidence cannot produce PASS.
A PASS is a model assessment backed by the supplied code and test results, not a
formal correctness or security proof. Browser/visual correctness is not invented:
when necessary evidence is unavailable the Reviewer must block. The existing
manual visual workflow remains available; it is not automatically driven here.

Failed checks or a FIX verdict can return to the writers. Economy permits no
repair, Balanced one and Maximum two. BLOCK, declined approval, missing tests and
timeouts stop without extra repair calls. Limits on stage calls and retries are
hard; reported-token thresholds are best-effort and may overshoot by one provider
response or miss unreported usage. No exact monetary ceiling is claimed.

Only the parent workflow emits completion and a final chat message. Stage events
are remapped to the real project; retired session IDs suppress late completions.
Approvals survive state refresh through the facade and Stop cancels pending QA
approval and active work. Kanban cannot mark a managed task Done until workflow
checks/review passed, existing human Accept requirements are satisfied and the
normal post-Accept regression check (including `npm test`) passes again.

## Validation

Local verification runs the new deterministic/coordinator/check-runner tests and
facade protocol tests. Facade tests use controlled fake Codex/OpenRouter runtimes;
check-runner tests really execute npm scripts in disposable projects. No paid AI
calls were made. This is not a live-provider, Mac installation or visual smoke test.
The full repository check is specified in the pull-request CI workflow; its
result must be inspected separately, not inferred from the local subset.

Before installation: compare the real local source and provider settings, retain
its ViKey removal, apply the reviewed source change without restoring runtime
state, run `npm run check`, and smoke-test chat, image upload into preview, progress,
notifications, approvals, Stop, Kanban Accept/Undo, restart and security/deploy gates.
