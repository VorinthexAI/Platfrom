# Production Infrastructure Implementation Summary

This summarizes how the Terraform deliverables satisfy the production
infrastructure requirements that were captured in `deploy.md`.

## Delivered Artifacts

- `terraform/modules/network/`
- `terraform/modules/app-host/`
- `terraform/modules/render-service/`
- `terraform/modules/database/`
- `terraform/modules/cache/`
- `terraform/modules/storage/`
- `terraform/environments/production/`
- `.github/workflows/infra.yml`
- `terraform/README.md`

No `terraform/environments/staging/` directory was created.

## Success Criteria

1. Single production environment:
   `terraform/environments/production/` is the only Terraform environment.

2. App role stays on one EC2 host:
   `terraform/modules/app-host/` creates `aws_instance.this`, an Elastic IP,
   an instance profile, and a deploy key. There is no Auto Scaling Group and no
   ECS service for the app role.

3. Render role runs on ECS/Fargate:
   `terraform/modules/render-service/` creates an ECS cluster, Fargate task
   definition, and ECS service with `requires_compatibilities = ["FARGATE"]`.

4. CI-managed render revisions are not reverted by Terraform:
   `aws_ecs_task_definition.render` ignores `container_definitions`, and
   `aws_ecs_service.render` ignores `task_definition`.

5. SSM parameter values are not reverted by Terraform:
   `aws_ssm_parameter.prod` creates SecureString parameters under
   `/vorinthex/prod/` and ignores `value` changes.

6. Remote state uses S3 native locking:
   `terraform/environments/production/versions.tf` uses a partial
   `backend "s3" {}` and `.github/workflows/infra.yml` passes
   `use_lockfile=true` during `terraform init`.

7. Sizing values are variable-driven:
   `instance_type`, `db_instance_class`, `task_cpu`, `task_memory`, and
   `redis_node_type` have Terraform defaults and are wired through
   `workflow_dispatch` inputs with GitHub Variable fallbacks in `infra.yml`.

8. Existing deploy workflow variables are preserved:
   Terraform outputs match the existing handoff names for `APP_HEALTH_URL`,
   `APP_EC2_HOST`, `APP_EC2_USER`, `APP_EC2_SSH_KEY`,
   `RENDER_TASK_FAMILY`, `RENDER_ECS_CLUSTER`, and `RENDER_ECS_SERVICE`.

9. RDS has production deletion protection:
   `terraform/modules/database/main.tf` sets `deletion_protection = true`.

10. Security groups are role-scoped:
    The app host allows public HTTP/HTTPS and configured SSH CIDRs. RDS and
    Redis allow inbound traffic only from the app and render security groups.
    Render has no inbound rule.

11. App host bootstrap is limited:
    EC2 user data installs Docker and Docker Compose and creates the deploy
    directory. It does not install app-specific compose state or run a deploy.

12. Existing `.github/workflows/deploy.yml` was not modified:
    The new infrastructure workflow is separate at `.github/workflows/infra.yml`.

## Explicit Assumptions

- A new VPC is created by default. Existing VPC reuse is supported when
  `vpc_id`, `public_subnet_ids`, and `private_subnet_ids` are supplied.
- Amazon Linux 2023 is used for the app host.
- Redis starts as one encrypted node with automatic failover disabled.
- The app EC2 instance does not get direct SSM read access unless
  `allow_app_instance_ssm_read = true`; the existing deploy workflow renders
  `.env` from SSM on the GitHub runner.
- A `.tmp-backend-prod.env` scratch file, generated at CI-time from the git-crypt-encrypted
  `.github/environments.json`, is parsed into SecureString SSM parameters if present. Terraform
  state will store those values regardless of where they came from.

## Verification Performed

- `terraform fmt -check -recursive ..\..`
- `terraform init -backend=false`
- `terraform validate`
- `bun run check`
- `bun run test`

A live AWS `terraform plan` and `terraform apply` were intentionally not run.
