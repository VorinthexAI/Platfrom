# Phase 3 — Core Actions Library

## Goal

Build the 26 core Actions — the only hardcoded, executable layer in the entire system. Tasks, Roles, and Agents (built in later phases) are pure data that reference these Actions by slug. Get this layer right and the rest of the system requires no further code deploys to extend.

This phase is self-contained.

## Background

**The one rule that matters most**: Actions never call other Actions directly in code. A Action file must never `import` and invoke another Action's handler function. Combining multiple Actions into a sequence is exclusively a Task's job — Tasks are data rows (built in Phase 5/8), not code.

The exception: a single Action CAN make multiple internal calls to the same underlying primitive (e.g. multiple LLM calls within one Action) if that's genuinely one atomic operation from the caller's perspective — judgment is required here, and the boundary is "does this look like composing two separate Actions" (not allowed) vs "is this naturally one operation that happens to need 2 steps internally" (fine).

Model selection is centralized: every Action that calls an LLM does so via `get_model({ category, level, override? })` (built as part of this phase, full spec below) — never hardcodes a model name directly.

## File structure

```
src/core/actions/
  enrich.ts
  embed.ts
  ai_generate.ts
  ai_search.ts
  council.ts
  research.ts
  get_model.ts
  generate_images.ts
  create_agent.ts
  create_role.ts
  create_task.ts
  append_task_to_role.ts
  create_manager.ts
  append_manager_to_agent.ts
  append_role_to_manager.ts
  create_company.ts
  register_event_type.ts
  promote_event.ts
  fetch_s3_context.ts
  write_s3_context.ts
  get_post_schema.ts
  save_output.ts
  search_output.ts
  validate_against_mission.ts
  index.ts
```

## `get_model.ts` — implement exactly as specified

```typescript
// src/core/actions/get_model.ts
//
// The ONLY place model selection is decided. Hardcoded and version-
// controlled deliberately — model choice is a code-reviewed change via
// the normal human-reviewed deploy path, never a runtime-mutable database
// value. No agent and no API endpoint can change which model runs.

type ModelCategory = 'reasoning' | 'coding' | 'fast' | 'image' | 'embedding';
type ModelLevel = 'xhigh' | 'high' | 'medium' | 'low';

const MODEL_DEFAULTS: Record<ModelCategory, Record<ModelLevel, string>> = {
  reasoning: {
    xhigh: 'anthropic/claude-opus-4-8',
    high: 'anthropic/claude-sonnet-4-6',
    medium: 'openai/gpt-5.1',
    low: 'anthropic/claude-haiku-4-5',
  },
  coding: {
    xhigh: 'anthropic/claude-opus-4-8',
    high: 'openai/gpt-5.1-codex',
    medium: 'openai/gpt-5-codex',
    low: 'openai/gpt-5-codex',
  },
  fast: {
    xhigh: 'anthropic/claude-sonnet-4-6',
    high: 'anthropic/claude-haiku-4-5',
    medium: 'openai/gpt-4o-mini',
    low: 'openai/gpt-4o-mini',
  },
  image: {
    xhigh: 'openai/gpt-image-2',
    high: 'google/nano-banana-pro',
    medium: 'google/nano-banana-pro',
    low: 'stability/sdxl',
  },
  embedding: {
    xhigh: 'text-embedding-3-large',
    high: 'text-embedding-3-small',
    medium: 'text-embedding-3-small',
    low: 'text-embedding-3-small',
  },
};

interface GetModelInput {
  category: ModelCategory;
  level?: ModelLevel;
  override?: string;
}

export async function get_model({
  category,
  level = 'medium',
  override,
}: GetModelInput): Promise<string> {
  if (override) return override;
  return MODEL_DEFAULTS[category][level];
}
```

Use `src/core/ai-providers.ts` (built in Phase 1) to actually resolve a model string like `'anthropic/claude-opus-4-8'` to a real provider call — `get_model` only decides WHICH model, it doesn't make the call itself.

## What to build — all 22 Actions

### Content / AI primitives

- **`ACTION_ENRICH`** — raw input + optional context → structured markdown (Core question, Full context, Scope, Ambiguities, Success criteria). Uses `get_model({ category: 'reasoning', level: 'high' })`.
- **`ACTION_EMBED`** — text → vector embedding, via `get_model({ category: 'embedding' })`.
- **`ACTION_AI_GENERATE`** — prompt + Zod schema → structured output validated against that schema. The most heavily used Action in the system — make error messages on schema validation failure clear and actionable.
- **`ACTION_AI_SEARCH`** — query + Zod schema → searches the web, analyzes results, returns structured output matching the schema.
- **`ACTION_COUNCIL`** — question + array of raw findings + Zod schema → synthesized consensus, using `get_model({ category: 'reasoning', level: 'xhigh' })`.
- **`ACTION_RESEARCH`** — orchestrates enrich → search → council internally as one atomic operation from the caller's perspective.
- **`ACTION_GET_MODEL`** — as specified above.
- **`ACTION_GENERATE_IMAGES`** — array of asset concepts (`{ prompt, style, mood, subject }`) → generated images, via `get_model({ category: 'image' })`.

### System building (write to `companies.graph` — use `updateGraphSafely` from Phase 1 for every one of these)

- **`ACTION_CREATE_AGENT`** — checks for an existing agent with a matching slug first (search before build, never duplicate). Requires `allowed_modes` to be provided — never create an agent without it. Generates a cuid, writes to `graph.agents`.
- **`ACTION_CREATE_MANAGER`** — same duplicate-check. Writes to `graph.managers`, initializing `assignment`, `roles: []`, `used_by_agents: []`, `active_run_count: 0`, `total_run_count: 0`.
- **`ACTION_CREATE_ROLE`** — same duplicate-check. Writes to `graph.roles`, initializing `concurrency`, `active_run_count: 0`, `total_run_count: 0`, `tasks: []`, `used_by_managers: []`.
- **`ACTION_CREATE_TASK`** — same pattern, writes to `graph.tasks`. Validates every `action_slug` in the provided actions array actually exists in `ACTION_HANDLERS` (this file's own index, see below) before saving — reject unknown slugs.
- **`ACTION_APPEND_TASK_TO_ROLE`** — adds a task cuid to a role's `tasks` array AND adds the role cuid to the task's `used_by_roles` array — bidirectional, both writes in the same transaction. Checks the link doesn't already exist first.
- **`ACTION_APPEND_MANAGER_TO_AGENT`** — same bidirectional pattern: agent's `managers` array AND manager's `used_by_agents` array updated together.
- **`ACTION_APPEND_ROLE_TO_MANAGER`** — same bidirectional pattern: manager's `roles` array AND role's `used_by_managers` array updated together.
- **`ACTION_CREATE_COMPANY`** — creates a `companies` row. Accepts an optional `blueprint_id` — if provided, reads the blueprint's `graph`, generates entirely new cuids for everything it contains, resolves slug-based manager/role/task references into the new cuids, and writes the result into the new company's `graph`. Without a blueprint, creates with empty `graph`.

### Events

- **`ACTION_REGISTER_EVENT_TYPE`** — writes a `company_event_definitions` row with `status: 'draft'` if one doesn't already exist for `(app_id, slug)`.
- **`ACTION_PROMOTE_EVENT`** — sets `status: 'active'`, `promoted_at`, `created_by_agent` on an existing definition row.

### S3 context

- **`ACTION_FETCH_S3_CONTEXT`** — generic: takes a `path`/`prefix`, reads one or more text files from S3, returns content. Used for brand config, role missions, anything stored as versioned markdown.
- **`ACTION_WRITE_S3_CONTEXT`** — generic write counterpart: writes a new datestamped file at a given path, append-only (never overwrites).

### Misc

- **`ACTION_GET_POST_SCHEMA`** — takes `platform`, returns the right Zod schema for that platform's post format (Reddit: `{title, body}`, TikTok/Instagram: `{caption}`). Only returns the schema — does NOT call `ACTION_AI_GENERATE` itself.
- **`ACTION_SAVE_OUTPUT`** — writes a row to `company_outputs` plus a `company_output_app_links` row per relevant `app_id`. Increments `usage_count` on related parent outputs if a relation is specified.
- **`ACTION_SEARCH_OUTPUT`** — semantic search against `company_outputs` via the embedding column, filtered by `type` and `app_ids` if provided.
- **`ACTION_VALIDATE_AGAINST_MISSION`** — content draft + mission summary → `{ aligned: boolean, reasoning: string }` via `get_model({ category: 'reasoning', level: 'high' })`.

## `index.ts`

```typescript
// src/core/actions/index.ts
//
// Single source of truth mapping ACTION_* slugs to handler functions.
// Actions are a fixed deployed library. New Actions are added manually
// through code review and deploy; no agent can add an entry at runtime.

import { enrich } from './enrich';
import { embed } from './embed';
// ... import every Action listed above

export const ACTION_HANDLERS = {
  ACTION_ENRICH: enrich,
  ACTION_EMBED: embed,
  // ... every Action, mapped to its handler
} as const;

export type ActionSlug = keyof typeof ACTION_HANDLERS;
```

## Success criteria

- All 22 Actions exist as separate files, each exporting a single async function with clear typed input/output (Zod schemas for structured data).
- `index.ts` exports `ACTION_HANDLERS` mapping every slug to its handler.
- `ACTION_CREATE_TASK` correctly rejects a task referencing an unknown action slug.
- `ACTION_CREATE_AGENT` / `ACTION_CREATE_ROLE` correctly detect and refuse to duplicate an existing entry with the same slug within a company.
- `ACTION_APPEND_TASK_TO_ROLE` / `ACTION_APPEND_MANAGER_TO_AGENT` / `ACTION_APPEND_ROLE_TO_MANAGER` write BOTH directions of the relationship in a single transaction, using `updateGraphSafely`.
- No Action file imports and directly calls another Action's handler function — verify this explicitly by grep-checking imports across the `actions/` directory.
- Write a test that creates an agent, a role, a task, links them via the append Actions, and reads back `companies.graph` to confirm the resulting structure matches the documented shape from Phase 1.

Confirm what you built, and flag any Action where you made a non-obvious implementation choice.
