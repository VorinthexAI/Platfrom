# Phase 6 — Action Library Governance

## Goal

Lock the Action library down as a fixed deployed code surface. New Actions and Modes are built manually by a human developer, reviewed through the normal repository workflow, and deployed as code. Agents may create and edit Agent/Role/Task data, but they must not generate, review, open pull requests for, or merge source code.

This phase defines the governance boundary for source-code changes.

## What to build

### 1. Remove autonomous source-code capabilities

- Do not expose Actions that clone repositories, read codebase context, invoke code-writing runtimes, self-review diffs, create pull requests, request external review, summarize pull requests, merge pull requests, or orchestrate that sequence.
- Do not configure a code-writing runtime server URL or client wrapper in provider setup.
- Do not keep repository API or token code that exists solely for autonomous source-code changes.
- Do not keep external review integrations that exist solely for autonomous source-code changes.

### 2. Keep CTO data-management capabilities

`AGENT_CTO` may retain modes for managing the Agent/Role/Task layer as pure data:

- `build_agent`
- `edit_agent`
- `rate_agent`
- `list_agents`
- `review_role`

These modes may assemble workflows from existing deployed Actions only. They must not assume that new Action slugs can appear at runtime without a manual code deploy.

### 3. Document the manual path

Document that Actions are added by editing `src/core/actions`, registering the handler in `src/core/actions/index.ts`, adding tests where practical, and deploying through the normal human-reviewed path.

## Success criteria

- `ACTION_HANDLERS` contains no autonomous source-code generation, review, pull request, or merge Actions.
- Provider setup contains no code-writing runtime server URL or client wrapper.
- The codebase has no repository token/API wrapper that exists only to support autonomous code changes.
- Phase docs and README content describe manual Action development only.
- Task creation still rejects unknown `action_slug` values, making the Action library explicitly fixed to the deployed handler registry.
