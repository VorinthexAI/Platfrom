variable "name_prefix" {
  type        = string
  description = "Prefix used for app host resources."
}

variable "subnet_id" {
  type        = string
  description = "Public subnet ID for the app EC2 host."
}

variable "security_group_id" {
  type        = string
  description = "Security group ID attached to the app EC2 host."
}

variable "instance_type" {
  type        = string
  description = "EC2 instance type for the app host."
}

# SAFETY: pin the AMI so a routine apply never re-images the running host.
# When empty, the module falls back to the AL2023 SSM "latest" pointer, but the
# instance also carries lifecycle.ignore_changes = [ami], so even the "latest"
# path can never force-replace the existing instance. To make the pin explicit,
# set this to the AMI id the running instance actually uses. TODO(confirm):
# resolve the live value before apply, e.g.
#   aws ec2 describe-instances \
#     --filters Name=tag:Name,Values=vorinthex-prod-app-host \
#     --query 'Reservations[].Instances[].ImageId' --output text
variable "ami_id" {
  type        = string
  description = "Pinned AMI id for the app host. Empty = AL2023 SSM latest (still protected by ignore_changes)."
  default     = ""
}

variable "ssh_ingress_cidr_blocks" {
  type        = list(string)
  description = "CIDR blocks allowed to SSH to the app host."
}

variable "ssh_public_key" {
  type        = string
  description = "Existing deploy SSH public key. Leave empty to generate one."
  default     = ""
  sensitive   = true
}

variable "ssm_parameter_arns" {
  type        = list(string)
  description = "SSM parameter ARNs the instance may read directly."
  default     = []
}

variable "kms_key_arns" {
  type        = list(string)
  description = "KMS key ARNs required to decrypt SSM SecureString parameters."
  default     = ["*"]
}

variable "allow_instance_ssm_read" {
  type        = bool
  description = "Attach direct SSM read access to the EC2 instance profile."
  default     = false
}

variable "root_volume_size" {
  type        = number
  description = "Root volume size in GiB."
  default     = 30
}

variable "tags" {
  type        = map(string)
  description = "Tags to apply to created resources."
  default     = {}
}
