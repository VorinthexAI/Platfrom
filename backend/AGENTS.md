# AGENTS.md

Guidance for AI coding agents (Codex CLI, Claude Code, etc.) working in this repository.

## Project

Vorinthex backend service. (Currently greenfield — update this section once the stack is chosen.)

- **Language / runtime:** _TBD_
- **Framework:** _TBD_
- **Package manager:** _TBD_

## Setup

```bash
# install dependencies
# <fill in once a package manager is chosen>
```

## Common commands

```bash
# run dev server
# <fill in>

# run tests
# <fill in>

# lint / format
# <fill in>

# build
# <fill in>
```

## Conventions

- Keep changes scoped and match the surrounding code style.
- Add or update tests for any behavior change.
- Don't commit secrets; use environment variables and a local `.env` (git-ignored).
- Validate every endpoint JSON payload and query parameter with Zod strict object schemas; reject unknown fields instead of silently accepting them.
- Keep all HTTP endpoints behind the env API key middleware and Redis-backed per-IP rate limiting unless a task explicitly changes that security model.

## Notes for agents

- Run the test suite before considering a task complete.
- Ask before introducing a new major dependency or framework.
- The git remote `origin` points to https://github.com/Vorinthex/Backend.git.
