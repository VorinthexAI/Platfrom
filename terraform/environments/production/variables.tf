variable "aws_region" {
  type        = string
  description = "AWS region for production resources."
  default     = "eu-north-1"
}

variable "name_prefix" {
  type        = string
  description = "Name prefix for production resources."
  default     = "vorinthex-prod"
}

variable "vpc_id" {
  type        = string
  description = "Existing VPC ID to reuse. Leave empty to create a new VPC."
  default     = ""

  validation {
    condition     = var.vpc_id == "" || can(regex("^vpc-[0-9a-f]+$", var.vpc_id))
    error_message = "vpc_id must be empty or a valid VPC ID."
  }
}

variable "public_subnet_ids" {
  type        = list(string)
  description = "Existing public subnet IDs when reusing a VPC."
  default     = []
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Existing private subnet IDs when reusing a VPC."
  default     = []
}

variable "vpc_cidr" {
  type        = string
  description = "CIDR for a newly created VPC."
  default     = "10.42.0.0/16"
}

variable "ssh_ingress_cidr_blocks" {
  type = list(string)
  # SAFETY (Wave 0): default is now EMPTY (no world-open SSH) instead of
  # 0.0.0.0/0. Break-glass access is via SSM Session Manager on the app host.
  # This is overridable so we never lock ourselves out: set it (e.g. via the
  # infra.yml `ssh_ingress_cidr_blocks` input or PROD_SSH_INGRESS_CIDR_BLOCKS)
  # to your office/CI CIDR(s) BEFORE apply if the current SSH-based deploy still
  # needs to reach the app and graph-db hosts. On apply with the empty default,
  # the pre-existing world-open SSH ingress rules on those SGs are removed.
  description = "CIDR blocks allowed to SSH to the app/graph-db hosts. Empty = no SSH ingress (use SSM Session Manager)."
  default     = []

  validation {
    condition = alltrue([
      for cidr in var.ssh_ingress_cidr_blocks : can(cidrhost(cidr, 0))
    ])
    error_message = "ssh_ingress_cidr_blocks must contain valid CIDR blocks."
  }
}

variable "ssh_public_key" {
  type        = string
  description = "Existing deploy SSH public key. Leave empty to generate one."
  default     = ""
  sensitive   = true
}

variable "instance_type" {
  type        = string
  description = "EC2 instance type for the app host."
  default     = "t3.small"
}

variable "graph_db_instance_type" {
  type        = string
  description = "EC2 instance type for the self-hosted ArangoDB host."
  default     = "t3.small"
}

variable "graph_db_volume_size" {
  type        = number
  description = "EBS data volume size (GiB) for ArangoDB's persistent storage."
  default     = 30
}

variable "graph_db_name" {
  type        = string
  description = "Production ArangoDB database name."
  default     = "vorinthex"
}

variable "redis_node_type" {
  type        = string
  description = "ElastiCache Redis node type."
  default     = "cache.t4g.micro"
}

variable "redis_num_cache_clusters" {
  type        = number
  description = "Number of Redis cache clusters."
  default     = 1
}

variable "redis_automatic_failover_enabled" {
  type        = bool
  description = "Enable Redis automatic failover."
  default     = false
}

variable "task_cpu" {
  type        = number
  description = "Render task CPU units."
  default     = 1024
}

variable "task_memory" {
  type        = number
  description = "Render task memory in MiB."
  default     = 2048
}

variable "render_desired_count" {
  type = number
  # SAFETY (Wave 0): the render worker is not implemented yet, so the stub
  # crash-loops if scheduled. Keep desired count at 0 until the worker is real.
  description = "Desired render task count (0 until the render worker is implemented)."
  default     = 0
}

variable "s3_bucket_name" {
  type        = string
  description = "Globally unique S3 bucket name for runtime object storage."
}

variable "ecr_repository_name" {
  type        = string
  description = "ECR repository name."
  default     = "vorinthex-backend"
}

variable "ssm_parameter_prefix" {
  type        = string
  description = "SSM parameter prefix without a leading slash."
  default     = "vorinthex/prod"
}

variable "kms_key_arns" {
  type        = list(string)
  description = "KMS key ARNs for decrypting SecureString SSM parameters."
  default     = ["*"]
}

variable "allow_app_instance_ssm_read" {
  type        = bool
  description = "Attach SSM read access to the EC2 app instance profile."
  default     = false
}

# ---- AMI pins (SAFETY) ------------------------------------------------------
# Optional explicit AMI ids for the existing hosts. Leaving these empty is safe:
# both hosts carry lifecycle.ignore_changes = [ami], so the AL2023 "latest"
# pointer can never force-replace them. Set them to the live AMI ids to make the
# pin explicit (see the modules' variable comments for the describe-instances
# command to confirm the running ids).
variable "app_ami_id" {
  type        = string
  description = "Pinned AMI id for the app host. Empty = AL2023 latest (protected by ignore_changes)."
  default     = ""
}

variable "graph_db_ami_id" {
  type        = string
  description = "Pinned AMI id for the graph-db host. Empty = AL2023 latest (protected by ignore_changes)."
  default     = ""
}

# ---- EBS DLM snapshots (Wave 0 safety, always on) ---------------------------
variable "graph_db_snapshot_retain_count" {
  type        = number
  description = "Number of DLM snapshots to retain for the graph-db data volume."
  default     = 14
}

# ---- Target-state app platform (ALB + ECS EC2 + CloudFront) -----------------
# Gated OFF by default. With enable_app_platform = false the new modules create
# NOTHING and a plan shows zero changes from them. Flip to true (after the web
# and api images exist in ECR) to stand the new tiers up ALONGSIDE the running
# app/DB, which remain the instant rollback until a manual DNS cutover.
variable "enable_app_platform" {
  type        = bool
  description = "Create the additive ALB + ECS EC2 web/api services + CloudFront target-state platform."
  default     = false
}

variable "web_image" {
  type        = string
  description = "Full web container image (repo:tag). Empty = derive <web-ecr-url>:latest."
  default     = ""
}

variable "api_image" {
  type        = string
  description = "Full api container image (repo:tag). Empty = derive <backend-ecr-url>:latest."
  default     = ""
}

variable "app_platform_instance_type" {
  type        = string
  description = "Graviton instance type for the ECS EC2 capacity ASG (web/api compute only)."
  default     = "t4g.medium"
}

variable "app_platform_asg_min_size" {
  type        = number
  description = "Minimum ECS EC2 capacity instances."
  default     = 1
}

variable "app_platform_asg_max_size" {
  type        = number
  description = "Maximum ECS EC2 capacity instances. Capped at 2: web+api (2 small tasks) fit on one t4g.medium; the 2nd node is only for rolling-deploy headroom / HA. Raise deliberately when real traffic needs it — a deploy spike once ran this to 4 and got stuck via managed termination protection."
  default     = 2
}

variable "web_desired_count" {
  type        = number
  description = "web ECS service desired task count."
  default     = 1
}

variable "api_desired_count" {
  type        = number
  description = "api ECS service desired task count."
  default     = 1
}

variable "web_domain_names" {
  type        = list(string)
  description = "Public web hostnames for the ALB/CloudFront and ACM certs."
  # Apex + wildcard: one CloudFront alias set covers vorinthex.com and every
  # entity subdomain (core/command/atlas/hunt/…). proxy.ts routes by Host.
  default = ["vorinthex.com", "*.vorinthex.com"]
}

variable "api_domain_names" {
  type        = list(string)
  description = "Public api hostnames routed to the api target group."
  default     = []
}

variable "alb_https_enabled" {
  type        = bool
  description = "Create the ALB 443 listener (only after the ACM cert is DNS-validated)."
  default     = false
}

variable "alb_acm_certificate_arn" {
  type        = string
  description = "Existing validated regional ACM cert ARN for the ALB. Empty = create one (outputs only)."
  default     = ""
}

variable "cloudfront_viewer_acm_certificate_arn" {
  type        = string
  description = "Existing validated us-east-1 ACM cert ARN for CloudFront aliases. Empty = default cert, no aliases."
  # us-east-1 wildcard cert (vorinthex.com + *.vorinthex.com), DNS-validated via
  # Cloudflare. Apply CloudFront with this only after ACM status = ISSUED.
  default = "arn:aws:acm:us-east-1:938565868704:certificate/9d512719-f631-411c-8067-8b30e3309b6d"
}

variable "cloudfront_origin_verify_value" {
  type        = string
  description = "Shared secret CloudFront sends as an origin-verify header. Empty = no header."
  default     = ""
  sensitive   = true
}

variable "site_url" {
  type        = string
  description = "NEXT_PUBLIC_SITE_URL for the web container."
  default     = "https://vorinthex.com"
}

# ---- CloudFront WAF (part of the edge module; only exists when the platform is
# enabled because module.edge itself is gated by enable_app_platform) ----------
variable "cloudfront_waf_enabled" {
  type        = bool
  description = "Attach a CLOUDFRONT-scope WAFv2 web ACL (AWS managed rule groups + per-IP rate limit) to the distribution."
  default     = true
}

variable "cloudfront_waf_rate_limit" {
  type        = number
  description = "Per-IP request limit over a 5-minute window before the WAF rate-based rule blocks the source IP."
  default     = 2000
}
