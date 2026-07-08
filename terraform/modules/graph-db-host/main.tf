data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

locals {
  ec2_user      = "ec2-user"
  device_name   = "/dev/sdf"
  kernel_device = "/dev/xvdf"
  # Pin to var.ami_id when provided; otherwise the AL2023 SSM latest. Either
  # way the instance ignores ami changes, so this never triggers a replace.
  graph_db_ami_id = var.ami_id != "" ? var.ami_id : data.aws_ssm_parameter.al2023.value
}

resource "aws_key_pair" "deploy" {
  key_name   = "${var.name_prefix}-graph-db-deploy"
  public_key = var.ssh_public_key

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-graph-db-deploy-key"
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

resource "aws_instance" "this" {
  ami                         = local.graph_db_ami_id
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id
  vpc_security_group_ids      = [var.security_group_id]
  associate_public_ip_address = true
  key_name                    = aws_key_pair.deploy.key_name
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
    usermod -aG docker ${local.ec2_user}
    mkdir -p /usr/local/lib/docker/cli-plugins
    arch="$(uname -m)"
    if [ "$arch" = "x86_64" ]; then compose_arch="x86_64"; else compose_arch="aarch64"; fi
    curl -fsSL "https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-$compose_arch" \
      -o /usr/local/lib/docker/cli-plugins/docker-compose
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

    for i in $(seq 1 30); do
      [ -e "${local.kernel_device}" ] && break
      sleep 2
    done
    if ! blkid "${local.kernel_device}"; then
      mkfs.ext4 "${local.kernel_device}"
    fi
    mkdir -p /data/arangodb
    grep -q "${local.kernel_device}" /etc/fstab || echo "${local.kernel_device} /data/arangodb ext4 defaults,nofail 0 2" >> /etc/fstab
    mount -a
    chown -R 999:999 /data/arangodb

    mkdir -p /home/${local.ec2_user}/vorinthex-db
    chown -R ${local.ec2_user}:${local.ec2_user} /home/${local.ec2_user}/vorinthex-db /data/arangodb
  USERDATA

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-graph-db-host"
  })

  lifecycle {
    # SAFETY: never re-image or force-replace the running database host; that
    # would tear down the instance the EBS data volume is attached to.
    ignore_changes = [user_data, ami]
  }
}

resource "aws_ebs_volume" "data" {
  availability_zone = aws_instance.this.availability_zone
  size              = var.data_volume_size
  type              = "gp3"
  encrypted         = true

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-graph-db-data"
  })
}

resource "aws_volume_attachment" "data" {
  device_name = local.device_name
  volume_id   = aws_ebs_volume.data.id
  instance_id = aws_instance.this.id
}

resource "aws_eip" "this" {
  domain   = "vpc"
  instance = aws_instance.this.id

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-graph-db-eip"
  })
}
