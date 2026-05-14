#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

IMAGE_NAME="plant-disease-api:latest"
SOURCE_ARCHIVE="deploy-src.tar.gz"
RUNS_ARCHIVE="deploy-runs.tar.gz"
TARGET_HOST="ubuntu@54.173.14.193"

echo "========================================"
echo "  Build and Package For EC2"
echo "========================================"
echo ""

echo "[1/4] Checking Docker..."
docker info >/dev/null 2>&1
echo "OK"

echo ""
echo "[2/4] Building local API image..."
docker build -t "$IMAGE_NAME" -f docker/Dockerfile.server .
echo "OK"

echo ""
echo "[3/4] Creating source archives..."
rm -f "$SOURCE_ARCHIVE" "$RUNS_ARCHIVE"
tar -czf "$SOURCE_ARCHIVE" .env.example .dockerignore docker server python
tar -czf "$RUNS_ARCHIVE" runs
echo "OK"
echo "  - $SOURCE_ARCHIVE"
echo "  - $RUNS_ARCHIVE"

echo ""
echo "[4/4] Next steps"
echo "Upload archives:"
echo "  scp -C -o ServerAliveInterval=30 -o ServerAliveCountMax=10 $SOURCE_ARCHIVE $RUNS_ARCHIVE $TARGET_HOST:~/"
echo ""
echo "On EC2:"
echo "  mkdir -p ~/plant-disease-app"
echo "  tar -xzf ~/deploy-src.tar.gz -C ~/plant-disease-app"
echo "  tar -xzf ~/deploy-runs.tar.gz -C ~/plant-disease-app"
echo "  cp ~/plant-disease-app/docker/docker-compose.prod.yml ~/plant-disease-app/docker-compose.yml"
echo "  cd ~/plant-disease-app"
echo "  cp .env.example .env"
echo "  nano .env"
echo "  docker build -t $IMAGE_NAME -f docker/Dockerfile.server ."
echo "  docker compose --env-file .env up -d"
echo "  docker compose --env-file .env exec api-server npm run seed"
