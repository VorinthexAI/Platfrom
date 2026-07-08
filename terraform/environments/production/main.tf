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
  tags               = local.tags
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

module "cache" {
  source = "../../modules/cache"

  name_prefix                = var.name_prefix
  subnet_ids                 = module.network.private_subnet_ids
  security_group_id          = module.network.cache_security_group_id
  redis_node_type            = var.redis_node_type
  num_cache_clusters         = var.redis_num_cache_clusters
  automatic_failover_enabled = var.redis_automatic_failover_enabled
  tags                       = local.tags
}

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
    REDIS_URL                  = module.cache.redis_url
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

module "render_service" {
  source = "../../modules/render-service"

  name_prefix          = var.name_prefix
  subnet_ids           = module.network.private_subnet_ids
  security_group_id    = module.network.render_security_group_id
  container_image      = "${module.storage.ecr_repository_url}:latest"
  task_cpu             = var.task_cpu
  task_memory          = var.task_memory
  desired_count        = var.render_desired_count
  ssm_parameter_prefix = local.normalized_ssm_prefix
  ssm_parameter_arns   = local.ssm_arns
  kms_key_arns         = var.kms_key_arns
  s3_bucket_arn        = module.storage.s3_bucket_arn
  tags                 = local.tags

  depends_on = [aws_ssm_parameter.prod]
}

# ---------------------------------------------------------------------------
# Target-state additive platform (ALB + ECS EC2 web/api + CloudFront). Gated by
# var.enable_app_platform (default false) so the default plan shows ZERO changes
# from these modules. When enabled they stand up ALONGSIDE the existing app/DB
# hosts and Redis, which stay running as the instant rollback until DNS cutover.
# ---------------------------------------------------------------------------
locals {
  effective_web_image = var.web_image != "" ? var.web_image : "${module.storage.ecr_web_repository_url}:latest"
  effective_api_image = var.api_image != "" ? var.api_image : "${module.storage.ecr_repository_url}:latest"
}

module "app_platform" {
  source = "../../modules/app-platform"
  count  = var.enable_app_platform ? 1 : 0

  name_prefix = var.name_prefix
  vpc_id      = module.network.vpc_id

  alb_subnet_ids = module.network.public_subnet_ids
  app_subnet_ids = module.network.private_subnet_ids

  # Attach to the EXISTING cluster created by the render-service module.
  cluster_name = module.render_service.cluster_name

  db_security_group_id    = module.network.graph_db_security_group_id
  cache_security_group_id = module.network.cache_security_group_id

  web_image = local.effective_web_image
  api_image = local.effective_api_image

  instance_type        = var.app_platform_instance_type
  asg_min_size         = var.app_platform_asg_min_size
  asg_max_size         = var.app_platform_asg_max_size
  asg_desired_capacity = var.app_platform_asg_min_size

  web_desired_count = var.web_desired_count
  api_desired_count = var.api_desired_count

  web_domain_names = var.web_domain_names
  api_domain_names = var.api_domain_names

  acm_certificate_arn = var.alb_acm_certificate_arn
  alb_https_enabled   = var.alb_https_enabled

  ssm_parameter_prefix = local.normalized_ssm_prefix
  ssm_parameter_arns   = local.ssm_arns
  kms_key_arns         = var.kms_key_arns
  s3_bucket_arn        = module.storage.s3_bucket_arn
  site_url             = var.site_url

  tags = local.tags

  depends_on = [aws_ssm_parameter.prod]
}

module "edge" {
  source = "../../modules/edge"
  count  = var.enable_app_platform ? 1 : 0

  providers = {
    aws.us_east_1 = aws.us_east_1
  }

  name_prefix     = var.name_prefix
  alb_domain_name = module.app_platform[0].alb_dns_name

  web_domain_names = var.web_domain_names
  api_domain_names = var.api_domain_names

  viewer_acm_certificate_arn = var.cloudfront_viewer_acm_certificate_arn
  origin_custom_header_value = var.cloudfront_origin_verify_value

  waf_enabled    = var.cloudfront_waf_enabled
  waf_rate_limit = var.cloudfront_waf_rate_limit

  tags = local.tags
}
