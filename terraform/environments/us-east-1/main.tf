terraform {
  required_version = ">= 1.10.0"

  backend "s3" {}
}

# The active Stockholm environment remains in its original state. This root
# creates an independently named Virginia stack for a validated DNS cutover.
module "production" {
  source = "../production"

  aws_region                               = "us-east-1"
  name_prefix                              = "vorinthex-us-prod"
  s3_bucket_name                           = "vorinthex-ai-us-prod-storage"
  ecr_repository_name                      = "vorinthex-us-prod-backend"
  ecr_web_repository_name                  = "vorinthex-us-prod-web"
  ssm_parameter_prefix                     = "vorinthex/us-prod"
  early_app_subnet_id                      = ""
  early_app_ami_id                         = ""
  backend_deploy_system_assets_policy_name = "vorinthex-us-backend-deploy-system-assets"
  early_app_archive_processing_policy_name = "vorinthex-us-early-app-archive-processing"
}

output "graph_db_ec2_ssh_private_key" {
  value     = module.production.graph_db_ec2_ssh_private_key
  sensitive = true
}

output "graph_db_ec2_host" {
  value = module.production.graph_db_ec2_host
}

output "graph_db_ec2_private_ip" {
  value = module.production.graph_db_ec2_private_ip
}

output "graph_db_ec2_user" {
  value = module.production.graph_db_ec2_user
}

output "ecr_repository_url" {
  value = module.production.ecr_repository_url
}

output "ecr_web_repository_url" {
  value = module.production.ecr_web_repository_url
}

output "s3_bucket_name" {
  value = module.production.s3_bucket_name
}

output "arango_url" {
  value = module.production.arango_url
}
