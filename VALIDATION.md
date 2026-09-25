# Forge Web MVP validation

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
