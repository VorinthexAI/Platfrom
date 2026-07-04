variable "name_prefix" {
  type        = string
  description = "Prefix used for render resources."
}

variable "subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for Fargate tasks."
}

variable "security_group_id" {
  type        = string
  description = "Security group ID for render tasks."
}

variable "task_family" {
  type        = string
  description = "ECS task definition family for render."
  default     = "vorinthex-render"
}

variable "cluster_name" {
  type        = string
  description = "ECS cluster name."
  default     = "vorinthex-production"
}

variable "service_name" {
  type        = string
  description = "ECS service name."
  default     = "vorinthex-render"
}

variable "container_image" {
  type        = string
  description = "Initial render container image."
}

variable "task_cpu" {
  type        = number
  description = "Render task CPU units."
}

variable "task_memory" {
  type        = number
  description = "Render task memory in MiB."
}

variable "desired_count" {
  type        = number
  description = "Desired render task count."
  default     = 1
}

variable "ssm_parameter_prefix" {
  type        = string
  description = "SSM parameter prefix without leading slash."
}

variable "ssm_parameter_arns" {
  type        = list(string)
  description = "SSM parameter ARNs render may read."
}

variable "kms_key_arns" {
  type        = list(string)
  description = "KMS key ARNs required to decrypt SSM SecureString parameters."
  default     = ["*"]
}

variable "s3_bucket_arn" {
  type        = string
  description = "Runtime S3 bucket ARN."
}

variable "capacity_provider" {
  type        = string
  description = "Fargate capacity provider."
  default     = "FARGATE_SPOT"
}

variable "tags" {
  type        = map(string)
  description = "Tags to apply to created resources."
  default     = {}
}
