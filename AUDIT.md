# Forge Web repository audit

Audit date: 19 September 2026.

## Starting point

The existing Forge v0.7 source was preserved as `/forge`. It already contained a mature React UI, local Node backend, Codex/Gemini/Ollama adapters, safe workspace operations, preview, approvals, checkpoints, deploy guidance, SQLite persistence, and 28 passing tests. The source archive did not include Git metadata, so its original branch and commit history could not be audited.

## Migration decision

The Tauri shell was removed only from the new `/forge-web` copy. The proven React UI and local backend were retained because they already matched the selected web-plus-local-companion architecture. Browser access now uses the existing tokenized loopback server directly.

## Current feature status

| Capability                   | Status                                      |
| ---------------------------- | ------------------------------------------- |
| Browser UI + local companion | Complete                                    |
| Project create/open          | Complete                                    |
| Chat + Ask/Plan/Build        | Complete                                    |
| Codex/Gemini/Ollama          | Complete at adapter level                   |
| Claude/OpenRouter settings   | Ask/Plan complete; Build pending            |
| Activity stream              | Complete                                    |
| Monaco code editor           | Complete, bundled locally                   |
| Approved project terminal    | Complete                                    |
| Live preview                 | Complete                                    |
| Approval flow                | Complete                                    |
| Git checkpoint/restore       | Complete                                    |
| SQLite history/config        | Complete                                    |
| GitHub import/export/backup  | Implemented through GitHub CLI              |
| MCP registry/test/discovery  | Complete; automatic tool invocation pending |

## Verification

- ESLint passed.
- 32/32 Node tests passed.
- TypeScript and Vite production build passed.
- Production companion smoke test created a project and ran an approved command successfully.
- Monaco editor and its language workers were emitted as local build assets.

Live account operations for Codex, Gemini, Anthropic, OpenRouter, and GitHub require the user's own local logins/credentials and were not invoked in this environment.
