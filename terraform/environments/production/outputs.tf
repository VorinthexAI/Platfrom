output "app_health_url" {
  description = "Set GitHub variable APP_HEALTH_URL to this value after DNS points at the app host."
  value       = "https://api.vorinthex.com/api/v1/health"
}

# (Removed app_ec2_host / app_ec2_user / app_ec2_ssh_private_key outputs — the
# app_host module is gone. The shared deploy SSH key output moves under the
# graph-db host, which still uses it.)

output "graph_db_ec2_ssh_private_key" {
  description = "Shared deploy SSH key (authorized on the graph-db host), when Terraform generated it."
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


output "ssm_parameter_prefix" {
  value = local.normalized_ssm_prefix
}








