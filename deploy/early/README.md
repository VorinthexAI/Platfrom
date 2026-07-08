# Early-infra (low-cost single-box platform)

The production platform was slimmed down to **two EC2 instances** to cut cost
(~$250 → ~$60/mo) while traffic is still low. This replaces the ALB + autoscaling
ECS + ElastiCache + NAT + CloudFront stack (all destroyed).

## Topology

```
Cloudflare (SSL = Full) ──▶ app box :443 (Caddy, self-signed internal cert)
                              ├─ web    container (Next.js, :3000)
                              ├─ api    container (Bun backend, :3001)
                              └─ redis  container (:6379, local)
                                       │  (private IP, same VPC)
                                       ▼
                            graph-db box ── ArangoDB 3.12 (:8529) + EBS data volume
```

- **app box** — `vorinthex-early-app`, t4g.medium (ARM), **public** subnet, EIP
  `13.49.39.46`. Caddy host-routes `api.vorinthex.com` → api, everything else →
  web (which fans the other subdomains out via `proxy.ts`). Security group only
  admits Cloudflare's IP ranges (managed prefix list) on :80/:443.
- **graph-db box** — `vorinthex-prod-graph-db-host`, t3.small, ArangoDB in Docker
  on the `/data/arangodb` EBS volume. Unchanged from before; holds all data.
- No ALB / NAT / ElastiCache / ECS / (our) CloudFront. Cloudflare is the CDN/edge.

## DNS

Cloudflare proxied CNAMEs (apex + every subdomain in `environments/domains.json`)
point at the app box's public DNS, set via the `CLOUDFLARE_DNS_TARGET` repo
variable (`ec2-13-49-39-46.eu-north-1.compute.amazonaws.com`). The zone SSL mode
is **Full** (Caddy serves a self-signed cert for `vorinthex.com` + `*.vorinthex.com`).
Run the sync from `infra.yml` (`run_dns_sync=true`).

## Deploy

`.github/workflows/early-infra.yml` builds the arm64 web+api images, pushes to
ECR, and runs `deploy/early/deploy.sh` on the app box **via SSM** (no SSH):
zero-downtime blue-green — brings the inactive colour up, health-checks it, flips
Caddy, retires the old colour. Runtime secrets are pulled from SSM
`/vorinthex/prod/*` at deploy time (redis + ArangoDB URLs are overridden locally).

## Files

- `Caddyfile.tmpl` — reverse proxy (`__COLOR__` templated per deploy).
- `deploy.sh` — blue-green deploy, run on the box via SSM.
- `bootstrap-app.sh` / `bootstrap-db.sh` — EC2 user-data (Docker + layout).

## In Terraform

The app box, its security group + rules, EIP, the Cloudflare-IP prefix list, and
the arango-SG ingress rule are now managed in
`terraform/environments/production/early_app.tf` (imported; `user_data`/`ami` are
ignored so a plan never replaces the running box — verified 0-destroy, clean plan).

## Known gaps / follow-ups

- **Origin is open on 0.0.0.0/0.** The Cloudflare-only prefix-list rules do not (on
  their own) admit Cloudflare to the origin, so :80/:443 are also open to the world
  (`early_app_http_open`/`early_app_https_open`). Mitigated by the API key + an
  unpublished origin IP. TODO: figure out why the prefix-list rules don't work and
  lock down to Cloudflare-only.
- Cloudflare→origin is Full with a self-signed origin cert. Optional hardening: a
  real origin cert (Cloudflare Origin CA) for Full (strict).
- DB stays on t3.small (a t4g.small downsize was skipped — ~$5/mo, not worth the
  cross-instance data move).
