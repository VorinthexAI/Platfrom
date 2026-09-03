# Vorinthex Backend

Vorinthex runs the API, persistence, and AI execution layer for the platform.

## Model

The AI runtime routes generic actions through models and providers. Product behavior is exposed through the unified tool registry, with HTTP handlers and tools sharing canonical domain services.

## Local Development

1. Run `git-crypt unlock` at the repo root so `.github/environments.json` decrypts.
2. Run `bun install`.
3. Start local dev with `bun start` from `backend/`. This brings up the Docker Compose infra (ArangoDB, Redis, LocalStack, Mailpit), applies dev migrations, and starts the API natively with hot reload.
4. Reset local dev data with `bun reset`. This runs `docker compose down -v`.

You can still run pieces manually with `bun run dev:infra`, `bun run db:migrate:dev`, and `bun run dev`.

Docker Desktop or another ArangoDB/Redis environment must be running for migrations and DB-backed tests.
Mailpit is included in the dev infra at `localhost:8025` with SMTP on `localhost:1025`.

### Infra in Docker, backend native

This is the supported dev layout: everything in `backend/docker-compose.yml` except `app` and `render` runs as containers, and the backend runs natively via Bun so `bun --hot` picks up edits instantly.

Do not develop against the `app` and `render` Compose services (`bun run dev:services`). They exist to exercise the container image, not for day-to-day development: on Windows and macOS, file-change events do not cross the Docker mount into the container, so `bun --hot` silently never sees edits — changes appear to have no effect until the container is restarted. If you do use them, restart `app` (and `render`) after every edit:

```bash
docker compose --profile services restart app render
```

Run the live content release gate with `bun run test:e2e:content`. It starts the required Compose services without stopping existing containers, waits on their host HTTP/TCP endpoints, recreates only the default isolated `content_e2e` database, migrates it, and runs the gated test. Environment variables supplied by CI override all isolated defaults; no env file is written.

## Production

Production deploys are defined in `.github/workflows/deploy.yml` and `deploy/`. The app role runs blue-green behind Caddy and processes document parsing and scanning directly while it waits on external OCR and model APIs. Image hashing remains isolated transient Fargate compute.

## Adding Behavior

Add generic model behavior through the action registry and product operations through the unified tool registry. Keep shared business logic in canonical services, cover behavior changes with tests, and ship through the normal human-reviewed deploy path.

## Security

Every execution is constrained by direct action authorization, original-human access checks, and database-level data filtering before model reasoning can see it.

Authentication sessions use backend-issued cookie policy metadata. Ordinary
users and members receive a seven-day access token and one-year absolute
refresh session. Root-organization owners (`superAdmin`, the Nexus founder
flow) receive a 15-minute access token and one-day absolute refresh session.
Refresh rotation preserves the original absolute expiry.
