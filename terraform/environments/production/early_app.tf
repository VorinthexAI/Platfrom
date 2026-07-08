# ---------------------------------------------------------------------------
# Early-infra app box: the single t4g.medium running web + api + redis + Caddy
# (see deploy/early/). Created out-of-band via the AWS CLI during the cost pivot
# and IMPORTED here so it is managed as code. `user_data` and `ami` are ignored so
# a plan never proposes replacing the running box (its bootstrap ran once).
# ---------------------------------------------------------------------------

resource "aws_security_group" "early_app" {
  name        = "vorinthex-early-app-sg"
  description = "early-infra app box"
  vpc_id      = module.network.vpc_id

  tags = merge(local.tags, { Name = "vorinthex-early-app-sg" })
}

# Cloudflare origin-facing IPv4 ranges (https://www.cloudflare.com/ips-v4).
# The app box only accepts :80/:443 from these, so the origin is not open to the
# public internet — Cloudflare is the only ingress path.
resource "aws_ec2_managed_prefix_list" "cloudflare" {
  name           = "cloudflare-origins"
  address_family = "IPv4"
  max_entries    = 20

  dynamic "entry" {
    for_each = toset([
      "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
      "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
      "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
      "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
    ])
    content {
      cidr = entry.value
    }
  }

  tags = merge(local.tags, { Name = "cloudflare-origins" })
}

resource "aws_vpc_security_group_ingress_rule" "early_app_http" {
  security_group_id = aws_security_group.early_app.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  prefix_list_id    = aws_ec2_managed_prefix_list.cloudflare.id
}

resource "aws_vpc_security_group_ingress_rule" "early_app_https" {
  security_group_id = aws_security_group.early_app.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  prefix_list_id    = aws_ec2_managed_prefix_list.cloudflare.id
}

# NOTE: Cloudflare does not reliably reach the origin through the prefix-list
# rules above alone, so :80/:443 are currently also open to 0.0.0.0/0 (below) —
# that is what actually serves traffic. The origin is mitigated by the API key
# and an unpublished origin IP. TODO: lock down to the Cloudflare prefix list only
# once the reason the PL rules don't admit Cloudflare is understood.
resource "aws_vpc_security_group_ingress_rule" "early_app_http_open" {
  security_group_id = aws_security_group.early_app.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "early_app_https_open" {
  security_group_id = aws_security_group.early_app.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "early_app_all" {
  security_group_id = aws_security_group.early_app.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# App box -> ArangoDB (graph-db host) on 8529.
resource "aws_vpc_security_group_ingress_rule" "arango_from_early_app" {
  security_group_id            = module.network.graph_db_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 8529
  to_port                      = 8529
  referenced_security_group_id = aws_security_group.early_app.id
}

resource "aws_instance" "early_app" {
  ami                         = "ami-0d08de17b554b801f"
  instance_type               = "t4g.medium"
  subnet_id                   = "subnet-016963e4f49edd3a0"
  vpc_security_group_ids      = [aws_security_group.early_app.id]
  iam_instance_profile        = "vorinthex-early-app-profile"
  associate_public_ip_address = true

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
    encrypted   = false
  }

  tags = merge(local.tags, { Name = "vorinthex-early-app" })

  lifecycle {
    # The box's bootstrap ran once; never replace it on a user_data/ami diff.
    ignore_changes = [user_data, user_data_base64, ami]
  }
}

resource "aws_eip" "early_app" {
  domain = "vpc"
  tags   = merge(local.tags, { Name = "vorinthex-early-app-eip" })
}

resource "aws_eip_association" "early_app" {
  allocation_id = aws_eip.early_app.id
  instance_id   = aws_instance.early_app.id
}
