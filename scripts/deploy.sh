#!/usr/bin/env bash
set -euo pipefail

REPO_PATH="${1:-$(pwd)}"
BRANCH="${2:-main}"

cd "$REPO_PATH"

# Ensure repository is up to date
git fetch --all --prune
# Reset to remote branch to avoid divergence
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

# Build and start containers
docker compose pull || true
docker compose up -d --build --force-recreate

# Optional: wait for services to become healthy (basic)
sleep 2

exit 0
