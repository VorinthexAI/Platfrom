variable "name_prefix" {
  type        = string
  description = "Prefix used for app-platform resources."
}

variable "vpc_id" {
  type        = string
  description = "VPC the ALB, ASG, and ECS tasks live in (the existing production VPC)."
}

variable "alb_subnet_ids" {
  type        = list(string)
  description = "Public subnet IDs for the internet-facing ALB (needs >= 2 AZs)."
}

variable "app_subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for the ECS EC2 ASG and the web/api task ENIs."
}

variable "cluster_name" {
  type        = string
  description = "Name of the EXISTING ECS cluster to attach the EC2 capacity provider and services to."
}

variable "db_security_group_id" {
  type        = string
  description = "ArangoDB security group id. The module ADDS an ingress rule from api-sg without removing existing rules."
}

variable "cache_security_group_id" {
  type        = string
  description = "Redis security group id. The module ADDS an ingress rule from api-sg without removing existing rules."
}

# ---- Images -----------------------------------------------------------------

variable "web_image" {
  type        = string
  description = "Container image (repo:tag) for the web (Next standalone) service."
}

variable "api_image" {
  type        = string
  description = "Container image (repo:tag) for the api (Hono) service."
}

# ---- ECS EC2 capacity (ASG) -------------------------------------------------

variable "instance_type" {
  type        = string
  description = "Graviton instance type for the ECS EC2 capacity ASG (web/api/render compute ONLY, never the DB)."
  default     = "t4g.medium"
}

variable "asg_min_size" {
  type        = number
  description = "Minimum ECS EC2 capacity instances."
  default     = 1
}

variable "asg_max_size" {
  type        = number
  description = "Maximum ECS EC2 capacity instances."
  default     = 4
}

variable "asg_desired_capacity" {
  type        = number
  description = "Initial desired ECS EC2 capacity instances."
  default     = 1
}

variable "instance_root_volume_size" {
  type        = number
  description = "Root EBS volume size (GiB) for ECS EC2 capacity instances."
  default     = 40
}

# ---- Service sizing ---------------------------------------------------------

variable "web_cpu" {
  type        = number
  description = "web task CPU units."
  default     = 512
}

variable "web_memory" {
  type        = number
  description = "web task memory (MiB)."
  default     = 1024
}

variable "web_desired_count" {
  type        = number
  description = "web service desired task count (kept small so it does not fight existing infra)."
  default     = 1
}

variable "web_min_count" {
  type        = number
  description = "web service autoscaling minimum."
  default     = 1
}

variable "web_max_count" {
  type        = number
  description = "web service autoscaling maximum."
  default     = 6
}

variable "api_cpu" {
  type        = number
  description = "api task CPU units."
  default     = 1024
}

variable "api_memory" {
  type        = number
  description = "api task memory (MiB)."
  default     = 2048
}

variable "api_desired_count" {
  type        = number
  description = "api service desired task count (kept small so it does not fight existing infra)."
  default     = 1
}

variable "api_min_count" {
  type        = number
  description = "api service autoscaling minimum."
  default     = 1
}

variable "api_max_count" {
  type        = number
  description = "api service autoscaling maximum."
  default     = 6
}

# ---- Routing / domains ------------------------------------------------------

variable "web_domain_names" {
  type        = list(string)
  description = "Public web hostnames (apex + subdomains) served by the web target group. First entry is the ACM primary domain."
  default     = []
}

variable "api_domain_names" {
  type        = list(string)
  description = "Public api hostnames (e.g. api.vorinthex.com) routed to the api target group."
  default     = []
}

variable "alb_idle_timeout" {
  type        = number
  description = "ALB idle timeout (seconds). Must be >= 300 so long-lived SSE streams are not cut."
  default     = 300

  validation {
    condition     = var.alb_idle_timeout >= 300
    error_message = "alb_idle_timeout must be at least 300s to keep SSE streams alive."
  }
}

variable "api_deregistration_delay" {
  type        = number
  description = "api target group deregistration (connection draining) delay in seconds; >= SSE heartbeat interval."
  default     = 300
}

variable "web_health_check_path" {
  type        = string
  description = "Health check path for the web target group."
  default     = "/"
}

variable "api_health_check_path" {
  type        = string
  description = "Health check path for the api target group."
  default     = "/api/v1/health"
}

variable "web_container_port" {
  type        = number
  description = "Container port the web service listens on."
  default     = 3000
}

variable "api_container_port" {
  type        = number
  description = "Container port the api service listens on."
  default     = 3001
}

# ---- TLS on the ALB (optional; CloudFront can front over HTTP-80) -----------

variable "acm_certificate_arn" {
  type        = string
  description = "Existing validated regional ACM cert ARN for the ALB HTTPS listener. Empty = create one (DNS-validated, outputs only)."
  default     = ""
}

variable "alb_https_enabled" {
  type        = bool
  description = "Create the ALB 443 listener. Keep false until the ACM cert is DNS-validated so apply does not require a validated cert."
  default     = false
}

variable "alb_ssl_policy" {
  type        = string
  description = "SSL policy for the ALB HTTPS listener."
  default     = "ELBSecurityPolicy-TLS13-1-2-2021-06"
}

# ---- Secrets / IAM ----------------------------------------------------------

variable "ssm_parameter_prefix" {
  type        = string
  description = "SSM parameter prefix WITHOUT a leading slash (e.g. vorinthex/prod)."
}

variable "ssm_parameter_arns" {
  type        = list(string)
  description = "SSM parameter ARNs the execution role may read for secrets injection."
}

variable "kms_key_arns" {
  type        = list(string)
  description = "KMS key ARNs required to decrypt SSM SecureString parameters."
  default     = ["*"]
}

variable "api_secret_keys" {
  type        = list(string)
  description = "SSM keys injected into the api task as container secrets."
  default = [
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
}

variable "s3_bucket_arn" {
  type        = string
  description = "Runtime S3 bucket ARN granted to the api task role."
}

variable "site_url" {
  type        = string
  description = "NEXT_PUBLIC_SITE_URL passed to the web container."
  default     = "https://vorinthex.com"
}

variable "log_retention_days" {
  type        = number
  description = "CloudWatch log retention for the web/api log groups."
  default     = 30
}

variable "tags" {
  type        = map(string)
  description = "Tags to apply to created resources."
  default     = {}
}
