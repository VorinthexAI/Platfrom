# Vercel Removal Checklist

Vorinthex has fully migrated off Vercel. The Next.js web app and the Bun backend
now ship as container images to Amazon ECR and run on the shared
`vorinthex-production` ECS cluster (behind CloudFront → ALB), in AWS `eu-north-1`
(account `938565868704`). This document tracks everything that was removed and
the manual follow-up needed to fully decommission Vercel.

## Target architecture (no Vercel)

```
Cloudflare → CloudFront → AWS WAF → ALB → ECS (vorinthex-production)
  ├─ vorinthex-prod-web  (ECR: vorinthex-web,     :3000, one image serves all subdomains)
  └─ vorinthex-prod-api  (ECR: vorinthex-backend, :3001)
ArangoDB → private EC2 (reached over SSH tunnel for migrations only)
```

Subdomain routing (orbit.vorinthex.com, hunt.vorinthex.com → /hunt, …) happens
inside the single web image via `web/app/src/proxy.ts` — there is no longer one
Vercel project per subdomain.

## What changed in this repo

- **`.github/workflows/deploy.yml`** — rewritten. The three Vercel web jobs
  (`deploy-vorinthex` / `deploy-orbit` / `deploy-hunt`) are replaced by a single
  `deploy-web` job that buildx-builds `web/app/Dockerfile` (repo-root context,
  `linux/arm64`), pushes to ECR `vorinthex-web` (`:sha` + `:latest`), then runs
  `aws ecs update-service --force-new-deployment` on `vorinthex-prod-web`, waits
  for `services-stable`, and health-checks the site. The backend blue-green
  SSH/scp/`deploy-app.sh` path (`backend-app`) is replaced by `backend-deploy`,
  which rolls `vorinthex-prod-api` the same way and smoke-checks `/api/v1/health`.
  All `vercel` CLI installs, `vercel pull/build/deploy`, the Vercel REST env-sync
  loop, the `cp -al` NFT trace hack, and every `VERCEL_*` reference are gone.
- **`.github/.configs/secrets.json` + `secrets.json.example`** — the `vercel`
  block (`token`, `team_id`) and every `vercel_project_id` field were removed.
- **`environments/scripts/build-config.ts`** — no longer emits the `vercel`
  object or `vercel_project_id` fields; the `--vercel-token` /
  `--*-project-id` args are removed.
- **`AGENTS.md`** — deployment notes now describe AWS ECS only.

## Retained (NOT Vercel — do not remove)

- The ArangoDB SSH-tunnel jobs (`backend-db`, `backend-migrate`,
  `seed-db-secrets`) still run schema migrate + node seed + Polar sync + secret
  seed from a full checkout over an SSH tunnel to the private ArangoDB EC2. They
  were **not** converted to `aws ecs run-task` because the runtime image only
  ships `backend/src` (not `backend/scripts`, so `polar:sync` / `seed:secrets`
  are unavailable in the image) and `seed:secrets` also needs the
  git-crypt-encrypted `environments/backend/db.seeds.secrets.json` that is not
  baked into any image. These depend on the `GRAPH_DB_EC2_*` secrets, not Vercel.

## Manual follow-up (outside this repo)

### Repo secrets to DELETE (GitHub → Settings → Secrets and variables → Actions)
- `VERCEL_TOKEN`
- `VERCEL_PROJECT_ID_VORINTHEX`
- `VERCEL_PROJECT_ID_ORBIT`
- (any `VERCEL_PROJECT_ID_HUNT` / `VERCEL_ORG_ID` / `VERCEL_TEAM_ID` if present)

Note: this repo also carries Vercel values inside the single `CONFIG` secret
(built by `build-config.ts`). Re-run `build-config.ts` and
`sync-configs.sh secrets` so the refreshed `CONFIG` (now Vercel-free) is pushed.

### Repo variables/secrets to KEEP or ADD
- Keep: `AWS_DEPLOY_ROLE_ARN`, `AWS_INFRA_ROLE_ARN` (OIDC), `GH_PAT`,
  `GIT_CRYPT_KEY`, `GRAPH_DB_EC2_*`, `DB_SEEDS_SECRETS_JSON(_B64)`.
- Optional: `APP_HEALTH_URL` (backend `/api/v1/health` smoke), `RENDER_TASK_FAMILY`
  / `RENDER_ECS_CLUSTER` / `RENDER_ECS_SERVICE` (render worker, desired count 0).
- No new Vercel-related secret is required.

### Vercel projects to decommission (after DNS cutover to Cloudflare → CloudFront)
1. Confirm Cloudflare DNS for `vorinthex.com`, `www`, `orbit`, `hunt`, `api`
   (and all registry subdomains) points at CloudFront/ALB, not Vercel.
2. Verify production is served by ECS (`curl -I https://www.vorinthex.com`,
   `https://orbit.vorinthex.com`, `https://hunt.vorinthex.com`,
   `https://api.vorinthex.com/api/v1/health`).
3. Delete the Vercel projects: `vorinthex`, `orbit`, `hunt`.
4. Remove the custom domains from those Vercel projects first if deletion is
   blocked by attached domains.
5. Revoke the Vercel access token (`vcp_…`) and, if unused elsewhere, remove the
   Vercel team/integration.

### Env-var / domain cleanup
- Remove all production env vars stored in the Vercel dashboard (they now live in
  AWS SSM Parameter Store under `/vorinthex/prod/` for the backend, and are baked
  into the web image at build time via `NEXT_PUBLIC_SITE_URL`).
- Remove any Vercel-managed domains / DNS records once Cloudflare + CloudFront
  fully serve traffic.

## Confirmation: nothing in production depends on Vercel

- No `vercel.json` in the repo.
- No `vercel` CLI usage in `.github/workflows/**`.
- No `VERCEL_*` variables referenced by `deploy.yml` or `ci.yml`.
- Web and backend both deploy to AWS ECS via ECR images.
- Terraform contains no Vercel provider/resources (verify during the Terraform
  audit in `infra.md`).

Once the Vercel projects are deleted and the token revoked, AWS + Cloudflare are
the complete production platform.
