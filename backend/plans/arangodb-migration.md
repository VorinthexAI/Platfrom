# ArangoDB Migration Plan

Plan for replacing the Postgres/Drizzle persistence layer with ArangoDB. Written after auditing the
current stack (see "Current state" below); status: **proposal, not started**.

## Current state (baseline)

- Bun + Hono + TypeScript. Postgres 16 (`pgvector/pgvector:pg16`) behind PgBouncer, accessed via
  Drizzle ORM (`drizzle-orm` + `postgres` driver). Schema: `src/db/schema.ts` (18 tables + migrations
  in `src/db/migrations/`).
- **No repository/DAL layer.** Drizzle queries are inlined directly in route handlers and domain
  files — ~107 call sites across ~39 files (`src/api/*.ts`, `src/core/actions/*.ts`,
  `src/core/modes/*.ts`, `src/admin/waitlist.ts`). The only shared helper is
  `updateGraphSafely()` in `src/lib/db.ts`.
- The domain-critical **Agent → Manager → Role → Task → Action graph is not relational at all** —
  it's one JSONB blob per company (`companies.graph`, typed `CompanyGraph` in `schema.ts:4-55`),
  mutated via a hand-rolled `SELECT ... FOR UPDATE` + transaction lock, with edges maintained as
  plain string-array fields (`managers: []`, `used_by_agents: []`, ...) in app code. This is
  literally emulating a graph database inside a JSON column — the strongest argument for Arango.
- `companyOutputRelations` is an explicit self-referential edge table (parent/child output +
  relationType) — another direct graph-native candidate.
- Real relational needs that don't map as cleanly: Polar payments/subscriptions/entitlements
  (financial correctness, partial unique index enforcing "one active entitlement per user+product",
  check constraints on enums, idempotency keys), and pgvector HNSW embedding search on
  `companyEvents`/`companyOutputs`.
- Primary keys are already app-generated CUID2 strings (`usr_...`, `cmp_...`), not DB serials —
  this maps cleanly onto Arango `_key` with no ID-scheme rewrite needed.
- **No DB integration tests exist today** — the 13 test files are pure unit tests on
  extracted logic (validation, graph-mutation helpers); nothing exercises Postgres in CI. This is a
  gap the migration needs to close, not inherit.
- No prior Arango work exists in this repo (checked `plan.md`, `polar.md`, `deploy.md`, `README.md`,
  all of `plans/`) — this is a fresh initiative.

## Guiding decisions

1. **Decouple before swapping.** Introduce a repository interface layer against the *current*
   Postgres backend first. This is valuable independent of Arango (today there's zero
   abstraction) and turns the DB swap into a per-module implementation swap instead of a
   rewrite-everything-at-once change.
2. **Strangler-fig, not big-bang.** Migrate module by module behind those interfaces, dual-write
   during transition, shadow-read to diff, then cut over. No flag-day rewrite of a system with zero
   existing DB test coverage and real financial data in it.
3. **De-risk the two unknowns before committing:** ArangoDB vector search parity with pgvector/HNSW,
   and how to express the partial-unique-index entitlement invariant without Postgres partial
   indexes. Both get a Phase 0 spike; either can fail and change downstream scope.
4. **Payments migrate last, and not without test coverage.** `payments.ts`'s DB-touching branches
   (`fulfillOrderPaid`, `grantEntitlement`) have zero test coverage today. Build tests for the
   current behavior before touching this module, so there's a correctness baseline to migrate against.

## Phase 0 — Spike & go/no-go

- Stand up ArangoDB locally (Docker) alongside the existing stack.
- Prototype `updateGraphSafely`'s lock/read/mutate/write pattern using an Arango JS transaction with
  exclusive collection locks, against the Agent/Manager/Role/Task domain expressed as real vertex +
  edge collections.
- Prototype the ABAC join in `query_events.ts`/`security.ts` (companyEvents ⋈ companyEventAppLinks ⋈
  companyEventDefinitions, companyMembers ⋈ companyRoles) as AQL graph traversals; benchmark against
  current query latency.
- Prototype vector similarity search using Arango's vector index against the `companyEvents`/
  `companyOutputs` embedding use case. **Decision point:** if parity is insufficient, plan to keep a
  dedicated vector store for embeddings (e.g. pgvector standalone) rather than forcing it into Arango.
- Prototype the "one active entitlement per user+product" invariant without a Postgres partial unique
  index — likely: keep it enforced transactionally in application code (the existing `grantEntitlement`
  logic in `src/api/security.ts` already reads-then-revokes-then-inserts inside a transaction; port that
  pattern rather than the index).
- Decide hosting: self-managed ArangoDB (own container, replaces Postgres+PgBouncer in
  docker-compose/terraform) vs. ArangoDB Oasis (managed; removes the SSH-tunnel migration complexity
  documented in `deploy.md`/`.github/workflows/deploy.yml` at the cost of a new vendor dependency).
- Output of this phase: a written go/no-go with any scope changes (e.g. "embeddings stay in Postgres").

## Phase 1 — Introduce a repository layer (still on Postgres)

- Define TypeScript interfaces per domain: `UsersRepo`, `CompaniesRepo`, `CompanyGraphRepo`,
  `EventsRepo`, `OutputsRepo`, `PaymentsRepo`, `AuthRepo`.
- Move the ~107 inline Drizzle call sites in `src/api/*.ts`, `src/core/actions/*.ts`,
  `src/core/modes/*.ts`, `src/admin/waitlist.ts` behind these interfaces, backed by the existing
  Drizzle/Postgres implementation. Behavior should not change; this is a pure refactor.
- This is the highest-leverage step regardless of DB choice, and lets each domain migrate to Arango
  independently later.

## Phase 2 — Arango data model design

- **Vertex collections:** users, companies, companyRoles, companyTitles, companyApps,
  companyApiKeys, authChallenges, products, paymentCheckouts, paymentOrders, subscriptions,
  userEntitlements, processedWebhookEvents, companyEventDefinitions, companyEvents, companyOutputs,
  companyOutputAnalytics, postRenders, blueprints, and — newly relational — agents, managers, roles,
  tasks, actions (promoted out of the `CompanyGraph` JSONB blob).
- **Edge collections** (replacing today's join tables and array-based back-edges):
  - `company_members` (user → company, props: roleId, createdAt) replaces `companyMembers`.
  - `member_titles`, `member_app_access` replace `companyMemberTitles`/`companyMemberAppAccess`.
  - `event_app_links`, `output_app_links` replace `companyEventAppLinks`/`companyOutputAppLinks`.
  - `output_relations` (companyOutput → companyOutput, prop: relationType) replaces
    `companyOutputRelations` directly — already modeled as a graph edge today.
  - `agent_manager`, `manager_role`, `role_task`, `task_action` replace the JSONB graph's forward
    edge arrays. **Back-edge arrays (`used_by_agents`, `used_by_managers`, etc.) can be deleted
    entirely** — Arango traverses inbound edges natively, removing a whole class of manually
    maintained state.
- **Multi-tenancy:** keep a single shared database with `companyId` on every relevant vertex/edge
  plus indexes on it (matches the current single-DB-with-FK approach), rather than a database per
  company — simpler ops, consistent with today's model.
- Replace SQL check constraints (status/type enums) with Arango collection-level JSON Schema
  validation.
- Replace the partial unique index on `userEntitlements` with the transactional invariant identified
  in Phase 0.

## Phase 3 — Tooling & infra

- Add `arangojs` driver; write `src/lib/arango.ts` mirroring `src/lib/db.ts` (client handle,
  transaction helper with collection locks, `closeDb` equivalent).
- Since there's no Arango equivalent of Drizzle, build a minimal code-as-config schema definition
  (`src/db/arango-schema.ts`: collections, indexes, edge/graph definitions) plus a small idempotent
  migration runner in `src/db/arango-migrations/`, numbered like the existing
  `src/db/migrations/0000..0013` — replaces `db:generate`/`db:migrate`.
- Add ArangoDB to `docker-compose.yml` for local dev (temporarily alongside Postgres during the
  transition).
- Update the CI migration job (`.github/workflows/deploy.yml`) to run the new migration runner;
  if going with Oasis, this also drops the SSH-tunnel-over-app-host complexity currently required
  for Postgres.
- Update Terraform for whichever hosting choice Phase 0 lands on.

## Phase 4 — Module-by-module cutover (dual-write → shadow-read → cutover)

For each module, in this order (lowest risk first):

1. `blueprints`, `companyEventDefinitions`, `companyOutputAnalytics` — low-traffic, no financial
   impact; a learning run for the dual-write/shadow-read mechanics.
2. The Agent/Manager/Role/Task/Action graph — the biggest structural win, and it already has
   pure-function test coverage (`applyAgentRunCountMutation`, `migrateGraphToManagerHierarchy` in
   `action-utils.test.ts`/`security.test.ts`) that can be adapted to assert identical behavior
   against the new vertex/edge model.
3. Events/outputs and their app-link + relation edges.
4. Users/auth (sessions, TOTP, magic links) and payments/entitlements/webhooks — highest risk,
   migrate last, gated on the new test coverage from the guiding decisions above.

Per module: implement the Arango-backed repository from Phase 1's interface, dual-write (Postgres
stays source of truth), shadow-read and diff outputs, flip reads over, stop writing to Postgres,
then drop those Postgres tables once confidence holds (keep an export first).

## Phase 5 — Testing & validation

- Build a DB integration test harness that didn't exist before (ephemeral Arango in CI).
- Add contract tests against each Phase 1 repository interface so the Postgres and Arango
  implementations can be verified against the same spec during transition.
- Load-test the ABAC security join path (runs on every request) and the events query path as AQL
  traversals against current latency baselines.
- Before migrating payments (Phase 4.4): add integration tests for `fulfillOrderPaid`,
  `grantEntitlement`, and the webhook idempotency path in `payments.ts`, since none exist today.

## Phase 6 — Decommission Postgres

- Remove `drizzle-orm`, `postgres`, `drizzle-kit`, `drizzle.config.ts`, `src/db/schema.ts`,
  `src/db/migrations/`.
- Remove Postgres + PgBouncer from `docker-compose.yml` and Terraform.
- Update `README.md`, `AGENTS.md`, `deploy.md` to describe the Arango-based architecture.
- Keep a final Postgres export/backup for a safe retention window before full teardown.

## Open risks to revisit

- Vector search parity (pgvector HNSW vs. Arango's vector index) — unresolved until Phase 0 spikes it.
- Entitlement uniqueness invariant needs to move from a DB constraint to app-enforced transactional
  logic — slightly weaker guarantee, mitigated by the existing transactional pattern already in use.
- No rollback net exists today (no DB test coverage) — the dual-write/shadow-read approach in Phase 4
  is the mitigation; do not shortcut it under schedule pressure.
- Hosting choice (self-managed vs. Oasis) changes Phase 3/6 scope materially — decide in Phase 0.
