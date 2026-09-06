#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE="${INSTAGRAM_POC_DOCKER_IMAGE:-foodfolio-instagram-media-poc}"
ARTIFACT_DIR="$ROOT_DIR/poc/artifacts/instagram-media"

command -v docker >/dev/null 2>&1 || {
  echo "docker is required" >&2
  exit 1
}

mkdir -p "$ARTIFACT_DIR"

docker build \
  --file "$ROOT_DIR/poc/instagram-media/Dockerfile" \
  --tag "$IMAGE" \
  "$ROOT_DIR"

docker run --rm \
  --env "INSTAGRAM_POC_MAX_ATTEMPTS=${INSTAGRAM_POC_MAX_ATTEMPTS:-3}" \
  --env "INSTAGRAM_POC_OUTPUT_DIR=/app/poc/artifacts/instagram-media/$(date -u +%Y%m%dT%H%M%SZ)-docker" \
  --volume "$ARTIFACT_DIR:/app/poc/artifacts/instagram-media" \
  "$IMAGE" "$@"
