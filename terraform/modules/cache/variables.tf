variable "name_prefix" {
  type        = string
  description = "Prefix used for cache resources."
}

variable "subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for Redis."
}

variable "security_group_id" {
  type        = string
  description = "Security group ID attached to Redis."
}

variable "redis_node_type" {
  type        = string
  description = "ElastiCache Redis node type."
}

variable "num_cache_clusters" {
  type        = number
  description = "Number of Redis cache clusters in the replication group."
  default     = 1
}

variable "automatic_failover_enabled" {
  type        = bool
  description = "Enable Redis automatic failover."
  default     = false
}

variable "engine_version" {
  type        = string
  description = "Redis engine version."
  default     = "7.1"
}

variable "tags" {
  type        = map(string)
  description = "Tags to apply to created resources."
  default     = {}
}
