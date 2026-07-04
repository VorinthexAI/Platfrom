# Phase 1 — Repo Setup, Database Schema & Infrastructure Foundation

## Goal

Create the `backend` repository, the complete database schema, the AI provider abstraction layer, and the full infrastructure foundation — copied directly from Lensoflow's already-proven setup, not reinvented. Nothing executable beyond migrations and seeds in this phase — pure foundation.

This phase is self-contained. Everything you need to know is in this document.

## Background

This is **Vorinthex** — a platform that runs AI-driven admin, content generation, and marketing operations for one or more companies (starting with Lensoflow). The system is organized as a strict hierarchy:

- **Agent** — the intelligent decision-maker. Thinks, delegates, never executes directly.
- **Role** — an orchestrator owning a set of Tasks, decides which to run for a goal.
- **Task** — a deterministic, ordered sequence of Actions. No reasoning, just runs Actions in order.
- **Action** — the atomic, hardcoded primitive. One thing, one input, one output. Actions never call other Actions directly in code.

Tasks, Roles, and Agents are pure data (rows/JSONB), buildable through conversation with zero deploys. Actions are the only hardcoded, code-deployed layer.

Multi-tenancy: everything is scoped under a `company`, which can own multiple `apps` (e.g. Lensoflow, and later other products). A single Agent serves an entire company across all its apps — NOT one Agent per app — which is why strict app-level data scoping is enforced everywhere downstream (built in a later phase, but the schema below already supports it).

## Part 1 — Copy Lensoflow's infrastructure pattern

Before writing anything new, go read Lensoflow's actual infrastructure setup, located in the documents folder at `lensoflow/backend`. Study these specifically:

- The Dockerfile (multi-stage build pattern: deps / dev / runtime stages)
- `deploy/docker-compose.*.yml` files
- The PgBouncer setup (connection pooling configuration)
- The Redis + BullMQ wiring
- The S3 client configuration
- The Caddy reverse-proxy + blue-green deploy script pattern
- `package.json` for the exact dependency versions already proven to work together

**Important constraint, different from Lensoflow**: Lensoflow has a `stage` + `prod` environment split. Vorinthex only needs **`dev`** and **`prod`** — no separate staging tier. Adapt the compose files and CI accordingly (drop anything stage-specific, keep the dev/prod distinction).

**Important constraint, different from Lensoflow**: Lensoflow runs three roles (`app`, `admin`, `render`) across two boxes. Vorinthex runs **two roles only**: `app` (the single API + orchestration role, no separate admin split) and `render` (a worker role for heavy async jobs — rendering, long-running generation tasks). Same microservice philosophy (one Docker image, role selected via `ROLE` env var + CMD override), just a smaller topology.

Copy directly, adapting only where the dev/prod and two-role differences require it:
- The multi-stage Dockerfile structure
- The PgBouncer configuration
- The Redis/BullMQ setup
- The S3 client setup
- The Caddy + blue-green deploy script pattern
- The LocalStack config for local dev (copy as-is if Lensoflow has one — same approach applies here)

## Part 2 — Repo structure

```
backend/
  src/
    api/                  # routes, agent execution entrypoint (Phase 5+)
    core/
      actions/            # Phase 3+
      modes/              # Phase 4+
      ai-providers.ts      # build in this phase, see Part 4 below
    db/
      schema.ts            # Drizzle schema matching Part 3 below
      migrations/
      seed.ts               # see note on seed data below
    lib/
      s3.ts
      queue.ts              # BullMQ setup
      db.ts                 # Postgres client + PgBouncer connection
  deploy/
    Dockerfile
    docker-compose.dev.yml
    docker-compose.prod.yml
    Caddyfile
    deploy-app.sh
    ownership.json
  package.json
  tsconfig.json
  .env.example
```

## Part 3 — Database schema

Implement the following 18 tables using Drizzle ORM. Use the exact table names and column names below. Every foreign key must be a real FK constraint — never a column that merely shares a name with another table's primary key.

### `users` (global identity, not company-scoped)
```
id              text primary key
email           text not null, unique index
name            text
profile_url     text
created_at      timestamptz not null default now()
```

### `companies` (root tenant entity, no prefix — same reasoning as `users`)
```
id              text primary key
slug            text not null, unique index
metadata        jsonb not null default '{}'
graph           jsonb not null default '{"agents":{},"roles":{},"tasks":{}}'
created_at      timestamptz not null default now()
```
GIN index on `graph`.

`metadata` shape:
```json
{
  "name": "string",
  "description": "string",
  "website_url": "string",
  "allowed_domains": ["string"],
  "restrict_to_allowed_domains": false
}
```

### `company_roles` (FIXED, GLOBAL, seeded once — never editable, never company-specific, never API-writable)
```
id              text primary key
slug            text not null unique     -- 'owner' | 'admin' | 'moderator' | 'viewer'
name            text not null
permissions     jsonb not null default '{}'
```

### `company_titles` (seeded globals + per-company extensions)
```
id              text primary key
company_id      text references companies(id) on delete cascade   -- NULL = global seed
slug            text not null
name            text not null
is_system       boolean not null default false
```
Index on `company_id`.

### `company_members`
```
id              text primary key
company_id      text not null references companies(id) on delete cascade
user_id         text not null references users(id) on delete cascade
role_id         text not null references company_roles(id)
created_at      timestamptz not null default now()
```
Indexes on `company_id` and `user_id`.

### `company_member_titles` (many-to-many)
```
member_id       text not null references company_members(id) on delete cascade
title_id        text not null references company_titles(id) on delete cascade
primary key (member_id, title_id)
```

### `company_member_app_access` (many-to-many — which apps a member can see)
```
member_id       text not null references company_members(id) on delete cascade
app_id          text not null references company_apps(id) on delete cascade
primary key (member_id, app_id)
```

### `company_members_auth` (auth lives at USER level, not per-membership)
```
id                    text primary key
user_id               text not null references users(id) on delete cascade
refresh_token_hash    text
totp_secret           text
totp_enabled          boolean not null default false
last_login_at         timestamptz
created_at            timestamptz not null default now()
```
Index on `user_id`.

### `company_apps`
```
id              text primary key
company_id      text not null references companies(id) on delete cascade
slug            text not null unique index
metadata        jsonb not null default '{}'
graph           jsonb not null default '{}'
created_at      timestamptz not null default now()
```
`metadata` shape:
```json
{
  "name": "string",
  "description": "string",
  "play_store_url": "string|null",
  "app_store_url": "string|null",
  "website_url": "string"
}
```
`graph` shape (brand/product context, not a relationship graph despite the column name — same naming convention applied consistently across tables for the "large structured config blob"):
```json
{
  "tone_of_voice": "string",
  "target_audience": "string",
  "core_features": ["string"]
}
```

### `company_api_keys`
```
id              text primary key
company_app_id  text not null references company_apps(id) on delete cascade
key_hash        text not null      -- ONLY the hash is ever stored
metadata        jsonb not null default '{}'
last_used_at    timestamptz
created_at      timestamptz not null default now()
revoked_at      timestamptz        -- NULL = active
```
Index on `company_app_id`.
`metadata` shape: `{ "name": "string", "whitelisted_domains": ["string"] }`

### `company_event_definitions` (draft -> promote event catalog, per app)
```
id                  text primary key
app_id              text not null references company_apps(id) on delete cascade
slug                text not null
entity_type         text
category            text
schema              jsonb
status              text not null default 'draft'   -- 'draft' | 'active'
created_by_agent    text
promoted_at         timestamptz
created_at          timestamptz not null default now()
```
Unique index on `(app_id, slug)`. Index on `(app_id, status)`.

### `company_events` (append-only event log)
```
id              text primary key
role            text
slug            text not null
entity_type     text
category        text
data            jsonb
embedding       vector(1536)
created_at      timestamptz not null default now()
```
Indexes: `(role, created_at desc)`, `(category, created_at desc)`, `(slug, created_at desc)`, HNSW on `embedding`.

### `company_event_app_links` (normalized many-to-many, real FK — NOT a text[] array column)
```
event_id        text not null references company_events(id) on delete cascade
app_id          text not null references company_apps(id) on delete cascade
primary key (event_id, app_id)
```
Index on `app_id`.

### `company_outputs` (everything the system produces)
```
id              text primary key
type            text not null     -- 'OUTPUT_HOOK' | 'OUTPUT_IMAGE' | 'OUTPUT_POST' | etc
data            jsonb
storage_path    text
usage_count     integer not null default 0
embedding       vector(1536)
created_at      timestamptz not null default now()
```
Index on `(type, created_at desc)`, HNSW on `embedding`.

### `company_output_app_links` (same normalized pattern as events)
```
output_id       text not null references company_outputs(id) on delete cascade
app_id          text not null references company_apps(id) on delete cascade
primary key (output_id, app_id)
```
Index on `app_id`.

### `company_output_relations`
```
id                  text primary key
parent_output_id    text not null references company_outputs(id) on delete cascade
child_output_id     text not null references company_outputs(id) on delete cascade
relation_type       text not null   -- 'used_in' | 'generated_from' | 'rendered_as'
created_at          timestamptz not null default now()
```
Indexes on `parent_output_id` and `child_output_id`.

### `company_output_analytics` (append-only, deliberately lean)
```
id                  text primary key
output_id           text not null references company_outputs(id) on delete cascade
views               integer
engagement_rate     numeric
snapshot_at         timestamptz not null default now()
```
Index on `(output_id, snapshot_at desc)`.

### `blueprints` (reusable starter configs, copied + re-id'd on use, never linked)
```
id              text primary key
type            text not null    -- 'agent' | 'role' | 'task'
graph           jsonb not null
metadata        jsonb not null default '{}'
created_at      timestamptz not null default now()
```

### Note on `companies.graph` internal shape

This JSONB blob holds the live Agent/Role/Task structure for a company. Build the Drizzle types to support this shape (TypeScript interfaces, not enforced at the DB level beyond being valid JSONB):

```json
{
  "agents": {
    "<cuid>": {
      "slug": "string",
      "name": "string",
      "objectives": "string (plain text, up to ~1000 words is fine)",
      "allowed_modes": ["string"],
      "allowed_member_ids": ["string"],
      "managers": ["<cuid>"],
      "active_run_count": "number",
      "total_run_count": "number",
      "created_at": "ISO string"
    }
  },
  "managers": {
    "<cuid>": {
      "slug": "string",
      "name": "string",
      "assignment": "string",
      "used_by_agents": ["<cuid>"],
      "roles": ["<cuid>"],
      "active_run_count": "number",
      "total_run_count": "number",
      "created_at": "ISO string"
    }
  },
  "roles": {
    "<cuid>": {
      "slug": "string",
      "name": "string",
      "concurrency": "number",
      "active_run_count": "number",
      "total_run_count": "number",
      "cadence": "daily | weekly | hourly | null",
      "last_run_at": "ISO string | null",
      "used_by_managers": ["<cuid>"],
      "tasks": ["<cuid>"],
      "created_at": "ISO string"
    }
  },
  "tasks": {
    "<cuid>": {
      "slug": "string",
      "name": "string",
      "actions": [
        { "action_slug": "ACTION_X", "order": 1 }
      ],
      "active_run_count": "number",
      "total_run_count": "number",
      "used_by_roles": ["<cuid>"],
      "created_at": "ISO string"
    }
  }
}
```

### No seed data in this phase

Do not write example/seed rows. Just confirm the schema applies cleanly and supports the JSON shapes documented above. Seed only the four fixed global `company_roles` rows (owner/admin/moderator/viewer) — these are permanent system data, not examples, and the system cannot function without them.

## Part 4 — AI provider abstraction (`src/core/ai-providers.ts`)

Build a single file that centralizes every AI provider client the system can call. This is NOT model selection logic (that's a separate concern built in Phase 3) — this file only sets up the actual SDK clients/connections.

```typescript
// src/core/ai-providers.ts
//
// Single source of truth for every AI provider client. Add a new
// provider here once, every Action/mode that needs it imports from
// this file rather than instantiating its own client.

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// xAI / Grok — OpenAI-compatible API surface
export const grok = new OpenAI({
  apiKey: process.env.GROK_API_KEY,
  baseURL: 'https://api.x.ai/v1',
});

// Perplexity — OpenAI-compatible API surface, used for live web search
export const perplexity = new OpenAI({
  apiKey: process.env.PERPLEXITY_API_KEY,
  baseURL: 'https://api.perplexity.ai',
});

// Google (Gemini) — separate SDK shape
import { GoogleGenerativeAI } from '@google/generative-ai';
export const google = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? '');

export type ProviderName = 'anthropic' | 'openai' | 'grok' | 'perplexity' | 'google';
```

Add the corresponding env vars to `.env.example`: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROK_API_KEY`, `PERPLEXITY_API_KEY`, `GOOGLE_API_KEY`.

## Part 5 — Package list

Install and configure these dependencies (match versions to whatever Lensoflow's `package.json` already uses where there's overlap, to keep behavior consistent with proven infrastructure):

- **Runtime**: `bun` (use as the runtime/package manager, matching Lensoflow)
- **Web framework**: `hono`
- **Validation**: `zod`
- **ORM**: `drizzle-orm`, `drizzle-kit`
- **Database**: `postgres` (the `postgres.js` client, matching Lensoflow's existing driver choice)
- **Postgres extensions required**: `pgvector` (for embedding columns), confirm `CREATE EXTENSION IF NOT EXISTS vector;` runs in migrations
- **Connection pooling**: PgBouncer (infrastructure-level, copied from Lensoflow per Part 1 — not an npm package)
- **Queue**: `bullmq`, `ioredis`
- **Storage**: `@aws-sdk/client-s3` (or whatever S3 client Lensoflow already uses)
- **AI SDKs**: `@anthropic-ai/sdk`, `openai`, `@google/generative-ai`
- **Local dev**: LocalStack config copied directly from Lensoflow (Part 1)
- **Docker**: multi-stage Dockerfile, `docker-compose` for dev and prod

## Part 6 — The GIN index / JSONB write-locking pattern

Because `companies.graph` is a single large JSONB blob that gets both read frequently and mutated frequently (status updates, run counts), build and export a reusable locking helper now — every future phase that writes to `graph` will use this:

```typescript
// src/lib/db.ts (add this alongside the existing Postgres client setup)

export async function updateGraphSafely(
  companyId: string,
  mutateFn: (graph: CompanyGraph) => CompanyGraph
): Promise<void> {
  const tx = await pgClient.begin();
  try {
    const [row] = await tx`SELECT graph FROM companies WHERE id = ${companyId} FOR UPDATE`;
    const updatedGraph = mutateFn(row.graph);
    await tx`UPDATE companies SET graph = ${updatedGraph} WHERE id = ${companyId}`;
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}
```

This pattern (`SELECT ... FOR UPDATE` inside a transaction, explicit commit/rollback) is the only way `companies.graph` should ever be written to, anywhere in the codebase, in any future phase. It prevents two concurrent writers from silently overwriting each other's changes to the same company's structure. Pair this with a `statement_timeout` set on the Postgres connection (same value/pattern Lensoflow already uses) so a hung transaction can never permanently lock a company's graph.

## Success criteria

- `bun run db:migrate` creates all 18 tables with correct constraints, indexes, and the `vector` extension enabled.
- The four global `company_roles` rows exist after running the seed script, and re-running it doesn't duplicate them.
- `src/core/ai-providers.ts` exports working clients for all five providers, gated correctly behind env vars (missing keys shouldn't crash the app at import time, only when actually used).
- `updateGraphSafely` is implemented, exported, and has at least one test confirming two concurrent calls against the same `company_id` don't lose either mutation.
- Docker Compose can bring up `app` + `render` + Postgres + Redis + PgBouncer locally in dev mode, matching the simplified two-role topology described in Part 1.
- The repo structure matches Part 2 exactly, including empty `core/actions` and `core/modes` directories for later phases.

Confirm what you built, and explicitly flag anything from Lensoflow's infrastructure you couldn't access or had to approximate.
