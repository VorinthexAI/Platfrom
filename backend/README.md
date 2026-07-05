# Vorinthex Backend

Vorinthex runs AI-driven admin, content, and marketing operations for companies and their apps.

## Model

The runtime hierarchy is Agent -> Manager -> Role -> Task -> Action.

Agents own managers. Managers validate role completion against their assignment and decide what happens next. Roles are repeatable task runners with no chaining logic. Tasks are ordered data-defined sequences. Actions are the hardcoded primitives in `src/core/actions`; new deployed behavior belongs there, while new workflows should usually be new Manager/Role/Task data in `companies.graph` or a blueprint.

## Local Development

1. Copy `../environments/backend/.env.example` to `../environments/backend/.env.dev`.
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

Every mode call is constrained by three layers: `allowed_modes` controls which tools an agent can use, `allowed_member_ids` controls which original human may access an agent even through delegation, and `allowed_app_ids` filters every data read at the database query level before model reasoning can see it.
