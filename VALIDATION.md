# Forge Web MVP validation

## Kanban implementation (2026-09-25)

- Source: Mac `forge-web-current.tar.gz`, 80 source files committed locally before implementation. GitHub backup branch `pre-kanban-backup-2026-09-25` commit `5672d08` verified with all 80 source hashes matching. The earlier GitHub repository contains six additional legacy files that were preserved on the backup branch.
- `npm run lint`: pass after excluding macOS AppleDouble metadata from lint and Git staging.
- `npm test`: 88/88 pass, including routing, persistence, usage accounting, Done gate, HTTP Kanban API, and existing provider/attachment/build/security regressions.
- `npm run build`: pass using compatible dependencies already present in this execution environment. The uploaded archive has no `node_modules`; a fresh Mac install should run `npm ci`.
- Live provider billing and live macOS UI/preview were not exercised here. If a provider omits usage or cost, the inspector clearly labels estimates or unavailable actual cost.
- Files added: `server/kanban.mjs`, `src/KanbanPanel.tsx`, `tests/kanban.test.mjs`. Existing files updated: `server/index.mjs`, `server/orchestrator.mjs`, `server/api-providers.mjs`, `src/App.tsx`, `src/styles.css`, `tests/http.test.mjs`, `tests/orchestrator.test.mjs`, `.gitignore`, `eslint.config.js`, `README.md`, `VALIDATION.md`.

The historical MVP notes below describe the earlier milestone and are not the current test count.

## Automated checks

- ESLint: pass.
- Node test suite: 32/32 pass.
- TypeScript + Vite production build: pass.
- Monaco editor and JSON/CSS/HTML/TypeScript workers: emitted as local build assets.

## Covered behavior

- Localhost token auth, Host/Origin checks, project creation, and preview lifecycle.
- File traversal/symlink/secret protection and stale manual-edit detection.
- Automatic checkpoint and safe restore behavior.
- Ask/Plan/Build enforcement and approval fail-closed behavior.
- Codex, Gemini, and Ollama routing, model selection, attachments, and memory.
- Claude/OpenRouter credential separation and streamed Ask response.
- GitHub repository identifier validation.
- MCP project scope, no-shell stdio spawn, handshake, and capability discovery.
- Deploy config validation and safe static staging.
- Production companion smoke test: create project and run an approved terminal command with exit code 0.

## Known MVP boundaries

- API-key providers currently support Ask/Plan, not autonomous Build.
- MCP tools are discovered and catalogued; automatic agent tool calls await the per-tool approval milestone.
- Secure credential persistence currently targets macOS Keychain.
- This is a personal localhost app, not a hosted multi-user service.
