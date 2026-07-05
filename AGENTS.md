# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

Vorinthex platform monorepo with three top-level workspaces:

- `web`: Next.js app.
- `backend`: Bun backend service.
- `shared`: shared UI, brand, and library code used by web and backend.

## Setup

Install dependencies from the repository root:

```bash
bun install
```

Environment files live under `environments/`:

- `environments/.env.example`
- `environments/.env.dev`
- `environments/.env.prod`

Only `.env.example` files should be committed. `.env.dev` and `.env.prod` are local secret-bearing files and must stay ignored.

## Common Commands

```bash
bun run web:lint
bun run web:typecheck
bun run backend:check
bun run backend:test
```

Run app-specific commands through their workspace folders when needed:

```bash
bun run --cwd web dev
bun run --cwd backend dev
```

## Next.js

This repo uses a newer Next.js version with breaking changes. Before changing Next.js-specific APIs, conventions, or file structure, read the relevant guide in `node_modules/next/dist/docs/` and heed deprecation notices.

## Graphify

For codebase navigation questions, prefer `graphify explain` over broad `graphify query`.

Order:

1. Try `graphify explain "<most likely function/class/file/symbol>"`.
2. If no exact symbol is known, try `graphify explain "<likely file name>"`.
3. Use `graphify query` only when `explain` cannot identify a relevant node.
4. Use `rg` only for narrow source verification after Graphify identifies the relevant file or symbol.

## Conventions

- Keep changes scoped and match the surrounding code style.
- Add or update tests for behavior changes.
- Do not commit secrets. Use the ignored files under `environments/`.
- Keep shared code in the top-level `shared/` folder, not nested `web/src/shared` or `backend/src/shared`.
- Validate backend endpoint JSON payloads and query parameters with Zod strict object schemas; reject unknown fields instead of silently accepting them.
- Keep backend HTTP endpoints behind the env API key middleware and Redis-backed per-IP rate limiting unless a task explicitly changes that security model.

## Notes For Agents

- Run the relevant checks before considering a task complete.
- Ask before introducing a new major dependency or framework.
- This repo is its own monorepo; do not add git submodules for `web`, `backend`, or `shared`.
