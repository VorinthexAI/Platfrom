# Terraform Audit — Vorinthex Production

Scope: every file under `terraform/`. Region `eu-north-1` (default provider) +
`us-east-1` (aliased `aws.us_east_1` for CloudFront/ACM/WAF). Single
environment `environments/production`. AWS provider locked at `5.100.0`
(constraint `~> 5.84`), `random 3.9.0` (`~> 3.6`), `tls 4.3.0` (`~> 4.0`).
Backend: partial `backend "s3" {}` with S3 native locking (`use_lockfile=true`,
no DynamoDB). No Terraform workspaces (single-env-dir design). Verification
performed locally: `terraform init -backend=false`, `terraform fmt -recursive`,
`terraform validate` → **Success! The configuration is valid.**

This audit also documents the AWS WAFv2 web ACL added to `modules/edge` as part
of this task (see the WAF section).

---

## 1. Per-module inventory

### environments/production (root)

- **Providers:** `aws` (region `var.aws_region`, default `eu-north-1`,
  `default_tags`), `aws.us_east_1` (region `us-east-1`, `default_tags`).
- **Backend / remote state / locking:** `backend "s3" {}` (partial; bucket/key/
  region supplied via `-backend-config` in the infra workflow). S3 native
  locking. No workspaces.
- **required_providers:** aws `~> 5.84`, random `~> 3.6`, tls `~> 4.0`;
  `required_version >= 1.10.0`.
- **Data:** `aws_caller_identity.current`.
- **Locals:** `environment`, `tags`, `normalized_ssm_prefix`, `ssm_path`,
  `prod_env_path`/`prod_env_lines`/`prod_env_entries`/`prod_env_values`
  (parses repo-root `.tmp-backend-prod.env`, generated at CI-time from `.github/environments.json`), `effective_ssh_public_key`,
  `graph_db_subnet_id`, `generated_env_values`, `generated_env_keys`,
  `ssm_values`, `ssm_keys`, `ssm_arns`, `effective_web_image`,
  `effective_api_image`.
- **Root resources:** `tls_private_key.deploy`, `random_password.graph_db_password`,
  `random_password.api_key`, `random_password.access_token_secret`,
  `random_password.totp_secret_encryption_key`, `aws_ssm_parameter.prod`
  (`for_each = local.ssm_keys`, `ignore_changes = [value]`).
- **Checks:** `check "vpc_reuse_inputs"` (when `vpc_id` set → ≥1 public, ≥2
  private subnets).
- **Modules:** `network`, `storage`, `graph_db_host`, `graph_db_backup`,
  `cache`, `app_host`, `render_service`, `app_platform` (`count = enable_app_platform`),
  `edge` (`count = enable_app_platform`, `providers = { aws.us_east_1 }`).
- **Variables:** 40+ (region, name_prefix, vpc reuse set, ssh, instance sizing,
  redis, task cpu/mem, render_desired_count, s3/ecr names, ssm prefix, kms,
  ami pins, snapshot retain, `enable_app_platform` gate, web/api images,
  app_platform ASG/service sizing, domains, ACM/TLS, cloudfront verify,
  site_url, and the new `cloudfront_waf_enabled` / `cloudfront_waf_rate_limit`).
- **Outputs:** deploy-handoff values (app/graph-db host, render family/cluster/
  service), ecr/s3/arango/redis urls, ssm prefix, and platform outputs guarded
  with `one(module.app_platform[*]...)` / `one(module.edge[*]...)` including the
  new `cloudfront_waf_web_acl_arn`.

### modules/network

- Providers: default aws. Data: `aws_availability_zones.available`.
- Resources (VPC-create path, all `count = create_vpc`): `aws_vpc`,
  `aws_internet_gateway`, `aws_subnet.public/private`, `aws_route_table.public/
  private`, `aws_route_table_association.public/private`, `aws_eip.nat`,
  `aws_nat_gateway`. Always-on: 4 security groups (`app`, `render`, `graph_db`,
  `cache`) + `aws_vpc_security_group_ingress_rule` / `egress_rule` set.
- Locals: `create_vpc`, `selected_azs`, `public/private_subnet_ids`, `vpc_id`.
- Variables: name_prefix, vpc_id (null default), public/private_subnet_ids,
  vpc_cidr, availability_zones, tags.
- Outputs: vpc_id, public/private_subnet_ids, 4 SG ids.

### modules/app-host

- Data: `aws_ssm_parameter.al2023` (AL2023 x86 latest AMI).
- Resources: `tls_private_key.generated`, `aws_key_pair.deploy`,
  `aws_vpc_security_group_ingress_rule.ssh` (`for_each`), `aws_iam_role.this`,
  2 managed-policy attachments (ECR read, SSM core), `aws_iam_role_policy.ssm_read`
  (`count = allow_instance_ssm_read`), `aws_iam_instance_profile.this`,
  `aws_instance.this` (`ignore_changes = [user_data, ami]`), `aws_eip.this`.
- Locals: ssh_public_key, app_ec2_user, ssm_policy_arns, app_ami_id.
- Variables: name_prefix, subnet_id, security_group_id, instance_type, ami_id,
  ssh_ingress_cidr_blocks, ssh_public_key, ssm_parameter_arns, kms_key_arns,
  allow_instance_ssm_read, root_volume_size, tags.
- Outputs: instance_id, public_ip, public_dns, ssh_user, ssh_private_key_pem,
  ssh_public_key, iam_role_name.

### modules/graph-db-host

- Data: `aws_ssm_parameter.al2023`.
- Resources: `aws_key_pair.deploy`, ssh ingress rule (`for_each`),
  `aws_instance.this` (`ignore_changes = [user_data, ami]`),
  `aws_ebs_volume.data`, `aws_volume_attachment.data`, `aws_eip.this`.
- Locals: ec2_user, device_name, kernel_device, graph_db_ami_id.
- Variables: name_prefix, subnet_id, security_group_id, instance_type, ami_id,
  ssh_ingress_cidr_blocks, ssh_public_key, root_volume_size, data_volume_size,
  tags.
- Outputs: instance_id, public_ip, private_ip, ssh_user.

### modules/cache

- Resources: `aws_elasticache_subnet_group.this`,
  `aws_elasticache_replication_group.this` (at-rest + transit encryption,
  `apply_immediately = false`, precondition failover⇒>1 node).
- Variables: name_prefix, subnet_ids, security_group_id, redis_node_type,
  num_cache_clusters, automatic_failover_enabled, engine_version (`7.1`), tags.
- Outputs: primary_endpoint_address, port, redis_url (`rediss://`).

### modules/render-service

- Data: `aws_region.current`.
- Resources: `aws_cloudwatch_log_group.render`, **`aws_ecs_cluster.this`**
  (name `vorinthex-production`, containerInsights enabled), `aws_iam_role.execution`
  + managed attach + inline SSM/KMS policy, `aws_iam_role.task` + inline runtime
  policy (SSM/KMS/S3), `aws_ecs_task_definition.render` (FARGATE, x86,
  `ignore_changes = [container_definitions]`), `aws_ecs_service.render`
  (`ignore_changes = [task_definition]`).
- Locals: log_group_name, ssm_path, **`secret_keys`** (hardcoded 13-key list).
- Variables: name_prefix, subnet_ids, security_group_id, task_family,
  cluster_name (`vorinthex-production`), service_name, container_image,
  task_cpu/memory, desired_count, ssm_parameter_prefix/arns, kms_key_arns,
  s3_bucket_arn, capacity_provider (`FARGATE_SPOT`), tags.
- Outputs: cluster_name, service_name, task_family, task_execution_role_arn,
  task_role_arn, log_group_name.

### modules/storage

- Resources: `aws_ecr_repository.backend` (+ lifecycle policy),
  `aws_ecr_repository.web` (+ lifecycle policy), `aws_s3_bucket.runtime`,
  `_public_access_block`, `_server_side_encryption_configuration`,
  `_versioning`, `_lifecycle_configuration`.
- Locals: `ecr_lifecycle_policy`.
- Variables: name_prefix, ecr_repository_name (`vorinthex-backend`),
  ecr_web_repository_name (`vorinthex-web`), ecr_keep_last_images,
  s3_noncurrent_version_expiration_days, s3_bucket_name, tags.
- Outputs: ecr backend/web name+url, s3 bucket name+arn.

### modules/app-platform

- Data: `aws_region.current`, `aws_ssm_parameter.ecs_al2023_arm64`.
- Resources: 4 SGs (alb/web/api/ecs_node) + ingress/egress incl. **additive**
  `db_from_api` / `cache_from_api`; `aws_acm_certificate.alb` (`count`);
  `aws_lb.this`, target groups web/api, listeners http (+https `count`) and
  listener rules (host + `/api/*`); ECS instance role + SSM/ECS attach +
  instance profile; `aws_launch_template.ecs`; **`aws_autoscaling_group.ecs`
  (ONE ASG)**; **`aws_ecs_capacity_provider.ec2`**;
  **`aws_ecs_cluster_capacity_providers.this`** (authoritative: FARGATE,
  FARGATE_SPOT, ec2-cp; default = ec2-cp); execution role + web/api task roles;
  log groups; task definitions web/api (EC2, ARM64,
  `ignore_changes = [container_definitions]`); services web/api
  (`ignore_changes = [task_definition, desired_count]`); app autoscaling targets
  + policies (request/CPU/memory) for web and api.
- Locals: ssm_path, web/api_log_group, ecs_ami_id, create_alb_acm, alb_cert_arn.
- Outputs: alb arn/dns/zone, target groups, SG ids, capacity_provider_name,
  service names, task families, alb ACM arn + validation records.

### modules/edge

- Providers: `configuration_aliases = [aws.us_east_1]`.
- Resources: `aws_acm_certificate.cloudfront` (`count`, us-east-1),
  **`aws_wafv2_web_acl.this`** (NEW — `count = waf_enabled`, us-east-1,
  CLOUDFRONT scope), `aws_cloudfront_distribution.this` (now with
  `web_acl_id`).
- Locals: create_acm, has_aliases, aliases, origin_id, AWS managed cache/origin/
  response policy IDs.
- Variables: name_prefix, alb_domain_name, web/api_domain_names,
  viewer_acm_certificate_arn, origin_custom_header_name/value, price_class,
  **`waf_enabled`** (NEW, default true), **`waf_rate_limit`** (NEW, default
  2000), tags.
- Outputs: distribution_id, distribution_domain_name,
  **`waf_web_acl_arn`** (NEW), cloudfront_acm_certificate_arn, validation records.

### modules/backup

- Resources: `aws_iam_role.dlm` + managed policy attach,
  `aws_dlm_lifecycle_policy.ebs` (targets volume by `Name` tag, never mutates
  the volume).
- Variables: name_prefix, target_volume_tags, snapshot_interval_hours,
  snapshot_time_utc, snapshot_retain_count, tags.
- Outputs: dlm_policy_id, dlm_role_arn.

---

## 2. "ONE shared cluster + ONE shared ASG, containers scale first" — CONFIRMED

- **One ECS cluster:** `aws_ecs_cluster.this` (`vorinthex-production`) is created
  once in `modules/render-service`. `app-platform` attaches its web + api
  services to that **same** cluster via `cluster_name =
  module.render_service.cluster_name`, and `render` also runs on it. web + api +
  render therefore share ONE cluster. ✓
- **One EC2 ASG / capacity pool:** `app-platform` creates exactly one
  `aws_autoscaling_group.ecs` and one `aws_ecs_capacity_provider.ec2`, set as the
  cluster default strategy. web and api both schedule onto it. There are **no
  per-product EC2 fleets**. ✓
- **ArangoDB isolated:** the DB is a standalone `aws_instance` in
  `graph-db-host`; it is never in the launch template, ASG, or capacity provider
  (explicitly asserted in the module comments). ✓
- **Scale containers first:** web/api use `aws_appautoscaling_*`
  (ALBRequestCountPerTarget primary + CPU/memory), and the EC2 capacity provider
  uses managed scaling (`target_capacity = 100`) to add instances only when the
  task placement demands it. ✓
- **Deviation (minor):** `render` runs on **FARGATE/FARGATE_SPOT**, not the
  shared EC2 ASG, so it does not share the EC2 compute pool. `render_desired_count`
  is `0` today, so this is inert. To fully match infra.md's "one shared compute
  pool," move render to the `ec2-cp` capacity provider once the worker exists
  (see remediation R7).

---

## 3. Findings

### Blocking / correctness (verify before next apply)

- **F1 — Manual-vs-Terraform ownership must be reconciled by import (click-ops
  risk).** The following are declared in TF but are long-lived names that may
  have been created manually before TF adoption. If any exists in AWS but not in
  state, `apply` fails with "already exists":
  - ECS cluster `vorinthex-production` — TF-managed by
    `render-service/aws_ecs_cluster.this`. **Verify imported.**
  - ECR `vorinthex-backend` — TF-managed by `storage/aws_ecr_repository.backend`.
    **Verify imported.**
  - SSM params under `/vorinthex/prod/*` — TF-managed by `aws_ssm_parameter.prod`
    (`for_each` over the union of generated keys + `.env.prod` keys). Any SSM
    param that exists in AWS but is NOT in that key set is **unmanaged drift**
    (TF neither owns nor deletes it). Reconcile the `.env.prod` key list.
  - EIPs (`app-host`, `graph-db-host`, `network` NAT) — TF-managed. If the live
    hosts hold click-created EIPs, import them or expect a new-EIP churn.
  - ALB `vorinthex-prod-alb`, CloudFront `E3CS9PAMOKGYJ7`, ECS services
    `vorinthex-prod-web/api`, the t4g ASG — TF-managed by `app-platform`/`edge`
    and reported already applied; **confirm all are in state** (they should be,
    since a `count`-gated apply already stood them up).
  - **Action:** run `terraform plan` (real backend, read-only) and confirm it
    reports **no unexpected create/replace** for the resources above. This is
    infra.md's "detect manual AWS resources that should be imported" gate.

- **F2 — Render task cannot launch when the platform is disabled.**
  `aws_ecs_service.render` requests `capacity_provider = FARGATE_SPOT`, but the
  only `aws_ecs_cluster_capacity_providers` association lives in `app-platform`
  (gated by `enable_app_platform`). With `enable_app_platform = false`, the
  cluster has **no capacity-provider association**, so a render task could not be
  placed. Masked today only because `render_desired_count = 0`. Fix: associate
  FARGATE/FARGATE_SPOT with the cluster in the render module (or a dedicated
  cluster module) so render is self-sufficient regardless of the platform flag.

### Security

- **F3 — ArangoDB is in a PUBLIC subnet with a public EIP.**
  `local.graph_db_subnet_id` selects a **public** subnet and the instance sets
  `associate_public_ip_address = true` + an `aws_eip`. infra.md's target is a
  **private** ArangoDB EC2. Ingress is SG-restricted (8529 only from app/render/
  api SGs; SSH gated) so it is not wide open, but it still has a public address.
  Move it to a private subnet (reachable via the NAT egress + SSM Session
  Manager) as part of the cutover.
- **F4 — Broad KMS decrypt.** `kms_key_arns` defaults to `["*"]` in the env and
  every module; the execution/task/instance roles can `kms:Decrypt` with any
  key. Scope to the specific CMK/alias used for the SecureString SSM params.
- **F5 — Render secret list ships static AWS creds.**
  `render-service/local.secret_keys` includes `AWS_ACCESS_KEY_ID` /
  `AWS_SECRET_ACCESS_KEY` even though the task has an IAM task role. Drop the
  static-cred injection and rely on the task role. It also injects LLM keys
  (`ANTHROPIC_API_KEY`, etc.) that may not exist in SSM — if render is scaled up
  before those params exist, task startup fails (see F6).

### Consistency / correctness (non-blocking)

- **F6 — Two divergent secret-key sources.** `render-service` uses a **hardcoded
  local** 13-key list; `app-platform` uses a **variable** `api_secret_keys`
  (9 keys). They should share one authoritative, variable-driven list so the
  api and render containers cannot drift apart. Any key referenced but absent
  from `/vorinthex/prod/*` breaks task launch.
- **F7 — Naming inconsistency `prod` vs `production`.** `name_prefix =
  vorinthex-prod` (ALB `vorinthex-prod-alb`, SGs `vorinthex-prod-*`) but the ECS
  cluster is `vorinthex-production`. Pick one convention.
- **F8 — Ambiguous variable name.** Root `instance_type` means the **app host**;
  `app_platform_instance_type` is separate. Rename to `app_host_instance_type`
  for clarity.
- **F9 — Provider constraint lags the lock.** `versions.tf` pins `aws ~> 5.84`
  while the lockfile resolves `5.100.0`. Bump the constraint to `~> 5.100` so the
  floor matches what is validated/tested (WAF `evaluation_window_sec` etc.).

### Dead / unused / duplicated

- **F10 — Dead resource: `app-host/tls_private_key.generated`.** The env always
  passes a non-empty `ssh_public_key` (`local.effective_ssh_public_key` is either
  `var.ssh_public_key` or the root `tls_private_key.deploy`), so
  `local.ssh_public_key` never falls back to the module's generated key and
  `output ssh_private_key_pem` always returns `""`. The generated key is created
  every apply but never referenced. Remove it (the app + graph-db hosts already
  share the root-generated key).
- **F11 — Duplicated data source.** `aws_ssm_parameter.al2023` (AL2023 AMI) is
  declared in both `app-host` and `graph-db-host`. Acceptable per-module, but a
  shared "base-ami" data lookup or a passed-in value would de-duplicate.
- **F12 — Duplicated IAM/exec-role boilerplate.** `render-service` and
  `app-platform` each build an ECS execution role + SSM/KMS inline policy from
  scratch. Extract a small reusable `ecs-iam` module.

### Output / dependency gaps

- **F13 — Output gaps.** No env-level outputs for the CloudFront
  `distribution_id` (needed for cache invalidation automation), the ALB ARN, the
  api/web target-group ARNs, or `s3_bucket_arn`. Add the ones your CD needs.
- **F14 — Dependencies are sound.** `app_platform`/`render_service` correctly
  `depends_on` `aws_ssm_parameter.prod`; `edge` consumes
  `module.app_platform[0].alb_dns_name`; the WAF/CloudFront relationship is a
  direct in-module reference. No dependency cycles or missing edges found.

### Deprecations / Vercel / workspaces

- **F15 — No Vercel-specific resources** exist anywhere under `terraform/`
  (no `vercel_*` provider, no DNS/edge coupling). Nothing to remove here.
- **F16 — No hard-deprecated arguments** for aws provider `5.100`; `validate`
  emits no deprecation warnings. Watch item: `data.aws_region.current.name`
  (used by `render-service` and `app-platform`) — the `name` attribute is slated
  for `region` in provider 6.x; switch when you upgrade the major version.
- **F17 — No workspaces used** (single `environments/production` dir), matching
  the documented design. Fine.

---

## 4. Prioritized remediation

| # | Priority | Item | Fix |
|---|----------|------|-----|
| R1 | P0 | F1 import reconciliation | Run read-only `terraform plan` against the real backend; import anything that shows an unexpected create/replace before the next apply. |
| R2 | P0 | F2 render capacity provider | Move the FARGATE/FARGATE_SPOT cluster association into the render/cluster module so render is valid with the platform disabled. |
| R3 | P1 | F3 private ArangoDB | Relocate the graph-db instance to a private subnet, drop the public IP/EIP, keep SSM Session Manager access. |
| R4 | P1 | F4/F5 least privilege | Scope `kms_key_arns` to the real CMK; remove static AWS creds from the render secret list. |
| R5 | P1 | F6 unify secret keys | Single variable-driven secret-key list shared by api + render; validate every key exists in SSM. |
| R6 | P2 | F9 provider pin | Bump `aws` constraint to `~> 5.100`. |
| R7 | P2 | render on EC2 | Once the render worker exists, run it on the shared `ec2-cp` capacity provider to fully honor the one-pool principle. |
| R8 | P2 | F10 dead key | Delete `app-host/tls_private_key.generated` (+ its output). |
| R9 | P3 | F7/F8 naming | Standardize `prod`/`production`; rename `instance_type` → `app_host_instance_type`. |
| R10 | P3 | F13 outputs | Add `distribution_id`, ALB/target-group ARNs, `s3_bucket_arn` outputs. |
| R11 | P3 | F12/F11 DRY | Extract reusable `ecs-iam` and base-AMI helpers. |

---

## 5. Terraform-quality recommendations

- **Module structure.** Split the ECS **cluster** out of `render-service` into
  its own `ecs-cluster` module (or fold it into `app-platform`). The shared
  cluster should not be semantically owned by the not-yet-implemented render
  worker; if render is ever removed, the cluster (and every service on it) would
  be destroyed with it.
- **Naming.** One prefix convention (`vorinthex-prod`) across cluster, ALB, SGs,
  ECR, and roles. Encode tier/role consistently (`-web-`, `-api-`, `-render-`).
- **Environments.** The single-dir production model is fine for one environment,
  but factor the whole stack into a root **composition module** so a future
  `staging`/`preview` becomes a thin wrapper with different `tfvars`, not a copy.
- **Remote state / locking.** Good: partial S3 backend + native `use_lockfile`
  (no DynamoDB). Ensure (via a separate bootstrap stack) the state bucket has
  versioning, SSE-KMS, and public-access-block enabled, and document the
  `-backend-config` values so state location is reproducible outside the
  workflow.
- **Reusable modules.** Introduce a shared `ecs-service` module (task def +
  service + log group + autoscaling + task role) and instantiate it for web,
  api, and render. Today web/api are hand-rolled twice inside `app-platform` and
  render is a third near-copy — a single module removes ~500 lines of drift risk.
- **Outputs.** Expose the CD-facing identifiers consistently
  (distribution id, ALB/target-group ARNs, cluster ARN, capacity-provider name)
  and keep sensitive values out (they already correctly live in SSM).
- **Variable organization.** Group and prefix by concern (`app_host_*`,
  `graph_db_*`, `redis_*`, `app_platform_*`, `edge_*`/`cloudfront_*`) and give a
  single authoritative secret-key list. Consider `optional()` object variables
  for the app_platform sizing block to shrink the surface.
- **Terraform as the only mechanism.** No Vercel and no click-ops resources are
  present in code; the remaining gap to "Terraform is the source of truth" is
  the F1 import reconciliation and F2 self-sufficiency fix.

---

## 6. AWS WAFv2 web ACL (added by this task)

- **Where:** `modules/edge/main.tf` — added inline (the edge module already
  owns the CloudFront distribution and already receives the `aws.us_east_1`
  provider alias, so `web_acl_id` can reference the ACL ARN directly with no new
  cross-module wiring).
- **Resource:** `aws_wafv2_web_acl.this` — `provider = aws.us_east_1`,
  `scope = "CLOUDFRONT"`, `count = var.waf_enabled ? 1 : 0`, `default_action =
  allow`.
- **Rules:**
  1. `AWSManagedRulesCommonRuleSet` (priority 1, `override_action { none {} }`)
  2. `AWSManagedRulesKnownBadInputsRuleSet` (priority 2)
  3. `AWSManagedRulesAmazonIpReputationList` (priority 3)
  4. `RateLimitPerIP` (priority 10, `action { block {} }`,
     `rate_based_statement { limit = var.waf_rate_limit (default 2000),
     evaluation_window_sec = 300, aggregate_key_type = "IP" }`)
- **CloudWatch metrics:** every rule and the ACL itself set
  `visibility_config { cloudwatch_metrics_enabled = true, sampled_requests_enabled
  = true }` with distinct metric names.
- **Gating:** the whole `edge` module is `count`-gated by
  `var.enable_app_platform` at the environment root, and the WAF adds its own
  `var.waf_enabled` (default true) / env `var.cloudfront_waf_enabled` so it only
  exists when the platform is enabled and can be toggled independently.
- **Association / additivity:** the distribution gains a single new attribute,
  `web_acl_id = var.waf_enabled ? aws_wafv2_web_acl.this[0].arn : null`. For
  CloudFront this is an **in-place update** — it does **not** force replacement.
  No existing resource is modified or replaced apart from that one attribute; the
  WAF ACL and its outputs (`waf_web_acl_arn`, env `cloudfront_waf_web_acl_arn`)
  are net-new. Nothing is destroyed.
- **Wiring:** env `variables.tf` adds `cloudfront_waf_enabled` (default true)
  and `cloudfront_waf_rate_limit` (default 2000), passed into `module.edge`;
  env `outputs.tf` adds `cloudfront_waf_web_acl_arn` guarded by
  `one(module.edge[*]...)`.
- **Verification:** `terraform fmt -recursive`, `terraform init -backend=false`,
  and `terraform validate` all pass (**configuration is valid**).
