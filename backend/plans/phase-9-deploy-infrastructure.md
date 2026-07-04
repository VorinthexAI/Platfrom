# Phase 9 — Deploy Infrastructure

## Goal

Set up the production deploy pipeline — blue-green deployment for the `app` role on EC2, plus an always-on Fargate Spot service for the `render` role.

This phase is self-contained.

## Background

This continues the infrastructure work started in Phase 1's "copy from Lensoflow" instruction. Key constraints, decided deliberately:

- Single app EC2 box, `t3.small` to start (resizable later with minimal downtime).
- Own dedicated RDS PostgreSQL, separate from any other product's database.
- Redis/BullMQ reachable by both the app EC2 host and render Fargate tasks.
- Two roles only: `app` (API + orchestration, no separate admin split) and `render` (heavy async job worker).
- ECS Fargate Spot for the render role and other heavy async jobs.
- Render is not deployed as an EC2 worker container.
- `dev` and `prod` environments only — no separate staging tier.

## What to build

### 1. Docker images

Multi-stage Dockerfile producing two distinct images from the same repo: one for `app` (entrypoint runs `src/api`), one for `render` (entrypoint runs the heavy-job worker logic). Role selected via a `ROLE` env var + CMD override on the same base image — one Dockerfile, two runtime configurations.

### 2. Selective deploy / ownership detection

- A script that builds a reachability graph from each role's entrypoint files (`src/api/index.ts` for `app`, the render worker's entrypoint for `render`) to determine which source files belong to which role.
- A script that, given a git diff, determines whether `app`, `render`, or both need redeployment. Files under `src/core/actions/` or `src/core/modes/` map to wherever Actions actually execute (likely both roles, since both may need the latest Action code) — files under `src/api/` map to `app` only, files under the render worker's specific directory map to `render` only. Shared files (`src/db/`, `src/lib/`) trigger both.
- Unknown/unmapped file paths default to deploying BOTH roles — safe-default-over-precision philosophy.

### 3. Blue-green deploy script

For the `app` role:

- Read current active color (blue/green).
- Pull the new image, start the idle color.
- Health-check the idle color via internal Docker healthcheck.
- Only if healthy: flip the reverse-proxy routing to the new color via graceful reload, then stop the old color.
- If unhealthy: stop the idle color, exit non-zero, never flip — old color keeps serving.

### 4. Fargate Spot for heavy jobs

- ECS Fargate Spot task definition and always-on service for the render role.
- On render-affecting deploys, register a new ECS task-definition revision with the fresh image and roll the configured ECS service, matching Lensoflow's render deployment pattern.
- The render task definition must receive the complete runtime env it needs from SSM/secrets, including database, Redis, S3, and provider keys. It should not expose an HTTP health check.

### 5. CI/CD pipeline

- On merge to `main`: typecheck → build both images → push to ECR → run migrations → selective deploy based on the ownership-detection output.
- Confirm this pipeline correctly triggers on manual merges to `main`, including changes under `src/core/actions/` and `src/core/modes/`.

### 6. Secrets

All environment variables (`DATABASE_URL`, `ANTHROPIC_API_KEY`, S3 credentials, Redis connection, etc.) sourced from a secrets manager — never committed to the repo, never hardcoded. Render the `.env` fresh from the secrets source on every deploy rather than maintaining a stale file on the box.

## Success criteria

- A deploy of an `app`-only change does not trigger a `render` rebuild/redeploy (verify via deploy logs).
- A deploy of a shared `src/core/` change correctly triggers both roles.
- A deliberately broken image (failing healthcheck) is correctly rejected by the blue-green script — old color keeps serving, zero downtime, deploy script exits non-zero.
- Render Fargate service rolls to a new task definition revision on render-affecting changes.
- `app` and `render` can both reach the shared Redis/BullMQ endpoint and RDS through private networking.

Confirm what you built. If Fargate/ECS access isn't available in this environment, build the task definition and dispatch code but clearly flag what requires real AWS credentials to verify.
