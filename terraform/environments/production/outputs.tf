output "app_health_url" {
  description = "Set GitHub variable APP_HEALTH_URL to this value after DNS points at the app host."
  value       = "https://api.vorinthex.com/api/v1/health"
}

output "app_ec2_host" {
  description = "Set GitHub secret APP_EC2_HOST to this value."
  value       = module.app_host.public_ip
}

output "app_ec2_user" {
  description = "Set GitHub secret APP_EC2_USER to this value."
  value       = module.app_host.ssh_user
}

output "app_ec2_ssh_private_key" {
  description = "Set GitHub secret APP_EC2_SSH_KEY to this value if Terraform generated the key. This same key is authorized on both the app host and the graph-db host."
  value       = var.ssh_public_key == "" ? tls_private_key.deploy.private_key_openssh : ""
  sensitive   = true
}

output "graph_db_ec2_host" {
  description = "Set GitHub secret GRAPH_DB_EC2_HOST to this value."
  value       = module.graph_db_host.public_ip
}

output "graph_db_ec2_private_ip" {
  description = "Private IP the app/render roles use to reach ArangoDB (ARANGO_URL)."
  value       = module.graph_db_host.private_ip
}

output "graph_db_ec2_user" {
  description = "Set GitHub secret GRAPH_DB_EC2_USER to this value."
  value       = module.graph_db_host.ssh_user
}

output "render_task_family" {
  description = "Set GitHub variable RENDER_TASK_FAMILY to this value."
  value       = module.render_service.task_family
}

output "render_ecs_cluster" {
  description = "Set GitHub variable RENDER_ECS_CLUSTER to this value."
  value       = module.render_service.cluster_name
}

output "render_ecs_service" {
  description = "Set GitHub variable RENDER_ECS_SERVICE to this value."
  value       = module.render_service.service_name
}

output "ecr_repository_url" {
  value = module.storage.ecr_repository_url
}

output "ecr_web_repository_url" {
  value = module.storage.ecr_web_repository_url
}

output "s3_bucket_name" {
  value = module.storage.s3_bucket_name
}

output "arango_url" {
  value = "http://${module.graph_db_host.private_ip}:8529"
}

output "redis_url" {
  value = module.cache.redis_url
}

output "ssm_parameter_prefix" {
  value = local.normalized_ssm_prefix
}

# ---- Target-state platform (null unless enable_app_platform = true) ---------

output "app_platform_alb_dns_name" {
  description = "ALB DNS name for the new web/api tiers."
  value       = one(module.app_platform[*].alb_dns_name)
}

output "app_platform_alb_acm_validation_records" {
  description = "DNS CNAME records to add to validate the ALB ACM certificate."
  value       = one(module.app_platform[*].alb_acm_validation_records)
}

output "cloudfront_domain_name" {
  description = "CloudFront distribution domain; point Cloudflare/DNS at this."
  value       = one(module.edge[*].distribution_domain_name)
}

output "cloudfront_acm_validation_records" {
  description = "DNS CNAME records to add to validate the CloudFront (us-east-1) ACM certificate."
  value       = one(module.edge[*].cloudfront_acm_validation_records)
}

output "app_platform_web_service_name" {
  value = one(module.app_platform[*].web_service_name)
}

output "app_platform_api_service_name" {
  value = one(module.app_platform[*].api_service_name)
}
