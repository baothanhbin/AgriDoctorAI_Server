#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

EC2_IP="${EC2_IP:-54.173.14.193}"
EC2_USER="${EC2_USER:-ubuntu}"
APP_DIR="${APP_DIR:-~/plant-disease-app}"
SSH_KEY_PATH="${SSH_KEY_PATH:-}"
SOURCE_ARCHIVE="deploy-src.tar.gz"
RUNS_ARCHIVE="deploy-runs.tar.gz"

SSH_ARGS=(
  -o StrictHostKeyChecking=no
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=10
)

if [[ -n "$SSH_KEY_PATH" ]]; then
  SSH_ARGS+=(-i "$SSH_KEY_PATH")
fi

echo "========================================"
echo "  Upload Deploy Archives To EC2"
echo "========================================"
echo "Host: ${EC2_USER}@${EC2_IP}"
echo ""

if [[ ! -f "$SOURCE_ARCHIVE" || ! -f "$RUNS_ARCHIVE" ]]; then
  echo "Missing deploy archives."
  echo "Run docker/build-and-export.sh first."
  exit 1
fi

echo "[1/3] Uploading archives..."
scp "${SSH_ARGS[@]}" -C "$SOURCE_ARCHIVE" "$RUNS_ARCHIVE" "${EC2_USER}@${EC2_IP}:~/"
echo "OK"

echo ""
echo "[2/3] Extracting on EC2..."
ssh "${SSH_ARGS[@]}" "${EC2_USER}@${EC2_IP}" "\
  mkdir -p $APP_DIR && \
  tar -xzf ~/deploy-src.tar.gz -C $APP_DIR && \
  tar -xzf ~/deploy-runs.tar.gz -C $APP_DIR && \
  cp $APP_DIR/docker/docker-compose.prod.yml $APP_DIR/docker-compose.yml"
echo "OK"

echo ""
echo "[3/3] Next commands on EC2"
echo "  cd $APP_DIR"
echo "  cp .env.example .env"
echo "  nano .env"
echo "  docker build -t plant-disease-api:latest -f docker/Dockerfile.server ."
echo "  docker compose --env-file .env up -d"
echo "  docker compose --env-file .env ps"
echo "  docker compose --env-file .env logs --tail=100 api-server"
echo "  docker compose --env-file .env exec api-server npm run seed"
echo "  curl http://127.0.0.1:3000/health"
echo "  curl http://${EC2_IP}/health"
