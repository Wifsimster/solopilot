#!/bin/sh
# deploy.sh — Restricted deploy script for Solopilot
# This script is called by GitHub Actions via the self-hosted runner.
# It pulls the latest Docker image and restarts the service.

set -eu

COMPOSE_DIR="${SOLOPILOT_COMPOSE_DIR:-/opt/docker/solopilot}"

echo "[deploy] Pulling latest image..."
docker compose -f "$COMPOSE_DIR/compose.yml" pull solopilot

echo "[deploy] Restarting service..."
docker compose -f "$COMPOSE_DIR/compose.yml" up -d solopilot

echo "[deploy] Cleaning up old images..."
docker image prune -f

echo "[deploy] Done."
