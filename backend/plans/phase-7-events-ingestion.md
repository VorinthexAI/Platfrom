# Phase 7 — Events Ingestion API & Draft/Promote Flow

## Goal

Build the external-facing event ingestion endpoint — the API that Lensoflow's (and future apps') backend will call to push events into Vorinthex — plus the full draft → promote lifecycle that lets each company/app define its own event vocabulary with zero code deploys.

This phase is self-contained.

## Background

Events are pure data, scoped per app, never a hardcoded catalog. Any app can POST any event slug at any time. If it's not yet a recognized, promoted event type, it's saved as `draft` and simply doesn't appear in normal queries until reviewed and promoted — but the data itself is never lost or rejected.

## Relevant schema (from Phase 1)

```
company_event_definitions: id, app_id, slug, entity_type, category, schema (jsonb), status ('draft'|'active'), created_by_agent, promoted_at, created_at
company_events: id, role, slug, entity_type, category, data (jsonb), embedding (vector), created_at
company_event_app_links: event_id, app_id (real FK join table, not an array column)
```

`authenticateApiKey` (built in Phase 2) resolves an incoming API key to a `company_app_id` — never trust a client-supplied `app_id` in the request body.

`ACTION_REGISTER_EVENT_TYPE` and `ACTION_PROMOTE_EVENT` (built in Phase 3) operate directly on `company_event_definitions`.

`ACTION_EMBED` (Phase 3) computes embeddings.

## What to build

### 1. Event ingestion endpoint

`POST /events` — authenticated via `authenticateApiKey` middleware (resolves to `company_app_id`).

Request body: `{ slug: string, metadata?: object }`.

Logic:
1. Look up `company_event_definitions` for `(app_id, slug)`.
2. **Found, `status: 'active'`** — insert into `company_events` (role: null for external app calls, entity_type/category copied from the definition, data set to the metadata payload), link via `company_event_app_links`.
3. **Found, `status: 'draft'`** — still insert the event row (every observation is saved, even pre-promotion), but it remains invisible to normal `query_events`-style reads until promoted.
4. **Not found at all** — auto-create a new `company_event_definitions` row with `status: 'draft'` (first-seen), then proceed as step 3.

Always respond `200` quickly regardless of draft/active status — never reject an event for being unrecognized; that's the entire point of the draft mechanism. Save every individual observation as its own row — do not collapse repeated unrecognized events into a single row with a counter, the full history of observed payloads is what lets a reviewer correctly infer the right schema later.

### 2. Draft review endpoints

- `GET /apps/:id/event-definitions?status=draft` — list pending draft event types for an app, including a handful of recent sample payloads from `company_events` matching that slug, so a reviewer can see real examples.
- Wire `ACTION_REGISTER_EVENT_TYPE` / `ACTION_PROMOTE_EVENT` to be callable here (or via an agent's mode flow once that layer exists).

### 3. `query_events` mode — full implementation

Complete the `query_events` mode (stubbed in Phase 4) now that real event data flows through:

- Only returns events where the corresponding `company_event_definitions.status = 'active'` — draft events stay invisible to normal queries, even to agents, until promoted. This is intentional.
- Fully respects `allowed_app_ids` filtering (re-verify explicitly with real data now).
- Supports filtering by `period` (e.g. `last_1_hour`, `last_24_hours`, `last_7_days`), `category`, `slug`.

### 4. Embedding on promotion/ingestion

Compute and store an embedding (via `ACTION_EMBED`) on `company_events.embedding` whenever an active-status event is ingested. Draft events don't need embeddings computed — avoid the cost until something is confirmed worth tracking.

## Success criteria

- POST an event with a never-before-seen slug for an app's API key. Confirm: a new `company_event_definitions` row is created as `draft`, the event itself is saved in `company_events`, and `GET /apps/:id/event-definitions?status=draft` shows it with at least one observed payload example.
- Promote that event type. POST the same slug again. Confirm it now appears via `query_events` (it did not before promotion, even though rows existed in the database the whole time).
- Send 5 different events with the same not-yet-promoted slug. Confirm all 5 are saved as individual rows, not collapsed into one with a counter.
- Verify `allowed_app_ids` filtering with real ingested events: seed events for two apps under the same company, confirm a member restricted to one app only ever sees that app's events via `query_events`, even post-promotion.
- Test the API key rejection path: invalid/revoked key → `401`, no event row created at all (not even as a draft), since there's no resolvable `app_id`.

Confirm what you built and report results for each test.
