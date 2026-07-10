#!/usr/bin/env bash
# Blue-green deploy for the single-box early-infra app host.
# Runs ON the app box, invoked via `aws ssm send-command` from deploy.yml or
# early-infra.yml (or the bootstrap on first boot). Zero-downtime: brings the
# inactive color up, health-checks it, flips Caddy, then retires the old color.
#
#   Usage: deploy.sh <web_image_tag> [api_image_tag]
#
# The api tag defaults to the web tag. deploy.yml passes them separately
# because it only builds images for the services a merge actually changed.
#
# Runtime env/secrets come from SSM Parameter Store (/vorinthex/prod/*), the same
# params the ECS stack used — no secrets on disk beyond the short-lived env files
# below. Local overrides (co-located redis, the DB box IP) live in /opt/vorinthex/overrides.env.
set -euo pipefail

TAG="${1:-latest}"
API_TAG="${2:-$TAG}"
REGION="eu-north-1"
ACCOUNT="938565868704"
ECR="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
ROOT="/opt/vorinthex"
NET="vorinthex"
STATE="${ROOT}/active-color"
SSM_PREFIX="/vorinthex/prod"

log() { echo "[deploy $(date -u +%H:%M:%S)] $*"; }

# --- overrides: DB_PRIVATE_IP (ArangoDB box) + local redis URL --------------
# shellcheck disable=SC1091
source "${ROOT}/overrides.env"   # sets DB_PRIVATE_IP; REDIS_URL is forced below

log "ECR login"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR"

docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET"

# --- shared, non-colored services (started once, left running) --------------
if ! docker ps --format '{{.Names}}' | grep -qx redis; then
	log "starting shared redis"
	docker run -d --name redis --network "$NET" --restart unless-stopped \
		-v "${ROOT}/redis-data:/data" redis:7-alpine \
		redis-server --appendonly yes
fi

# --- build the runtime env file from SSM (backend needs the full set) -------
API_ENV="${ROOT}/api.env"
umask 077
: > "$API_ENV"
log "fetching backend env from SSM ${SSM_PREFIX}/*"
aws ssm get-parameters-by-path --path "$SSM_PREFIX" --recursive --with-decryption \
	--region "$REGION" --query 'Parameters[].[Name,Value]' --output text |
	while IFS=$'\t' read -r name value; do
		key="${name##*/}"
		# web-only NEXT_PUBLIC_* and platform env are set explicitly below.
		case "$key" in NEXT_PUBLIC_*|NODE_ENV|PORT|AWS_REGION) continue;; esac
		printf '%s=%s\n' "$key" "$value" >> "$API_ENV"
	done
# Co-located overrides: redis on the box, ArangoDB on the DB box.
{
	echo "NODE_ENV=production"
	echo "PORT=3001"
	echo "AWS_REGION=${REGION}"
	echo "ROLE=api"
	echo "REDIS_URL=redis://redis:6379"
	echo "ARANGO_URL=http://${DB_PRIVATE_IP}:8529"
} >> "$API_ENV"

WEB_ENV="${ROOT}/web.env"
: > "$WEB_ENV"
{
	echo "NODE_ENV=production"
	echo "PORT=3000"
	echo "HOSTNAME=0.0.0.0"
	echo "NEXT_PUBLIC_API_BASE_URL=https://api.vorinthex.com"
	echo "API_BASE_URL=http://api-__ACTIVE__:3001"
	echo "NEXT_PUBLIC_SITE_URL=https://vorinthex.com"
} >> "$WEB_ENV"
# NEXT_PUBLIC_BACKEND_API_KEY / BACKEND_API_KEY mirror the api key for the web SSR bridge.
APIKEY="$(grep -m1 '^API_KEY=' "$API_ENV" | cut -d= -f2-)"
{
	echo "NEXT_PUBLIC_BACKEND_API_KEY=${APIKEY}"
	echo "BACKEND_API_KEY=${APIKEY}"
} >> "$WEB_ENV"

# --- pick colors ------------------------------------------------------------
CUR="$(cat "$STATE" 2>/dev/null || echo none)"
if [ "$CUR" = "blue" ]; then NEW=green; else NEW=blue; fi
log "current=${CUR} new=${NEW} web_tag=${TAG} api_tag=${API_TAG}"

# web talks to the api of the SAME new color for its SSR bridge.
sed "s/__ACTIVE__/${NEW}/" -i "$WEB_ENV"

docker pull "${ECR}/vorinthex-backend:${API_TAG}"
docker pull "${ECR}/vorinthex-web:${TAG}"

# --- start the new color ----------------------------------------------------
docker rm -f "api-${NEW}" "web-${NEW}" >/dev/null 2>&1 || true
log "starting api-${NEW}"
docker run -d --name "api-${NEW}" --network "$NET" --restart unless-stopped \
	--env-file "$API_ENV" "${ECR}/vorinthex-backend:${API_TAG}"
log "starting web-${NEW}"
docker run -d --name "web-${NEW}" --network "$NET" --restart unless-stopped \
	--env-file "$WEB_ENV" "${ECR}/vorinthex-web:${TAG}"

# --- health check the new color --------------------------------------------
ok=0
for i in $(seq 1 30); do
	if docker run --rm --network "$NET" curlimages/curl:8.10.1 -sf \
		"http://api-${NEW}:3001/api/v1/health" >/dev/null 2>&1 &&
		docker run --rm --network "$NET" curlimages/curl:8.10.1 -sf \
			"http://web-${NEW}:3000/" >/dev/null 2>&1; then
		ok=1; break
	fi
	log "health attempt ${i}/30..."; sleep 3
done
if [ "$ok" != 1 ]; then
	log "NEW color unhealthy — leaving old color live, removing failed new color"
	docker rm -f "api-${NEW}" "web-${NEW}" >/dev/null 2>&1 || true
	exit 1
fi
log "new color healthy"

# --- flip Caddy to the new color (start it on first deploy, else hot-reload) -
sed "s/__COLOR__/${NEW}/g" "${ROOT}/Caddyfile.tmpl" > "${ROOT}/Caddyfile"
if docker ps --format '{{.Names}}' | grep -qx caddy; then
	# ${ROOT}/Caddyfile is bind-mounted into the container, so writing it above
	# already updated the container's view — just hot-reload (no docker cp).
	docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>/dev/null ||
		docker restart caddy
else
	log "starting caddy (:80 + :443)"
	docker run -d --name caddy --network "$NET" --restart unless-stopped \
		-p 80:80 -p 443:443 \
		-v "${ROOT}/Caddyfile:/etc/caddy/Caddyfile:ro" \
		-v "${ROOT}/caddy-data:/data" \
		caddy:2-alpine
fi
echo "$NEW" > "$STATE"
log "flipped to ${NEW}"

# --- retire the old color ---------------------------------------------------
if [ "$CUR" != none ] && [ "$CUR" != "$NEW" ]; then
	sleep 5
	docker rm -f "api-${CUR}" "web-${CUR}" >/dev/null 2>&1 || true
	log "retired ${CUR}"
fi
docker image prune -f >/dev/null 2>&1 || true
log "deploy complete: ${NEW} @ web=${TAG} api=${API_TAG}"
