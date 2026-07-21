# Vorinthex Backend

Vorinthex runs AI-driven admin, content, and marketing operations for companies and their apps.

## Model

The runtime hierarchy is Agent -> Manager -> Role -> Task -> Action.

Agents own managers. Managers validate role completion against their assignment and decide what happens next. Roles are repeatable task runners with no chaining logic. Tasks are ordered data-defined sequences. Actions are the hardcoded primitives in `src/core/actions`; new deployed behavior belongs there, while new workflows should usually be new Manager/Role/Task data in `companies.graph` or a blueprint.

## Local Development

1. Run `git-crypt unlock` at the repo root so `.github/environments.json` decrypts.
2. Run `bun install`.
3. Start local dev with `bun start`. This brings up Docker Compose infra, applies dev migrations, and starts the API.
4. Reset local dev data with `bun reset`. This runs `docker compose down -v`.

You can still run pieces manually with `bun run dev:infra`, `bun run db:migrate:dev`, and `bun run dev`.

Docker Desktop or another ArangoDB/Redis environment must be running for migrations and DB-backed tests.
Mailpit is included in the dev infra at `localhost:8025` with SMTP on `localhost:1025`.

## Production

Production deploys are defined in `.github/workflows/deploy.yml` and `deploy/`. The app role runs blue-green behind Caddy from `deploy/docker-compose.app.yml`; the render role runs as an ECS/Fargate service updated by task-definition revision. See `deploy/PROD-CHECKLIST.md` for required GitHub secrets, AWS SSM parameters, and deployment behavior.

## Blueprints

Blueprints are reusable starter graphs stored in `blueprints`. Applying a blueprint copies its agents, roles, and tasks into a new company with fresh IDs. The copied company graph has no foreign key or live reference to the blueprint, so later blueprint edits do not alter existing companies.

Create a company with blueprints:

```http
POST /companies
{
  "slug": "lensoflow",
  "metadata": { "name": "Lensoflow" },
  "blueprint_ids": ["blueprint_cmo_content", "blueprint_cto_platform"]
}
```

## Adding Behavior

Actions are a fixed deployed code library. Add or change an Action manually in `src/core/actions`, register it in `src/core/actions/index.ts`, cover the behavior with tests where practical, and ship it through the normal human-reviewed deploy path.

Add a new Manager, Task, or Role as data by writing to a company graph through the existing graph Actions or by adding a blueprint. This does not require a deploy if it only rearranges existing Actions.

## Security

Every execution is constrained by direct action authorization, original-human access checks, and database-level data filtering before model reasoning can see it.

Authentication sessions use backend-issued cookie policy metadata. Ordinary
users and members receive a seven-day access token and one-year absolute
refresh session. Root-organization owners (`superAdmin`, the Nexus founder
flow) receive a 15-minute access token and one-day absolute refresh session.
Refresh rotation preserves the original absolute expiry.
