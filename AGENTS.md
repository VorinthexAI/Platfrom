# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

Vorinthex platform monorepo. Top-level workspaces:

- `web/app`: the single Next.js app (the "universe" landing experience).
  `web/` itself is not a workspace — it's just the parent folder. The app
  builds to ONE container image (`vorinthex-web` in ECR). Production
  currently runs on the single-box early-infra stack (see Deployments
  below); the `vorinthex-prod-web` ECS service on the shared
  `vorinthex-production` cluster behind the ALB takes over once the
  cluster is provisioned. The only public hostname is `vorinthex.com`;
  `/api/v1/*` routes to the Bun backend and all other paths route to Next.js.
- `backend`: Bun backend service.
- `shared`: shared UI, brand, and library code used by the web app and
  backend.

## Setup

New machine, in order:

1. Install `git-crypt` (`brew install git-crypt` / `apt install git-crypt` /
   `choco install git-crypt`).
2. Get the git-crypt symmetric key from a teammate (out-of-band — Slack,
   password manager, however your team already shares it; there is no
   git/GitHub-mediated handoff for this).
3. Clone the repo, then unlock it: `git-crypt unlock <path-to-key>`.
4. `bun install` from the repository root.

All vars and secrets, for both dev and prod, live in one git-crypt-encrypted
file: `.github/environments.json` (`{ vars: {...}, secrets: { dev: {...}, prod:
{...} } }`, keyed per workspace — `vorinthex`, `web`, `backend`). It IS
committed (unlike the old per-workspace `.env.*` files it replaces) because
git-crypt encrypts it at rest; step 3 above decrypts your local working copy.
Never add a new plaintext env file — edit `.github/environments.json` directly
once unlocked.

Local dev tooling reads this file directly or generates a plain `.env.local`
from it via `bun run .github/scripts/write-local-env.ts <dev|prod> <section>
<outFile>` (see the `dev`/`start` scripts in `web/app/package.json` and
`backend/package.json`, which call it automatically).

## Common Commands

```bash
bun run web:lint
bun run web:typecheck
bun run web:build
bun run backend:check
bun run backend:test
```

Run app-specific commands through their workspace folders when needed:

```bash
bun run --cwd web/app dev
bun run --cwd backend dev
```

## Next.js

This repo uses a newer Next.js version with breaking changes. Before changing Next.js-specific APIs, conventions, or file structure, read the relevant guide in `node_modules/next/dist/docs/` and heed deprecation notices.

## Unified Tools And Actions

Every user-facing business capability for Archive, Gallery, Signal, Compass,
and Ascend has exactly one product-neutral entry in the public unified backend
tool registry. HTTP transports and Core may use separate transport or model
adapters, but every entry point must converge on the same canonical domain
service, operation, Content runtime, or provider-neutral action. Do not
duplicate business behavior across handlers and tool wrappers.

Before adding or changing API behavior, read the current registries and their
execution paths:

- `backend/src/lib/ai/tools/README.md` defines tools, registry ownership, and
  the required HTTP/Core-to-canonical-service layering.
- `backend/src/lib/ai/actions/README.md` defines provider-neutral AI actions
  and when an operation is an action rather than a tool.
- `backend/src/lib/ai/tools/index.ts` aggregates public tool names, validation
  schemas, provider definitions, and dispatch.
- `backend/src/lib/ai/tools/tool-definitions.ts` and
  `backend/src/lib/ai/tools/workspace-tool-definitions.ts` assemble the public
  tool registry.
- `backend/src/lib/ai/tools/content-schemas.ts` owns Archive Content Zod input
  and output contracts; `content-registry.ts` derives provider definitions,
  and `content-runtime.ts` validates and executes them.
- `backend/src/lib/ai/personal-assistant/capabilities.ts`,
  `service-capabilities.ts`, and `gallery-capabilities.ts` own Core surface
  allowlists, model-facing schemas, trusted-context injection, execution
  adapters, and workspace mutation metadata.
- Service or operation modules own canonical non-Content validation where
  applicable. HTTP-only transport schemas remain under `backend/src/api`.
- `backend/src/lib/ai/actions/index.ts` and
  `backend/src/lib/ai/actions/types.ts` own provider-neutral AI actions. Read
  them before adding a model-backed tool or changing model routing.

The required layering is:

```text
HTTP handler -----------------------------------\
unified tool definition / Core capability ------> canonical service / operation / Content runtime
trusted caller ---------------------------------/                    |
                                                                    v
                                                       repository and/or AI action
                                                                    |
                                                                    v
                                                                 provider
```

Public tool definitions and Core capabilities are thin adapters. They own
product-neutral names and model-facing input schemas; Core capabilities also
own trusted-context injection and workspace mutation metadata. HTTP handlers
own transport validation only. Canonical services, operations, the Content
runtime, and repositories own domain validation, authorization, invariants,
transactions, external side-effect recovery, and persistence. Do not duplicate
those rules in route handlers or tool adapters.

Every HTTP route must be classified as either a protocol boundary or a
business capability. Business capabilities, including CRUD operations, must
have exactly one product-neutral unified tool whose HTTP and Core adapters
invoke the same canonical domain service or operation. Do not add route-local
CRUD behavior. Protocol boundaries (authentication/session issuance, OAuth,
webhooks, SSE subscriptions, health checks, signed transfers, and provider
callbacks) are not model-visible tools; their post-authentication business
effects still use the canonical business layer.

For every new or changed API capability:

1. Search the unified tool registry first and extend an existing tool when its
   semantics already match.
2. Otherwise add one product-neutral dot-notation public registry entry with a
   strict Zod model-input schema and canonical service/runtime validation.
   Content tools must define strict Zod input and output contracts in
   `content-schemas.ts`; add output contracts elsewhere when the public contract
   requires one.
3. Never accept authenticated user identity, membership, or execution principal
   from model-visible input. Core capabilities must inject organization,
   runtime scope, membership, and request/idempotency context from the authorized
   `ToolContext`. HTTP APIs may accept organization, scope, or agent identifiers
   as untrusted selectors and must authorize them against the session. Canonical
   Content contracts may include scope selectors and idempotency keys, but must
   validate them against `ToolContext` rather than trust them.
4. Make HTTP and tool callers invoke the same canonical service/action method.
   Never call the local HTTP API from a tool.
5. Register model-visible mutations in the correct Core surface allowlist and
   declare workspace mutation metadata.
6. Update matching TanStack Query keys so direct API and Core-driven changes
   converge.
7. Add parity tests proving HTTP and tool/Core entry points reach the same
   canonical service, operation, or runtime and preserve the same authorization
   and business invariants. Transport schemas and response projections may
   intentionally differ. Also add strict-input, registry uniqueness/count,
   authorization, and service-level invariant tests.
8. Delete superseded handlers, adapters, schemas, aliases, tests, and dead
   business implementations in the same change. Do not retain a second path
   for compatibility without a concrete shipped consumer or persisted-data
   requirement.

Tools and actions are different. Tools expose business capabilities such as
`folder.create` or `email.draft.send`. Actions are reusable provider-neutral
AI primitives such as generation, reasoning, embedding, speech, or image
analysis. A model-backed tool may call an action, but ordinary database-backed
tools call canonical services/repositories directly. Never create public
generic database tools such as `database.insert`, `node.update`, or arbitrary
query execution; public tools must express domain intent and preserve domain
invariants.

Authentication/session issuance, OAuth handshakes, webhooks, SSE subscriptions,
and raw signed-byte transfers remain protocol boundaries rather than
model-visible tools unless a task explicitly establishes a safe design. Their
post-authentication business effects may call canonical tools where applicable.

## SEO / AEO

All public SEO, AEO, and GEO surfaces are generated from ONE source of truth:
`web/app/src/lib/discoverability.ts` (`PUBLIC_DISCOVERABILITY_REGISTRY` and
`PRODUCT_FACTS`). Page metadata, JSON-LD, the sitemap, and llms files derive
from it — edit the registry, not the routes.

When building or changing a feature, check whether these need updating and
keep them in sync:

- **Registry route fields**: canonical path, title, description, summary,
  schema page type, status, last-modified date, capabilities, and FAQ. New
  public products, capabilities, prices, or status changes MUST land in the
  registry and `PRODUCT_FACTS`.
- **llms.txt / llms-full.txt**: generated by
  `web/app/src/lib/llms.ts` and served from
  `web/app/src/app/llms.txt/route.ts` (+ `llms-full.txt`). Follows the
  llmstxt.org format (H1, blockquote summary, H2 link sections). If a
  feature adds public content the registry does not cover, extend the
  generator so answer engines can see and recommend it.
- **Structured data**: `web/app/src/lib/structured-data.ts` (Organization,
  WebSite, page graphs, SoftwareApplication, FAQPage, breadcrumbs). Do not add
  Offer or Product sales schema before purchases are actually available.
- **Sitemap**: `web/app/src/app/sitemap.ts` covers registry routes. Every new
  indexable route must first be added to the registry.
- **Robots**: `web/app/src/app/robots.ts` (staging noindex via
  `BLOCK_INDEXING`). Private/auth/deep-link pages must export
  `robots: { index: false }` metadata.
- **Metadata**: canonical URLs always use the hardcoded `https://vorinthex.com`
  origin; use `buildRouteMetadata` in `web/app/src/lib/metadata.ts`.

After SEO-affecting changes, verify `/llms.txt`, `/llms-full.txt`,
`/sitemap.xml`, and `/robots.txt` render correctly in a build.

## Conventions

- Keep changes scoped and match the surrounding code style.
- Add or update tests for behavior changes.
- Never use current or future product names as code identifiers or API route
  segments (including function, class, variable, module, and endpoint names).
  Name code after its domain behavior or capability instead; for example, do
  not name a function `chorus` solely because Chorus is a planned core app.
- Do not commit secrets in plaintext. All vars/secrets (dev + prod) live git-crypt-encrypted in `.github/environments.json` — edit it locally after `git-crypt unlock`, never add a new plaintext env file.
- Keep shared code in the top-level `shared/` folder, not nested inside `web/app/src/shared` or `backend/src/shared`.
- Always use components and icons from `@vorinthex/shared/ui` across web and mobile. Do not create app-local UI primitives, import native button or icon primitives, render native `<button>`/`Pressable` controls, or bypass shared component styling with `vui-*` classes. This applies to bespoke controls including listbox options, reactions, poll choices, mention chips, animated controls, and link CTAs. If a required component, variant, size, or icon does not exist, create or extend it in `shared/packages/ui` first, with web and mobile implementations where applicable, then consume that shared export. All buttons must use the shared `Button` radius, one of its five sizes (`xs`, `sm`, `md`, `lg`, `xl`), and an appropriate shared variant. Ordinary buttons rendered inside a `BottomSheet`, including headers, content, menu items, and footers, must use `size="md"`; `BottomSheet` enforces this default and `BottomSheetItem` must not expose a size override. Shared compact composites such as `Tabs`, badges, and chip actions may use `ButtonSizeProvider overrideParent` to preserve their single compact size. Disabled primary actions must remain visibly identifiable at 80% opacity; do not replace or hide their primary treatment with local disabled styles.
- Validate backend endpoint JSON payloads and query parameters with Zod strict object schemas; reject unknown fields instead of silently accepting them.
- ArangoDB documents: application code and schemas ALWAYS use `key` as the public primary-key field — never read or write Arango's `_key` directly. The only place that translates between them is `toArangoDoc`/`withArangoKey` in `backend/src/lib/db/base.ts`; document schemas parse in Zod's default strip mode so `_key`/`_id`/`_rev` drop away on read.
- Keep backend HTTP endpoints behind the env API key middleware and Redis-backed per-IP rate limiting unless a task explicitly changes that security model.
- Every user-facing API capability for Archive, Gallery, Signal, Compass, or Ascend must follow the Unified Tools And Actions rules above.
- Tool names always use product-neutral dot notation (`folder.create`, `email.draft.send`), never underscores or current/future product names.
- Database deletion is hard deletion: schemas must not define tombstone timestamps, and delete operations clean dependents transactionally. Archive or status fields may represent only an explicit non-deletion domain lifecycle.
- AI action definitions, identities, exact model/provider bindings, and routing priorities live only in `backend/src/lib/ai/actions`. Persisted models, providers, and model-provider relations are operational catalog gates, not action-routing priority sources. Do not recreate persisted model-action, agent, skill, run, artifact, memory, capability-catalog, mind, or action-catalog collections. Runtime authorization derives from authenticated organization and scope membership.

## Notes For Agents

- Run the relevant checks before considering a task complete.
- Ask before introducing a new major dependency or framework.
- This repo is its own monorepo; do not add git submodules for `web/app`, `backend`, or `shared`.
- Deployments happen ONLY through the Unified Deploy GitHub workflow (`.github/workflows/deploy.yml`): merge to `main` builds the `vorinthex-web` and `vorinthex-backend` images and pushes them to ECR. **Current state: to keep costs low early on, production is served by the single-box early-infra stack** — one EC2 box running web + api + redis behind Caddy (see `deploy/early/`) — and every merge reaches it via an SSM blue-green swap (`deploy/early/deploy.sh`). The AWS-ECS rollout steps (`vorinthex-prod-web` / `vorinthex-prod-api` on the `vorinthex-production` cluster via `aws ecs update-service --force-new-deployment`) exist in the same workflow but no-op while the cluster is INACTIVE; once ECS is provisioned the roles flip automatically and the early-infra job no-ops instead. Infrastructure itself (Terraform plan/approval/apply) is provisioned by `infra.yml`, not `deploy.yml`.
