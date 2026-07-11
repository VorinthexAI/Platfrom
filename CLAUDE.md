@AGENTS.md

Graphify preference: for codebase navigation questions, use `graphify explain` first. Use broad `graphify query` only if `explain` cannot identify a useful node, then verify exact source lines narrowly with `rg` or direct file reads.

SEO/AEO: when building or changing features, check the "SEO / AEO" section in AGENTS.md and update what applies — registry `seo`/`aeo`/`content` fields, llms.txt generator, JSON-LD, sitemap, and robots/noindex for private pages.

Deployment: production currently runs on the cheap single-box early-infra stack (web + api + redis behind Caddy on one EC2 box, `deploy/early/`), NOT on ECS yet — kept that way deliberately to hold costs down early on. Merges to `main` deploy there via `deploy.yml`'s SSM blue-green swap; the ECS jobs in the same workflow no-op until the cluster is provisioned. See "Notes For Agents" in AGENTS.md.
