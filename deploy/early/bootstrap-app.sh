#!/bin/bash
# user-data for the early-infra APP box (t4g.medium, ARM, public subnet).
# Installs Docker + the compose plugin and lays out /opt/vorinthex. The actual
# app (web + api + redis + caddy) is deployed by deploy.sh, pushed and run via
# SSM (aws ssm send-command) from deploy.yml — so this stays minimal and
# the deploy logic lives in one place. SSM agent ships with AL2023.
#
# DB_PRIVATE_IP is templated in at launch: the ArangoDB the api talks to.
set -euxo pipefail

dnf update -y
dnf install -y docker
systemctl enable --now docker
usermod -aG docker ec2-user

mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-aarch64" \
	-o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

mkdir -p /opt/vorinthex/redis-data /opt/vorinthex/caddy-data
cat > /opt/vorinthex/overrides.env <<EOF
DB_PRIVATE_IP=__DB_PRIVATE_IP__
EOF
chmod 600 /opt/vorinthex/overrides.env

# ensure SSM agent is running (deploys arrive via SSM)
systemctl enable --now amazon-ssm-agent || true
