output "alb_arn" {
  value = aws_lb.this.arn
}

output "alb_dns_name" {
  description = "ALB DNS name; point the CloudFront origin (or a DNS CNAME) at this."
  value       = aws_lb.this.dns_name
}

output "alb_zone_id" {
  value = aws_lb.this.zone_id
}

output "web_target_group_arn" {
  value = aws_lb_target_group.web.arn
}

output "api_target_group_arn" {
  value = aws_lb_target_group.api.arn
}

output "alb_security_group_id" {
  value = aws_security_group.alb.id
}

output "web_security_group_id" {
  value = aws_security_group.web.id
}

output "api_security_group_id" {
  value = aws_security_group.api.id
}

output "capacity_provider_name" {
  value = aws_ecs_capacity_provider.ec2.name
}

output "web_service_name" {
  value = aws_ecs_service.web.name
}

output "api_service_name" {
  value = aws_ecs_service.api.name
}

output "web_task_family" {
  value = aws_ecs_task_definition.web.family
}

output "api_task_family" {
  value = aws_ecs_task_definition.api.family
}

# DNS-validation records for the ALB ACM cert (Cloudflare-managed DNS). Empty
# when an existing cert ARN was supplied.
output "alb_acm_certificate_arn" {
  value = local.alb_cert_arn
}

output "alb_acm_validation_records" {
  description = "CNAME records to add in DNS to validate the ALB ACM certificate."
  value = local.create_alb_acm ? [
    for dvo in aws_acm_certificate.alb[0].domain_validation_options : {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  ] : []
}
