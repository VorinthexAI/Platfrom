variable "name_prefix" {
  type        = string
  description = "Prefix used for storage resources."
}

variable "ecr_repository_name" {
  type        = string
  description = "ECR repository name for the shared backend image."
  default     = "vorinthex-backend"
}

variable "s3_bucket_name" {
  type        = string
  description = "Globally unique S3 bucket name for runtime object storage."
}

variable "tags" {
  type        = map(string)
  description = "Tags to apply to created resources."
  default     = {}
}
