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
  type        = list(string)
  description = "CIDR blocks allowed to SSH to the app host."
  default     = ["0.0.0.0/0"]

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
  type        = number
  description = "Desired render task count."
  default     = 1
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
