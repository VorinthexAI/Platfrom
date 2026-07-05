#!/usr/bin/env bash
# Upserts .github/.configs/{vars,secrets}.json into GitHub repo Variables/Secrets.
#
# Usage: sync-configs.sh [all|vars|secrets]
#   vars    - upsert every key in .github/.configs/vars.json as a repo Variable
#   secrets - upsert .github/.configs/secrets.json (if present) as the CONFIG secret
#   all     - both (default)
#
# Requires `gh` authenticated with a token that has repo Variables/Secrets
# write permission (the default GITHUB_TOKEN in Actions cannot manage these;
# use a PAT, e.g. via GH_TOKEN).
set -euo pipefail

MODE="${1:-all}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VARS_FILE="$REPO_ROOT/.github/.configs/vars.json"
SECRETS_FILE="$REPO_ROOT/.github/.configs/secrets.json"

sync_vars() {
  test -f "$VARS_FILE" || { echo "::error::$VARS_FILE not found"; exit 1; }
  jq -r 'to_entries[] | "\(.key)\t\(.value)"' "$VARS_FILE" | while IFS=$'\t' read -r name value; do
    echo "Setting variable $name"
    gh variable set "$name" --body "$value"
  done
}

sync_secrets() {
  if [ ! -f "$SECRETS_FILE" ]; then
    echo "No local $SECRETS_FILE found (it's gitignored) — skipping secrets sync."
    return 0
  fi
  echo "Setting secret CONFIG"
  gh secret set CONFIG < "$SECRETS_FILE"
}

case "$MODE" in
  vars) sync_vars ;;
  secrets) sync_secrets ;;
  all) sync_vars; sync_secrets ;;
  *) echo "Usage: sync-configs.sh [all|vars|secrets]"; exit 1 ;;
esac
