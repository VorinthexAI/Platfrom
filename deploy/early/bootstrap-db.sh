#!/bin/bash
# user-data for the early-infra DB box (t4g.small, ARM, public subnet).
# Mounts the EXISTING ArangoDB data volume (restored from the pre-migration
# snapshot, so it already has an ext4 filesystem + data — NEVER mkfs it) and
# runs the same arangodb/arangodb:3.12 image (multi-arch, arm64) the x86 host
# ran. Same version + arch-portable RocksDB files => the data reads straight back.
# The root password is the one baked into the existing data; ARANGO_ROOT_PASSWORD
# from SSM only matters on a fresh init, but we pass it for parity.
set -euxo pipefail

dnf update -y
dnf install -y docker awscli
systemctl enable --now docker
usermod -aG docker ec2-user

mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-aarch64" \
	-o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# locate the attached data volume (nitro remaps /dev/sdf -> /dev/nvme?n1)
DEV=""
for i in $(seq 1 30); do
	for cand in /dev/sdf /dev/xvdf /dev/nvme1n1 /dev/nvme2n1; do
		if [ -e "$cand" ]; then DEV="$cand"; break; fi
	done
	[ -n "$DEV" ] && break
	sleep 2
done
mkdir -p /data/arangodb
# SAFETY: only format if there is NO filesystem (there should always be one here).
if ! blkid "$DEV"; then
	echo "ERROR: data volume $DEV has no filesystem — refusing to mkfs (would destroy data)"
	exit 1
fi
grep -q /data/arangodb /etc/fstab || echo "$DEV /data/arangodb ext4 defaults,nofail 0 2" >> /etc/fstab
mount -a
chown -R 999:999 /data/arangodb

PW="$(aws ssm get-parameter --name /vorinthex/prod/ARANGO_ROOT_PASSWORD --with-decryption --region eu-north-1 --query 'Parameter.Value' --output text)"
docker run -d --name arangodb --restart unless-stopped \
	-p 8529:8529 \
	-e ARANGO_ROOT_PASSWORD="$PW" \
	-v /data/arangodb:/var/lib/arangodb3 \
	--log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
	arangodb/arangodb:3.12
