# Phase 2 — Companies, Members, Auth & Apps

## Goal

Build the company/user/membership layer — everything needed to create a company, add members with roles and titles, control which apps a member can see data for, and authenticate both humans and external apps (like Lensoflow's backend, which will call this system's event ingestion API).

This phase has no AI logic at all. It's CRUD + auth + permissions plumbing. Get it exactly right — every later phase's security model depends on it.

This phase is self-contained. The schema below is what you're building against; no other document is required.

## Background

The system is multi-tenant: a `company` can own multiple `apps`. A single `user` can belong to multiple `companies` (one login, many memberships). Permissions work on two independent axes:

1. **`company_roles`** — fixed, global, four values only: `owner`, `admin`, `moderator`, `viewer`. Never editable. Never company-specific. No endpoint should ever allow creating, modifying, or deleting a row in this table — it is seeded once and stays that way permanently.
2. **`company_titles`** — flexible, per-company, e.g. "Founder", "CMO". Purely organizational/display metadata, zero security implications. A company can define its own beyond the seeded defaults (founder/cco/cmo/cto).

A member's actual data access is controlled separately via `company_member_app_access` (which apps within the company they can see data for) — this becomes critical once event/output data starts flowing in later phases, but build the table and the access-granting logic now even though nothing reads it yet.

## Relevant schema (already created in Phase 1, reproduced here for reference)

```
users: id, email, name, profile_url, created_at
companies: id, slug, metadata (jsonb), graph (jsonb), created_at
company_roles: id, slug, name, permissions (jsonb)
company_titles: id, company_id (nullable), slug, name, is_system
company_members: id, company_id, user_id, role_id, created_at
company_member_titles: member_id, title_id
company_member_app_access: member_id, app_id
company_members_auth: id, user_id, refresh_token_hash, totp_secret, totp_enabled, last_login_at, created_at
company_apps: id, company_id, slug, metadata (jsonb), graph (jsonb), created_at
company_api_keys: id, company_app_id, key_hash, metadata (jsonb), last_used_at, created_at, revoked_at
```

`company_apps.metadata` shape: `{ name, description, play_store_url, app_store_url, website_url }`
`company_api_keys.metadata` shape: `{ name, whitelisted_domains: string[] }`
`companies.metadata` shape: `{ name, description, website_url, allowed_domains: string[], restrict_to_allowed_domains: boolean }`

## What to build

### 1. Company management

- `POST /companies` — create a company. Accepts `slug`, `metadata`. Creates with empty `graph: {"agents":{},"roles":{},"tasks":{}}`.
- `GET /companies/:id` — fetch a company.
- `PATCH /companies/:id/metadata` — update metadata fields only. Never allow direct mutation of `graph` through this endpoint — that's reserved for Action-driven writes in later phases.

### 2. User & auth

- `POST /auth/signup` — create a `users` row + a `company_members_auth` row.
- `POST /auth/login` — validate credentials, issue a session/refresh token, update `last_login_at`.
- TOTP setup (`POST /auth/totp/enroll`) and verification (`POST /auth/totp/verify`) endpoints — standard TOTP flow (e.g. using `otpauth` or an equivalent library). Do not build TOTP-gated approval workflows yet (that depends on logic built in later phases) — just the enrollment/verification primitives.
- Refresh token rotation: validate `refresh_token_hash`, issue new tokens, invalidate old ones on use.

### 3. Company membership

- `POST /companies/:id/members` — add a user to a company. Requires a valid `role_id` — validate it's one of the four fixed `company_roles` rows, reject anything else.
- `POST /companies/:id/members/:memberId/titles` — assign one or more titles (writes to `company_member_titles`).
- `POST /companies/:id/members/:memberId/app-access` — grant access to specific apps (writes to `company_member_app_access`). If the company's `restrict_to_allowed_domains` is true AND the member's email domain doesn't match `allowed_domains`, reject the request.
- `GET /companies/:id/members` — list members with role, titles, and app access joined in.

### 4. Company apps

- `POST /companies/:id/apps` — create an app under a company. Accepts `slug`, `metadata`, `graph` (can be `{}` initially).
- `GET /apps/:id` — fetch an app.
- `PATCH /apps/:id` — update metadata or graph.

### 5. API keys

- `POST /apps/:id/api-keys` — generate a new key. Random secret (e.g. `vrtx_live_` + 32 random hex bytes), hash it (SHA-256 or equivalent), store ONLY the hash. Return the raw key in the response body exactly once. Accept `metadata: { name, whitelisted_domains }`.
- `DELETE /apps/:id/api-keys/:keyId` — revoke (set `revoked_at`, never hard-delete — preserve audit history).
- Build `authenticateApiKey(rawKey: string): Promise<{ appId: string } | null>` — hashes the incoming key, looks it up, checks `revoked_at IS NULL`, resolves to a `company_app_id`. This is what a later phase's event-ingestion endpoint will use to authenticate external callers. Build and test it now even though nothing calls it in this phase.

## Security requirements — non-negotiable

- `company_roles` must never be writable via any endpoint, in this phase or any future one.
- API key raw values are never stored, logged, or retrievable after the single creation response.
- Every endpoint that mutates company data must verify the calling user is actually a member of that company with sufficient role. Implement a `requireCompanyRole(minRole)` middleware now, even if full session/JWT handling is still minimal at this stage — the authorization check pattern needs to exist and be correct.

## Success criteria

- A company can be created, a user can sign up, be added as a member with `owner` role, verified via `GET /companies/:id/members`.
- An API key can be created for an app, shown once, and a subsequent request using it successfully authenticates via `authenticateApiKey`; a revoked or garbage key is rejected.
- Attempting to create a `company_roles` row via any code path is not possible — there is no endpoint for it.
- A member with a non-matching email domain is correctly rejected when `restrict_to_allowed_domains` is enabled on the company.
- `requireCompanyRole` correctly blocks a request from a user who isn't a member of the target company, and correctly blocks a `viewer`-role member from hitting an endpoint that requires `admin` or higher.

Confirm what you built and run through each success criterion explicitly.
