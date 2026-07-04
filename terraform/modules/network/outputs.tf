output "vpc_id" {
  value = local.vpc_id
}

output "public_subnet_ids" {
  value = local.public_subnet_ids
}

output "private_subnet_ids" {
  value = local.private_subnet_ids
}

output "app_security_group_id" {
  value = aws_security_group.app.id
}

output "render_security_group_id" {
  value = aws_security_group.render.id
}

output "graph_db_security_group_id" {
  value = aws_security_group.graph_db.id
}

output "cache_security_group_id" {
  value = aws_security_group.cache.id
}
