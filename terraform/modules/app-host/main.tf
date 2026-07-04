data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

resource "tls_private_key" "generated" {
  algorithm = "ED25519"
}

locals {
  ssh_public_key  = var.ssh_public_key != "" ? var.ssh_public_key : tls_private_key.generated.public_key_openssh
  app_ec2_user    = "ec2-user"
  ssm_policy_arns = length(var.ssm_parameter_arns) > 0 ? var.ssm_parameter_arns : ["*"]
}

resource "aws_key_pair" "deploy" {
  key_name   = "${var.name_prefix}-deploy"
  public_key = local.ssh_public_key

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-deploy-key"
  })
}

resource "aws_vpc_security_group_ingress_rule" "ssh" {
  for_each          = toset(var.ssh_ingress_cidr_blocks)
  security_group_id = var.security_group_id
  cidr_ipv4         = each.value
  from_port         = 22
  ip_protocol       = "tcp"
  to_port           = 22
}

resource "aws_iam_role" "this" {
  name = "${var.name_prefix}-app-host-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "ecr_read" {
  role       = aws_iam_role.this.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_role_policy" "ssm_read" {
  count = var.allow_instance_ssm_read ? 1 : 0
  name  = "${var.name_prefix}-app-host-ssm-read"
  role  = aws_iam_role.this.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath"
        ]
        Resource = local.ssm_policy_arns
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt"
        ]
        Resource = var.kms_key_arns
      }
    ]
  })
}

resource "aws_iam_instance_profile" "this" {
  name = "${var.name_prefix}-app-host-profile"
  role = aws_iam_role.this.name
}

resource "aws_instance" "this" {
  ami                         = data.aws_ssm_parameter.al2023.value
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id
  vpc_security_group_ids      = [var.security_group_id]
  associate_public_ip_address = true
  key_name                    = aws_key_pair.deploy.key_name
  iam_instance_profile        = aws_iam_instance_profile.this.name
  user_data_replace_on_change = false

  root_block_device {
    volume_size           = var.root_volume_size
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true
  }

  user_data = <<-USERDATA
    #!/bin/bash
    set -euxo pipefail
    dnf update -y
    dnf install -y docker
    systemctl enable --now docker
    usermod -aG docker ${local.app_ec2_user}
    mkdir -p /usr/local/lib/docker/cli-plugins
    arch="$(uname -m)"
    if [ "$arch" = "x86_64" ]; then compose_arch="x86_64"; else compose_arch="aarch64"; fi
    curl -fsSL "https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-$compose_arch" \
      -o /usr/local/lib/docker/cli-plugins/docker-compose
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
    mkdir -p /home/${local.app_ec2_user}/vorinthex
    chown -R ${local.app_ec2_user}:${local.app_ec2_user} /home/${local.app_ec2_user}/vorinthex
  USERDATA

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-app-host"
  })

  lifecycle {
    ignore_changes = [user_data]
  }
}

resource "aws_eip" "this" {
  domain   = "vpc"
  instance = aws_instance.this.id

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-app-eip"
  })
}
