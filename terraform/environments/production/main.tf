locals {
  environment = "production"
  tags = {
    Project     = "vorinthex"
    Environment = local.environment
    ManagedBy   = "terraform"
  }

  normalized_ssm_prefix = trimprefix(var.ssm_parameter_prefix, "/")
  ssm_path              = "/${local.normalized_ssm_prefix}"
  prod_env_path         = abspath("${path.root}/../../../environments/backend/.env.prod")
  prod_env_lines        = fileexists(local.prod_env_path) ? split("\n", file(local.prod_env_path)) : []
  prod_env_entries = [
    for raw_line in local.prod_env_lines : {
      key   = trimspace(split("=", raw_line)[0])
      value = trimspace(join("=", slice(split("=", raw_line), 1, length(split("=", raw_line)))))
    }
    if trimspace(raw_line) != "" && !startswith(trimspace(raw_line), "#") && length(split("=", raw_line)) > 1
  ]
  prod_env_values = {
    for entry in local.prod_env_entries : entry.key => entry.value
  }
}

module "network" {
  source = "../../modules/network"

  name_prefix        = var.name_prefix
  vpc_id             = var.vpc_id
  public_subnet_ids  = var.public_subnet_ids
  private_subnet_ids = var.private_subnet_ids
  vpc_cidr           = var.vpc_cidr
  # Early-infra: nothing runs in private subnets anymore (ECS/render retired),
  # so drop the ~$40/mo NAT gateway. The app + DB boxes live in public subnets.
  enable_nat = false
  tags       = local.tags
}

module "storage" {
  source = "../../modules/storage"

  name_prefix         = var.name_prefix
  ecr_repository_name = var.ecr_repository_name
  s3_bucket_name      = var.s3_bucket_name
  tags                = local.tags
}

resource "tls_private_key" "deploy" {
  algorithm = "ED25519"
}

locals {
  effective_ssh_public_key = var.ssh_public_key != "" ? var.ssh_public_key : tls_private_key.deploy.public_key_openssh
  graph_db_subnet_id       = element(module.network.public_subnet_ids, min(1, length(module.network.public_subnet_ids) - 1))
}

resource "random_password" "graph_db_password" {
  length  = 32
  special = false
}

module "graph_db_host" {
  source = "../../modules/graph-db-host"

  name_prefix             = var.name_prefix
  subnet_id               = local.graph_db_subnet_id
  security_group_id       = module.network.graph_db_security_group_id
  instance_type           = var.graph_db_instance_type
  data_volume_size        = var.graph_db_volume_size
  ssh_ingress_cidr_blocks = var.ssh_ingress_cidr_blocks
  ssh_public_key          = local.effective_ssh_public_key
  ami_id                  = var.graph_db_ami_id
  tags                    = local.tags
}

# Wave 0 safety: automated DLM snapshots of the ArangoDB data volume. Selects
# the existing volume by its Name tag, so it never mutates the volume itself.
module "graph_db_backup" {
  source = "../../modules/backup"

  name_prefix           = var.name_prefix
  target_volume_tags    = { Name = "${var.name_prefix}-graph-db-data" }
  snapshot_retain_count = var.graph_db_snapshot_retain_count
  tags                  = local.tags
}

# (Removed module "cache" — retired in the early-infra cost teardown.)

resource "random_password" "api_key" {
  length  = 48
  special = false
}

resource "random_password" "access_token_secret" {
  length  = 64
  special = false
}

resource "random_password" "totp_secret_encryption_key" {
  length  = 32
  special = false
}

locals {
  generated_env_values = {
    AWS_REGION                 = var.aws_region
    ARANGO_URL                 = "http://${module.graph_db_host.private_ip}:8529"
    ARANGO_DATABASE            = var.graph_db_name
    ARANGO_USERNAME            = "root"
    ARANGO_ROOT_PASSWORD       = random_password.graph_db_password.result
    REDIS_URL                  = "redis://localhost:6379"
    S3_BUCKET                  = module.storage.s3_bucket_name
    API_KEY                    = random_password.api_key.result
    ACCESS_TOKEN_SECRET        = random_password.access_token_secret.result
    TOTP_SECRET_ENCRYPTION_KEY = random_password.totp_secret_encryption_key.result
  }

  generated_env_keys = [
    "AWS_REGION",
    "ARANGO_URL",
    "ARANGO_DATABASE",
    "ARANGO_USERNAME",
    "ARANGO_ROOT_PASSWORD",
    "REDIS_URL",
    "S3_BUCKET",
    "API_KEY",
    "ACCESS_TOKEN_SECRET",
    "TOTP_SECRET_ENCRYPTION_KEY"
  ]
  ssm_values = merge(local.generated_env_values, local.prod_env_values)
  ssm_keys   = toset(distinct(concat(local.generated_env_keys, keys(local.prod_env_values))))
  ssm_arns = [
    for key in local.ssm_keys :
    "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${local.normalized_ssm_prefix}/${key}"
  ]
  ssm_prefix_arn = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${local.normalized_ssm_prefix}/*"
}

data "aws_caller_identity" "current" {}

check "vpc_reuse_inputs" {
  assert {
    condition = var.vpc_id == "" || (
      length(var.public_subnet_ids) >= 1 &&
      length(var.private_subnet_ids) >= 2
    )
    error_message = "When vpc_id is set, provide at least one public subnet and two private subnets."
  }
}

resource "aws_ssm_parameter" "prod" {
  for_each = local.ssm_keys

  name        = "${local.ssm_path}/${each.value}"
  description = "Vorinthex production ${each.value}"
  type        = "SecureString"
  value       = tostring(local.ssm_values[each.value])
  overwrite   = true

  tags = local.tags

  lifecycle {
    ignore_changes = [value]
  }
}

# (Removed the app_host module: the backend was cut over to the autoscaling ECS
# api service — api.vorinthex.com → CloudFront → ALB → ECS. The old blue-green
# EC2 backend host is retired; this destroys its instance + EIP + IAM. The
# ArangoDB graph-db host, Redis, and the shared SSH key remain. var.instance_type
# and the network app SG are now unused but harmless.)

# (Removed module "render_service" — retired in the early-infra cost teardown.)

# ---------------------------------------------------------------------------
# Target-state additive platform (ALB + ECS EC2 web/api + CloudFront). Gated by
# var.enable_app_platform (default false) so the default plan shows ZERO changes
# from these modules. When enabled they stand up ALONGSIDE the existing app/DB
# hosts and Redis, which stay running as the instant rollback until DNS cutover.
# ---------------------------------------------------------------------------

# (Removed module "app_platform" — retired in the early-infra cost teardown.)

# (Removed module "edge" — retired in the early-infra cost teardown.)
