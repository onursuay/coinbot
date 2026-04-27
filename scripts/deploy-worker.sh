#!/usr/bin/env bash
# VPS worker deploy script.
# Called by GitHub Actions (or manually) from /opt/coinbot.
# Requirements: docker, docker compose v2, git, worker/.env present.
set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="docker-compose.worker.yml"
CONTAINER_NAME="coinbot-worker"
IMAGE_NAME="coinbot-worker"
ENV_FILE="worker/.env"
HEALTH_WAIT_SEC=30
FORCE_REBUILD="${FORCE_REBUILD:-false}"

cd "$DEPLOY_DIR"

log()  { echo "[deploy] $*"; }
err()  { echo "[deploy] ERROR: $*" >&2; }
die()  { err "$*"; exit 1; }

# ─── Guard: worker/.env must exist ───────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  die "worker/.env not found. Copy worker/.env.example → worker/.env and fill in values."
fi

# ─── Guard: HARD_LIVE_TRADING_ALLOWED must not be true ───────────────────────
LIVE_GATE=$(grep -E '^HARD_LIVE_TRADING_ALLOWED=' "$ENV_FILE" | cut -d= -f2 | tr -d '[:space:]' || echo "")
if [ "$LIVE_GATE" = "true" ]; then
  die "HARD_LIVE_TRADING_ALLOWED=true detected in worker/.env. Deploy blocked. Set it to false before deploying."
fi
log "Safety gate OK: HARD_LIVE_TRADING_ALLOWED=${LIVE_GATE:-false}"

# ─── Tag current image for rollback ──────────────────────────────────────────
PREVIOUS_IMAGE=""
if docker image inspect "${IMAGE_NAME}:latest" &>/dev/null; then
  PREVIOUS_ID=$(docker image inspect "${IMAGE_NAME}:latest" --format '{{.Id}}' 2>/dev/null || echo "")
  if [ -n "$PREVIOUS_ID" ]; then
    docker tag "${IMAGE_NAME}:latest" "${IMAGE_NAME}:previous" 2>/dev/null || true
    PREVIOUS_IMAGE="${IMAGE_NAME}:previous"
    log "Tagged previous image for rollback"
  fi
fi

# ─── Build new image ─────────────────────────────────────────────────────────
BUILD_ARGS=""
if [ "$FORCE_REBUILD" = "true" ]; then
  BUILD_ARGS="--no-cache"
  log "Force rebuild requested (no cache)"
fi

log "Building Docker image..."
# shellcheck disable=SC2086
docker compose -f "$COMPOSE_FILE" build $BUILD_ARGS

# ─── Graceful container stop ─────────────────────────────────────────────────
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  log "Stopping existing container (30s grace)..."
  docker stop --time 30 "$CONTAINER_NAME" 2>/dev/null || true
fi

# Remove stopped container so compose can recreate it cleanly
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

# ─── Start new container ─────────────────────────────────────────────────────
log "Starting new container..."
docker compose -f "$COMPOSE_FILE" up -d

# ─── Health check ────────────────────────────────────────────────────────────
log "Waiting ${HEALTH_WAIT_SEC}s for container to become healthy..."
sleep "$HEALTH_WAIT_SEC"

CONTAINER_STATUS=$(docker ps --filter "name=^${CONTAINER_NAME}$" --format '{{.Status}}' 2>/dev/null || echo "")

if echo "$CONTAINER_STATUS" | grep -qi "Up"; then
  log "Container is Up: $CONTAINER_STATUS"
else
  err "Container is NOT running after deploy. Status: '${CONTAINER_STATUS}'"

  # ── Rollback ────────────────────────────────────────────────────────────────
  if [ -n "$PREVIOUS_IMAGE" ]; then
    err "Attempting rollback to previous image..."
    docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
    # Run previous image directly (compose would rebuild)
    docker run -d \
      --name "$CONTAINER_NAME" \
      --restart always \
      --env-file "$ENV_FILE" \
      -e NODE_ENV=production \
      --log-driver json-file \
      --log-opt max-size=50m \
      --log-opt max-file=5 \
      "${IMAGE_NAME}:previous"

    sleep 10
    ROLLBACK_STATUS=$(docker ps --filter "name=^${CONTAINER_NAME}$" --format '{{.Status}}' 2>/dev/null || echo "")
    if echo "$ROLLBACK_STATUS" | grep -qi "Up"; then
      err "ROLLBACK SUCCEEDED — previous version is running: $ROLLBACK_STATUS"
      err "New deploy failed. Check logs: docker logs $CONTAINER_NAME"
    else
      err "ROLLBACK ALSO FAILED — manual intervention required"
      err "Check: docker logs $CONTAINER_NAME"
    fi
  else
    err "No previous image found — cannot rollback"
    err "Check: docker logs $CONTAINER_NAME"
  fi

  exit 1
fi

# ─── Post-deploy checks ───────────────────────────────────────────────────────
log "Running post-deploy checks..."

# Check logs for panic/crash (last 20 lines, no secret leak check here)
RECENT_LOGS=$(docker logs "$CONTAINER_NAME" --tail 20 2>&1 || echo "")
if echo "$RECENT_LOGS" | grep -qi "unhandledRejection\|FATAL\|panic\|Cannot find module"; then
  err "Suspicious log entries detected — verify manually:"
  echo "$RECENT_LOGS" | tail -20 >&2
  # Not a hard fail — container might self-recover
fi

# Confirm restart policy
RESTART_POLICY=$(docker inspect "$CONTAINER_NAME" --format '{{.HostConfig.RestartPolicy.Name}}' 2>/dev/null || echo "")
if [ "$RESTART_POLICY" != "always" ]; then
  err "WARNING: restart policy is '${RESTART_POLICY}', expected 'always'"
fi

log "Deploy complete."
log "  Container : $CONTAINER_NAME ($CONTAINER_STATUS)"
log "  Restart   : $RESTART_POLICY"
log ""
log "Useful commands:"
log "  docker logs -f $CONTAINER_NAME"
log "  docker ps"
log "  docker stats $CONTAINER_NAME"
