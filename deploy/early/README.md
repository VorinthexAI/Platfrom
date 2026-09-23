# Early-infra (low-cost single-box platform)

The production platform was slimmed down to **two EC2 instances** to cut cost
(~$250 → ~$60/mo) while traffic is still low. This replaces the ALB + autoscaling
ECS + ElastiCache + NAT + CloudFront stack (all destroyed).

## Topology

```
Cloudflare (website, SSL = Full) ──▶ app box :443 (Caddy, internal cert)
Direct HTTPS (api.vorinthex.com) ──▶ same Caddy (public ACME cert)
                              ├─ web    container (Next.js, :3000)
                              ├─ api    container (Bun backend, :3001)
                              └─ redis  container (:6379, local)
                                       │  (private IP, same VPC)
                                       ▼
                            graph-db box ── ArangoDB 3.12 (:8529) + EBS data volume
```

- **app box** — `vorinthex-early-app`, t4g.medium (ARM), Virginia **public** subnet,
  EIP `52.5.125.6`. Caddy serves the proxied apex and the DNS-only API hostname.
  `/api/v1/*` routes to Bun on either hostname; the apex keeps this route for
  existing clients and web integrations. All other apex paths route to Next.js.
  Direct HTTPS is admitted on :443, with Caddy restricting the website hosts to
  Cloudflare peers; :80 is restricted to Cloudflare.
- **graph-db box** — `vorinthex-prod-graph-db-host`, t3.small, ArangoDB in Docker
  on the `/data/arangodb` EBS volume. Unchanged from before; holds all data.
- No ALB / NAT / ElastiCache / (our) CloudFront. Cloudflare is the CDN/edge.
- Image hashing remains transient Fargate compute launched per queued image-hash
  job; document parsing and scanning run directly in the API container.

## DNS

The Cloudflare-proxied apex and www CNAMEs point at the app box's public DNS,
set via `CLOUDFLARE_DNS_TARGET` (`ec2-52-5-125-6.compute-1.amazonaws.com`).
The DNS-only `api.vorinthex.com` A record points at the same box's EIP.
Cloudflare's zone SSL mode is **Full** for the website's internal origin cert;
direct API traffic uses Caddy's public ACME cert. Sync via `infra.yml`
(`run_dns_sync=true`).

## Deploy

`.github/workflows/deploy.yml` builds the arm64 web+api images, pushes to ECR,
and runs `deploy/early/deploy.sh` on the app box **via SSM** (no SSH):
zero-downtime blue-green — brings the inactive colour up, health-checks it, flips
Caddy, retires the old colour. Runtime secrets are pulled from SSM
`/vorinthex/prod/*` at deploy time (redis + ArangoDB URLs are overridden locally).

## Files

- `Caddyfile.tmpl` — reverse proxy (`__COLOR__` templated per deploy).
- `deploy.sh` — blue-green deploy, run on the box via SSM.
- `bootstrap-app.sh` / `bootstrap-db.sh` — EC2 user-data (Docker + layout).

## In Terraform

The app box, its security group + rules, EIP, the Cloudflare-IP prefix list,
and the transient-compute Redis ingress rules are managed in
`terraform/environments/production/early_app.tf` (imported; `user_data`/`ami` are
ignored so a plan never replaces the running box — verified 0-destroy, clean plan).

## Known gaps / follow-ups

- Port 443 is public for the DNS-only API hostname. Because the website shares
  that port, Caddy enforces the Cloudflare source-IP restriction on apex/www.
- Cloudflare→origin is Full with an internal origin cert. Optional hardening: a
  real origin cert (Cloudflare Origin CA) for Full (strict).
- DB stays on t3.small (a t4g.small downsize was skipped — ~$5/mo, not worth the
  cross-instance data move).
