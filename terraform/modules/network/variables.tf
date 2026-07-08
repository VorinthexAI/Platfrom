variable "name_prefix" {
  type        = string
  description = "Prefix used for production network resources."
}

variable "vpc_id" {
  type        = string
  description = "Existing VPC ID to reuse. Leave null to create a new VPC."
  default     = null
}

variable "public_subnet_ids" {
  type        = list(string)
  description = "Existing public subnet IDs. Required when vpc_id is set."
  default     = []
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Existing private subnet IDs. Required when vpc_id is set."
  default     = []
}

variable "vpc_cidr" {
  type        = string
  description = "CIDR for the created production VPC."
  default     = "10.42.0.0/16"
}

variable "availability_zones" {
  type        = list(string)
  description = "Availability zones for created subnets."
  default     = []
}

variable "enable_nat" {
  type        = bool
  description = "Create the NAT gateway (+ EIP + private route). Set false to drop egress for private subnets — e.g. the early-infra teardown where nothing runs in private subnets."
  default     = true
}

variable "tags" {
  type        = map(string)
  description = "Tags to apply to created resources."
  default     = {}
}
