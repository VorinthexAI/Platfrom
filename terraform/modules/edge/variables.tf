variable "name_prefix" {
  type        = string
  description = "Prefix used for edge (CloudFront/ACM) resources."
}

variable "alb_domain_name" {
  type        = string
  description = "Origin domain name (the ALB DNS name) CloudFront forwards to."
}

variable "web_domain_names" {
  type        = list(string)
  description = "Viewer aliases (CNAMEs) served by the distribution. First entry is the ACM primary domain."
  default     = []
}

variable "api_domain_names" {
  type        = list(string)
  description = "Additional api aliases to include on the viewer certificate."
  default     = []
}

variable "viewer_acm_certificate_arn" {
  type        = string
  description = "Validated us-east-1 ACM cert ARN for CloudFront aliases. Empty = use the CloudFront default cert and no aliases (apply stays unblocked)."
  default     = ""
}

variable "origin_custom_header_name" {
  type        = string
  description = "Header name CloudFront adds so the ALB can trust only CloudFront-originated traffic."
  default     = "X-Origin-Verify"
}

variable "origin_custom_header_value" {
  type        = string
  description = "Shared secret value for the origin-verify header. Empty = do not add the header."
  default     = ""
  sensitive   = true
}

variable "price_class" {
  type        = string
  description = "CloudFront price class."
  default     = "PriceClass_100"
}

variable "tags" {
  type        = map(string)
  description = "Tags to apply to created resources."
  default     = {}
}
