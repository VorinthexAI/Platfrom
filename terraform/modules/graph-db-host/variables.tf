variable "name_prefix" {
  type        = string
  description = "Prefix used for graph-db host resources."
}

variable "subnet_id" {
  type        = string
  description = "Public subnet ID for the graph-db EC2 host."
}

variable "security_group_id" {
  type        = string
  description = "Security group ID attached to the graph-db EC2 host."
}

variable "instance_type" {
  type        = string
  description = "EC2 instance type for the graph-db host."
}

# SAFETY: pin the AMI so a routine apply never re-images the ArangoDB host and
# risks the attached EBS data volume. When empty, the module falls back to the
# AL2023 SSM "latest" pointer, but the instance also carries
# lifecycle.ignore_changes = [ami], so the "latest" path can never force-replace
# the running database host. Set this to the live AMI id to make the pin
# explicit. TODO(confirm) before apply, e.g.
#   aws ec2 describe-instances \
#     --filters Name=tag:Name,Values=vorinthex-prod-graph-db-host \
#     --query 'Reservations[].Instances[].ImageId' --output text
variable "ami_id" {
  type        = string
  description = "Pinned AMI id for the graph-db host. Empty = AL2023 SSM latest (still protected by ignore_changes)."
  default     = ""
}

variable "ssh_ingress_cidr_blocks" {
  type        = list(string)
  description = "CIDR blocks allowed to SSH to the graph-db host."
}

variable "ssh_public_key" {
  type        = string
  description = "Deploy SSH public key (shared with the app host so CI can reach both with one key)."
  sensitive   = true
}

variable "root_volume_size" {
  type        = number
  description = "Root volume size in GiB."
  default     = 20
}

variable "data_volume_size" {
  type        = number
  description = "EBS data volume size in GiB, mounted at /data/arangodb for ArangoDB's persistent storage."
  default     = 30
}

variable "tags" {
  type        = map(string)
  description = "Tags to apply to created resources."
  default     = {}
}
