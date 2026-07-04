data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  create_vpc         = var.vpc_id == null || var.vpc_id == ""
  selected_azs       = length(var.availability_zones) > 0 ? var.availability_zones : slice(data.aws_availability_zones.available.names, 0, 2)
  public_subnet_ids  = local.create_vpc ? aws_subnet.public[*].id : var.public_subnet_ids
  private_subnet_ids = local.create_vpc ? aws_subnet.private[*].id : var.private_subnet_ids
  vpc_id             = local.create_vpc ? aws_vpc.this[0].id : var.vpc_id
}

resource "aws_vpc" "this" {
  count                = local.create_vpc ? 1 : 0
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-vpc"
  })
}

resource "aws_internet_gateway" "this" {
  count  = local.create_vpc ? 1 : 0
  vpc_id = aws_vpc.this[0].id

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-igw"
  })
}

resource "aws_subnet" "public" {
  count                   = local.create_vpc ? length(local.selected_azs) : 0
  vpc_id                  = aws_vpc.this[0].id
  availability_zone       = local.selected_azs[count.index]
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  map_public_ip_on_launch = true

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-public-${count.index + 1}"
    Tier = "public"
  })
}

resource "aws_subnet" "private" {
  count             = local.create_vpc ? length(local.selected_azs) : 0
  vpc_id            = aws_vpc.this[0].id
  availability_zone = local.selected_azs[count.index]
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 10)

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-private-${count.index + 1}"
    Tier = "private"
  })
}

resource "aws_route_table" "public" {
  count  = local.create_vpc ? 1 : 0
  vpc_id = aws_vpc.this[0].id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this[0].id
  }

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-public-rt"
  })
}

resource "aws_route_table_association" "public" {
  count          = local.create_vpc ? length(aws_subnet.public) : 0
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public[0].id
}

resource "aws_eip" "nat" {
  count  = local.create_vpc ? 1 : 0
  domain = "vpc"

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-nat-eip"
  })
}

resource "aws_nat_gateway" "this" {
  count         = local.create_vpc ? 1 : 0
  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public[0].id

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-nat"
  })

  depends_on = [aws_internet_gateway.this]
}

resource "aws_route_table" "private" {
  count  = local.create_vpc ? 1 : 0
  vpc_id = aws_vpc.this[0].id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this[0].id
  }

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-private-rt"
  })
}

resource "aws_route_table_association" "private" {
  count          = local.create_vpc ? length(aws_subnet.private) : 0
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[0].id
}

resource "aws_security_group" "app" {
  name        = "${var.name_prefix}-app-sg"
  description = "Vorinthex production app host"
  vpc_id      = local.vpc_id

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-app-sg"
  })
}

resource "aws_security_group" "render" {
  name        = "${var.name_prefix}-render-sg"
  description = "Vorinthex production render tasks"
  vpc_id      = local.vpc_id

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-render-sg"
  })
}

resource "aws_security_group" "graph_db" {
  name        = "${var.name_prefix}-graph-db-sg"
  description = "Vorinthex production ArangoDB"
  vpc_id      = local.vpc_id

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-graph-db-sg"
  })
}

resource "aws_security_group" "cache" {
  name        = "${var.name_prefix}-cache-sg"
  description = "Vorinthex production Redis"
  vpc_id      = local.vpc_id

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-cache-sg"
  })
}

resource "aws_vpc_security_group_ingress_rule" "app_http" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 80
  ip_protocol       = "tcp"
  to_port           = 80
}

resource "aws_vpc_security_group_ingress_rule" "app_https" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  ip_protocol       = "tcp"
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "app_all" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_vpc_security_group_egress_rule" "render_all" {
  security_group_id = aws_security_group.render.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_vpc_security_group_ingress_rule" "graph_db_from_app" {
  security_group_id            = aws_security_group.graph_db.id
  referenced_security_group_id = aws_security_group.app.id
  from_port                    = 8529
  ip_protocol                  = "tcp"
  to_port                      = 8529
}

resource "aws_vpc_security_group_ingress_rule" "graph_db_from_render" {
  security_group_id            = aws_security_group.graph_db.id
  referenced_security_group_id = aws_security_group.render.id
  from_port                    = 8529
  ip_protocol                  = "tcp"
  to_port                      = 8529
}

resource "aws_vpc_security_group_egress_rule" "graph_db_all" {
  security_group_id = aws_security_group.graph_db.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_vpc_security_group_ingress_rule" "cache_from_app" {
  security_group_id            = aws_security_group.cache.id
  referenced_security_group_id = aws_security_group.app.id
  from_port                    = 6379
  ip_protocol                  = "tcp"
  to_port                      = 6379
}

resource "aws_vpc_security_group_ingress_rule" "cache_from_render" {
  security_group_id            = aws_security_group.cache.id
  referenced_security_group_id = aws_security_group.render.id
  from_port                    = 6379
  ip_protocol                  = "tcp"
  to_port                      = 6379
}

resource "aws_vpc_security_group_egress_rule" "cache_all" {
  security_group_id = aws_security_group.cache.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}
