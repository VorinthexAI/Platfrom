# Vorinthex Platform

Vorinthex is a Bun monorepo containing the Next.js web app, backend API, shared
packages, and mobile app.

## Workspaces

- `web/app`: public Next.js application.
- `backend`: API, persistence, business services, unified tools, and AI runtime.
- `shared`: shared libraries, brand assets, and UI components.
- `mobile/app`: mobile application.

## AI Architecture

- [Providers](backend/src/lib/ai/providers/README.md) implement external AI
  transports, normalize responses, and resolve environment configuration.
- [Actions](backend/src/lib/ai/actions/README.md) define reusable,
  provider-neutral AI operations and trusted execution options.
- [Tools](backend/src/lib/ai/tools/README.md) expose product-neutral business
  capabilities and converge with HTTP handlers on canonical domain services.

The broader routing overview is in
[backend/src/lib/ai/README.md](backend/src/lib/ai/README.md).

## Development

1. Install and unlock `git-crypt` for `.github/environments.json`.
2. Run `bun install` from this directory.
3. Use `bun run web:dev` or `bun run --cwd backend dev` for local development.

Common checks:

```sh
bun run web:lint
bun run web:typecheck
bun run backend:check
bun run backend:test
```
