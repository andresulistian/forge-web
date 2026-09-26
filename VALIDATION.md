# Forge Web MVP validation

## Automated checks

- ESLint: pass.
- Node test suite: 68/68 pass.
- TypeScript + Vite production build: pass.
- Monaco editor and JSON/CSS/HTML/TypeScript workers: emitted as local build assets.

## Covered behavior

- Localhost token auth, Host/Origin checks, project creation, and preview lifecycle.
- File traversal/symlink/secret protection and stale manual-edit detection.
- Automatic checkpoint and safe restore behavior.
- Ask/Plan/Build enforcement and approval fail-closed behavior.
- Codex, Gemini, and Ollama routing, model selection, attachments, and memory.
- ChatGPT-style integrated composer regression: conversation, multiline input, attachment picker/chips, Ask/Plan/Build, Stop/Send, and message attachment display.
- Code, config, text, CSV, PDF, ZIP, image, video, audio, and link attachment parsing; Build staging under `.forge/attachments/`.
- Cumulative release guard verifies Guide, Browser Tests, Monitoring, Release History, Clear Workspace, Delete Project, approval hotfix, and OpenRouter Build markers.
- Claude/OpenRouter credential separation, streamed Ask response, and OpenRouter agentic Build with approval.
- OpenRouter Pro/Flash capability discovery plus link, web context, image, and audio forwarding.
- Project removal and Clear Workspace preserve files or move exact project folders to macOS Trash after typed confirmation.
- GitHub repository identifier validation.
- MCP project scope, no-shell stdio spawn, handshake, and capability discovery.
- Deploy config validation and safe static staging.
- Production companion smoke test: create project and run an approved terminal command with exit code 0.

## Known MVP boundaries

- Anthropic API currently supports Ask/Plan; OpenRouter Build requires a model that advertises tool calling.
- MCP tools are discovered and catalogued; automatic agent tool calls await the per-tool approval milestone.
- Secure credential persistence currently targets macOS Keychain.
- This is a personal localhost app, not a hosted multi-user service.
