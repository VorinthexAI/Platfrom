#!/usr/bin/env bash
set -uo pipefail

URL="${1:?health URL required}"
MAX_ATTEMPTS="${2:-12}"
INTERVAL="${3:-10}"
BODY=/tmp/vorinthex-health.json

echo "Post-deploy external health probe -> $URL"

for i in $(seq 1 "$MAX_ATTEMPTS"); do
  CODE=$(curl -s -o "$BODY" -w "%{http_code}" --max-time 10 "$URL" 2>/dev/null || echo "000")
  if [ "$CODE" = "200" ]; then
    echo "Health check passed on attempt ${i}/${MAX_ATTEMPTS}"
    cat "$BODY" 2>/dev/null || true
    echo
    exit 0
  fi
  echo "  attempt ${i}/${MAX_ATTEMPTS}: HTTP ${CODE}; retrying in ${INTERVAL}s"
  sleep "$INTERVAL"
done

echo "::error::Health check failed after ${MAX_ATTEMPTS} attempts: $URL"
test -s "$BODY" && cat "$BODY"
exit 1

