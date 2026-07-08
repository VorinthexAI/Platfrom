output "distribution_id" {
  value = aws_cloudfront_distribution.this.id
}

output "distribution_domain_name" {
  description = "CloudFront domain; point Cloudflare (or DNS) CNAMEs at this."
  value       = aws_cloudfront_distribution.this.domain_name
}

output "waf_web_acl_arn" {
  description = "ARN of the CloudFront-scope WAFv2 web ACL (null when waf_enabled = false)."
  value       = var.waf_enabled ? aws_wafv2_web_acl.this[0].arn : null
}

output "cloudfront_acm_certificate_arn" {
  value = local.create_acm ? aws_acm_certificate.cloudfront[0].arn : var.viewer_acm_certificate_arn
}

output "cloudfront_acm_validation_records" {
  description = "CNAME records to add in DNS to validate the CloudFront (us-east-1) ACM certificate."
  value = local.create_acm ? [
    for dvo in aws_acm_certificate.cloudfront[0].domain_validation_options : {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  ] : []
}
