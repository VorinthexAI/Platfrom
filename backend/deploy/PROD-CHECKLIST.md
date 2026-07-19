# Vorinthex Production Deploy Checklist

Production follows the Lensoflow deployment pattern, adapted to Vorinthex's two roles:

- `app`: public API/orchestration role on EC2, deployed blue-green with Caddy.
- `render`: always-on ECS/Fargate service that drains the render queue.

## Required GitHub Secrets

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `APP_EC2_HOST`
- `APP_EC2_USER`
- `APP_EC2_SSH_KEY` or shared `EC2_SSH_KEY` (also authorized on the graph-db host)
- `GRAPH_DB_EC2_HOST`
- `GRAPH_DB_EC2_USER`

## GitHub Variables

- `APP_HEALTH_URL`, for example `https://api.vorinthex.com/api/v1/health`
- `RENDER_TASK_FAMILY`, required for render deploys
- `RENDER_ECS_CLUSTER`, required to roll the running render service
- `RENDER_ECS_SERVICE`, required to roll the running render service

## AWS SSM Parameter Path

The workflow renders `.env` on each host from:

```text
/vorinthex/prod/
```

Expected parameters include:

- `ARANGO_URL`
- `ARANGO_DATABASE`
- `ARANGO_USERNAME`
- `ARANGO_ROOT_PASSWORD`
- `REDIS_URL` for the app and render service to reach the production Redis endpoint
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GROK_API_KEY`
- `PERPLEXITY_API_KEY`
- `GOOGLE_API_KEY`
- S3/AWS variables used by the runtime

## Deploy Behavior

- Merges to `main` through a closed pull request trigger the production workflow.
- Manual `workflow_dispatch` can build-only or build-and-deploy.
- The graph-db host receives `deploy/docker-compose.db.yml` and is brought up with `docker compose up -d` before migrations run.
- The app host receives `deploy/docker-compose.app.yml` and `deploy/deploy-app.sh`.
- App deploy starts the idle color, waits for health, flips Caddy, then stops the old color.
- Render deploy registers a new ECS task-definition revision and rolls `RENDER_ECS_SERVICE`.
- Shared changes under `src/core`, `src/db`, `src/lib`, `deploy`, or `.github` deploy both roles.
