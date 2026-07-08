variable "name_prefix" {
  type        = string
  description = "Prefix used for storage resources."
}

variable "ecr_repository_name" {
  type        = string
  description = "ECR repository name for the shared backend image."
  default     = "vorinthex-backend"
}

variable "ecr_web_repository_name" {
  type        = string
  description = "ECR repository name for the web (Next standalone) image."
  default     = "vorinthex-web"
}

variable "ecr_keep_last_images" {
  type        = number
  description = "Number of most-recent sha-tagged images to retain per ECR repo."
  default     = 20
}

variable "s3_noncurrent_version_expiration_days" {
  type        = number
  description = "Days before noncurrent object versions in the runtime bucket expire."
  default     = 30
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
