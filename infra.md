# Vorinthex Infrastructure Migration Master Prompt (Updated)

## Objective

Design and execute (after approval) a complete migration from Vercel to AWS.

This prompt supersedes previous instructions.

## Core Architecture

Cloudflare
↓
CloudFront
↓
AWS WAF
↓
Application Load Balancer
↓
ONE ECS Cluster
↓
ONE shared EC2 Auto Scaling Group
↓
Many ECS Services
↓
Shared EC2 Capacity
↓
Private ArangoDB EC2

## Critical Principles

- ONE shared ECS cluster.
- ONE shared EC2 Auto Scaling Group.
- Do NOT create separate EC2 fleets per product.
- Backend, SSR apps and services share the same compute pool.
- ArangoDB remains on its own fixed EC2.
- Low traffic should allow nearly the entire platform to run on one small EC2 plus the database.
- Scale containers first, EC2 instances only when required.

## Domains

Create:

environments/domains.json

Example:

{
  "vorinthex.com": [
    "core",
    "command",
    "studio",
    "launch",
    "archive",
    "gallery",
    "signal",
    "compass",
    "ascend",
    "atlas",
    "hermes",
    "metis",
    "apollo",
    "iris",
    "ledger",
    "orbit",
    "mercury",
    "sentinel",
    "athena",
    "forge",
    "themis",
    "hunt"
  ]
}

The registry must be the source of truth.

## Cloudflare

Implement infra.yml that synchronizes DNS automatically.

Requirements:

- Idempotent.
- Uses Cloudflare API.
- Creates missing records.
- Updates changed records.
- Never duplicates records.
- All subdomains point to CloudFront/ALB target.
- SSL/TLS compatible.

## AWS

Review and migrate:

- ECS
- EC2
- ASG
- ALB
- CloudFront
- ECR
- IAM
- CloudWatch
- Secrets Manager
- EventBridge
- SQS
- Terraform
- GitHub Actions

## CI/CD

GitHub Actions:

Push
→ Build
→ Test
→ Docker Buildx
→ Push ECR
→ Terraform Plan
→ Approval
→ Terraform Apply
→ ECS Rolling Deploy

## SEO / GEO / AEO

Every domain and subdomain must automatically generate:

- title
- description
- canonical
- robots
- sitemap
- sitemap index
- llms.txt
- llms-full.txt
- JSON-LD
- FAQ schema
- Breadcrumb schema
- OpenGraph
- Twitter Cards

All metadata must be unique.

## OpenGraph

Every page:

- unique og:title
- unique og:description
- unique og:image
- unique og:image:alt

Use product logos for product pages.

Use capability logos for capability pages.

Use orchestrator logos for orchestrator pages.

If no static asset exists:

Generate dynamic OG image.

## Twitter Cards

Every page:

- unique twitter:title
- unique twitter:description
- unique twitter:image
- unique twitter:image:alt

Use correct product branding.

## robots.txt

Generate automatically.

Different rules for:

- development
- staging
- production

## llms.txt

Generate automatically.

Read existing registry and landing page content.

Reuse existing summaries, FAQs, AEO and SEO.

Never duplicate manually.

## GEO

Optimize for:

- ChatGPT
- Claude
- Gemini
- Perplexity
- Copilot
- future AI crawlers

## Registry

Galaxy Registry remains the single source of truth.

New product added →

Automatically:

- DNS
- metadata
- OpenGraph
- Twitter Card
- robots
- sitemap
- llms.txt
- routing

without manual edits.

## Cost Goal

The solution should be significantly more cost-efficient than hosting many independent SSR applications on Vercel by sharing compute through one ECS cluster and one EC2 Auto Scaling Group while scaling individual ECS services independently.


---

# Terraform Verification (Mandatory)

The agent MUST treat Terraform as the single source of truth for infrastructure.

## Audit

Perform a complete audit of every Terraform file.

Review:

- providers
- modules
- variables
- outputs
- locals
- backends
- remote state
- workspaces
- IAM resources
- networking
- ECS
- EC2
- CloudFront
- Cloudflare integration
- Route53 (if present)
- ECR
- CloudWatch
- Secrets Manager

## Validation

The migration MUST NOT continue until Terraform has been verified.

The agent must:

- validate every module
- detect dead resources
- detect duplicated resources
- detect deprecated resources
- detect Vercel-specific resources
- detect manual AWS resources that should be imported
- verify dependencies
- verify outputs
- verify variable consistency

Produce a report describing every issue found.

## Terraform Quality

Recommend improvements to:

- module structure
- naming
- environments
- remote state
- locking
- reusable modules
- outputs
- variable organization

Terraform should become the only infrastructure deployment mechanism.

No manual infrastructure changes.

No click-ops.

Everything must be reproducible.

---

# Remove Vercel Completely

The target architecture no longer uses Vercel.

The agent must locate and remove every dependency on Vercel.

Review:

- vercel.json
- Vercel CLI
- Vercel environment variables
- Vercel GitHub Actions
- Vercel DNS assumptions
- Vercel build settings
- Vercel deployment scripts
- Vercel documentation

Generate a migration checklist.

Nothing in production should depend on Vercel after the migration.

AWS + Cloudflare become the complete production platform.
