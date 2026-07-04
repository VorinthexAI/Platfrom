resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.name_prefix}-redis-subnets"
  subnet_ids = var.subnet_ids

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-redis-subnets"
  })
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id       = "${var.name_prefix}-redis"
  description                = "Vorinthex production Redis"
  engine                     = "redis"
  engine_version             = var.engine_version
  node_type                  = var.redis_node_type
  port                       = 6379
  num_cache_clusters         = var.num_cache_clusters
  automatic_failover_enabled = var.automatic_failover_enabled
  subnet_group_name          = aws_elasticache_subnet_group.this.name
  security_group_ids         = [var.security_group_id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  apply_immediately          = false

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-redis"
  })

  lifecycle {
    precondition {
      condition     = var.automatic_failover_enabled == false || var.num_cache_clusters > 1
      error_message = "automatic_failover_enabled requires num_cache_clusters greater than 1."
    }
  }
}
