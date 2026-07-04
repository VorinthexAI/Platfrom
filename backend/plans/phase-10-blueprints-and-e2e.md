# Phase 10 — Blueprints, Company Instantiation & End-to-End Verification

## Goal

Build the blueprint system that lets a new company be instantiated with a fully working Agent/Role/Task setup in one action, and run a complete end-to-end verification of the entire platform.

This phase is self-contained.

## Background

A blueprint is a reusable, self-contained starter configuration — applying it to a new company COPIES the structure with brand-new IDs, never links to the original. Later changes to a blueprint never propagate to companies that already used it.

## Relevant schema (from Phase 1)

```
blueprints: id, type ('agent'|'role'|'task'), graph (jsonb), metadata (jsonb), created_at
```

A blueprint's `graph` shape uses SLUGS for internal references (not cuids, since it has no live cuids of its own yet), illustrated below:

```json
{
  "agent": {
    "slug": "AGENT_CMO",
    "objectives": "string",
    "allowed_modes": ["consult_agents", "delegate_to_agents", "query_insights", "..."]
  },
  "managers": [
    {
      "slug": "MANAGER_CMO_CONTENT",
      "assignment": "string",
      "roles": ["ROLE_STORY", "ROLE_INGEST_OUTPUTS"]
    }
  ],
  "roles": [
    {
      "slug": "ROLE_STORY",
      "cadence": "daily",
      "concurrency": 10,
      "tasks": [
        { "slug": "TASK_PREPARE_MISSION", "actions": ["ACTION_FETCH_S3_CONTEXT", "ACTION_AI_GENERATE", "ACTION_ENRICH"] },
        { "slug": "TASK_DISCOVER_SUBREDDITS", "actions": ["ACTION_RESEARCH", "ACTION_COUNCIL"] }
      ]
    },
    {
      "slug": "ROLE_INGEST_OUTPUTS",
      "cadence": null,
      "concurrency": 1,
      "tasks": [
        { "slug": "TASK_INGEST_OUTPUT_ARTIFACT", "actions": ["ACTION_SAVE_OUTPUT", "ACTION_EMBED"] }
      ]
    }
  ]
}
```

Note the difference from a live company's `graph` (Phase 1): the blueprint uses manager role slugs for cross-references because it has no real cuids yet. Resolving slug references into real cuids during copy is the core logic this phase must implement correctly.

`ACTION_CREATE_COMPANY` (stubbed in Phase 3) is where this resolution logic belongs.

## What to build

### 1. Blueprint application logic

Fully implement `ACTION_CREATE_COMPANY`'s blueprint-copying behavior:

1. Accept an optional `blueprint_id` (or `blueprint_ids: string[]` — a company might apply multiple blueprints, e.g. a CMO blueprint and a separate CTO blueprint, both writing into the same new company's graph).
2. Read the blueprint's `graph`.
3. Generate entirely NEW cuids for every agent/role/task it contains.
4. Resolve all internal slug-based references (e.g. `managers[].roles`) into the newly-generated cuids — the final structure written to the new company's `graph` must use real cuids throughout, matching the live-graph shape from Phase 1, with zero leftover slug references.
5. Confirm `allowed_modes` is copied verbatim, never empty, never inferred — exactly what the blueprint specified, since this is a security-critical field that must never be left to be filled in after the fact.
6. Verify independence after copying: changes to the original blueprint row must never affect any company that already used it — there should be no foreign key or live reference from a company's graph entries back to the blueprint row.

### 2. `POST /companies` with blueprint support

Extend the company creation endpoint (Phase 2) to accept optional `blueprint_ids: string[]`. Each is applied via the logic above, in sequence, writing into the same new company's `graph`.

### 3. Seed three example blueprints

Insert three blueprint rows to validate the system against realistic shapes (use the JSON shape from the Background section above as the pattern):

1. A **CMO content blueprint** — an agent with `allowed_modes` covering communication + content-reading modes, owning `MANAGER_CMO_CONTENT`, which owns `ROLE_STORY` (with the full task chain from Phase 8) and `ROLE_INGEST_OUTPUTS`.
2. A **CTO platform blueprint** — an agent with `allowed_modes` covering `build_agent`, `edit_agent`, `rate_agent`, `list_agents`, `review_role`, owning a Manager that owns `ROLE_APPROVAL_REVIEW` with a single review task.
3. A **CDO analytics blueprint** — an agent with `allowed_modes` covering `query_events`, `query_insights`, `consult_agents`, with no roles included (built to be extended per-company later — demonstrates that a blueprint doesn't need to be fully populated to be valid).

### 4. Test company creation from blueprints

Using the blueprint system, create a second company end-to-end by applying the CMO and CTO blueprints together. This is itself a correctness test — any bug in the slug-to-cuid resolution will surface here.

### 5. Full end-to-end verification

Run through this complete scenario as a single integration test, touching the whole system:

1. Create a company via blueprint(s).
2. Create an app under that company, generate an API key.
3. POST a brand-new, never-seen event slug using that key — confirm it lands as `draft`.
4. Have the company's CTO agent review and promote that event type.
5. Manually trigger `ROLE_STORY` for the company and confirm it runs through its full task chain.
6. Confirm `ROLE_INGEST_OUTPUTS` automatically fires afterward and produces real rows in `company_outputs` with correct relations.
7. As a member with restricted `allowed_app_ids` (access to only one of two apps in the company), query events/outputs via an agent and confirm the OTHER app's data never appears anywhere in the response.
8. Confirm an agent-created Task can only reference Action slugs already present in `ACTION_HANDLERS`, and that an unknown slug is rejected.
9. Confirm the entire sequence required zero manual SQL and no runtime-generated source code.

### 6. Documentation

Write a single `README.md` at the repo root covering:
- The Agent → Manager → Role → Task → Action hierarchy, in plain language.
- How to create a new company from a blueprint.
- How to add a new Action manually through code review and deploy vs. how to add a new Task/Role as pure data.
- The security model in one paragraph (the three layers: `allowed_modes`, `allowed_member_ids`, `allowed_app_ids`).
- Local dev setup instructions (env vars, running migrations/seed, starting the dev server).

## Success criteria

- The full 9-step end-to-end scenario runs successfully without manual intervention beyond intentional human review of deployed code changes.
- A second company, created via blueprints, is fully independent and provably isolated — no event, output, or agent thought from company A is ever visible to company B under any circumstance.
- The `README.md` is accurate and complete enough that a developer returning to this code months later could understand the system without needing additional context.

This is the final phase. Confirm what you built, report the full end-to-end test results step by step, and flag anything across the whole build that still needs follow-up or wasn't fully verifiable in this environment (e.g. anything requiring real AWS credentials).
