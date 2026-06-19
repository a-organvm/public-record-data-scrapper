#!/usr/bin/env bash
# =============================================================================
# One-command deploy for the UCC-MCA Intelligence Platform API.
#
#   npm run deploy            # build image, migrate, start the full prod stack
#   ./scripts/deploy.sh       # equivalent
#
# What it does (idempotent — safe to re-run):
#   1. Preflight: verify Docker + Docker Compose are installed and running.
#   2. Ensure a .env file exists with the required secrets.
#   3. Build the application image (skipped with --image / --no-build).
#   4. Run database migrations (the compose `migrate` one-shot), then start
#      the API server, BullMQ worker, PostgreSQL, and Redis.
#   5. Wait for /api/health to report healthy, then print access URLs.
#
# Flags:
#   --image <ref>   Deploy a prebuilt image (e.g. a GHCR tag) instead of building.
#   --no-build      Reuse the existing local image; don't rebuild.
#   --down          Stop and remove the stack (keeps named volumes / data).
#   --logs          Tail logs after deploying.
#   -h, --help      Show this help.
#
# Environment (read from .env unless exported in the shell):
#   JWT_SECRET          (required) signing secret for API auth
#   POSTGRES_PASSWORD   (required) database password
#   PORT                (optional) host port for the API, default 3000
#   APP_IMAGE           (optional) image tag to build/run, default ucc-mca-intelligence:latest
# =============================================================================
set -euo pipefail

# --- resolve repo root regardless of where the script is invoked from --------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

COMPOSE_FILE="docker-compose.prod.yml"
HEALTH_PORT="${PORT:-3000}"
DO_BUILD=1
DO_LOGS=0
ACTION="up"

# --- pretty output -----------------------------------------------------------
bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '  \033[36m→\033[0m %s\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
die()  { printf '  \033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

usage() { sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0; }

# --- parse args --------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --image)    export APP_IMAGE="${2:?--image requires a value}"; DO_BUILD=0; shift 2 ;;
    --no-build) DO_BUILD=0; shift ;;
    --down)     ACTION="down"; shift ;;
    --logs)     DO_LOGS=1; shift ;;
    -h|--help)  usage ;;
    *) die "Unknown argument: $1 (use --help)" ;;
  esac
done

# --- pick the compose command (v2 plugin preferred, v1 fallback) -------------
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  die "Docker Compose not found. Install Docker Desktop or the compose plugin."
fi
compose() { "${COMPOSE[@]}" -f "${COMPOSE_FILE}" "$@"; }

# --- preflight ---------------------------------------------------------------
bold "UCC-MCA Intelligence — deploy"
command -v docker >/dev/null 2>&1 || die "Docker is not installed."
docker info >/dev/null 2>&1 || die "Docker daemon is not running. Start Docker and retry."
ok "Docker is running"

# --- teardown path -----------------------------------------------------------
if [ "${ACTION}" = "down" ]; then
  info "Stopping stack (data volumes are preserved)…"
  compose down
  ok "Stack stopped."
  exit 0
fi

# --- ensure .env with required secrets ---------------------------------------
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    warn "No .env found — created one from .env.example."
    die "Fill in JWT_SECRET and POSTGRES_PASSWORD in .env, then re-run."
  fi
  die "No .env file found. Copy .env.example to .env and set the required secrets."
fi
# Load .env so we can validate required secrets (without clobbering exported vars).
set -a; . ./.env; set +a
[ -n "${JWT_SECRET:-}" ]        || die "JWT_SECRET is not set in .env."
[ -n "${POSTGRES_PASSWORD:-}" ] || die "POSTGRES_PASSWORD is not set in .env."
# Recompute now that .env (which may define PORT) is loaded, so the health probe
# targets the same host port compose publishes.
HEALTH_PORT="${PORT:-3000}"
ok ".env present with required secrets"

# --- build -------------------------------------------------------------------
if [ "${DO_BUILD}" -eq 1 ]; then
  info "Building application image (${APP_IMAGE:-ucc-mca-intelligence:latest})…"
  compose build app
  ok "Image built"
else
  info "Skipping build — using image ${APP_IMAGE:-ucc-mca-intelligence:latest}"
fi

# --- migrate + start ---------------------------------------------------------
# `up` honors compose dependencies: the `migrate` one-shot runs first and must
# exit 0 before `app` and `worker` start.
info "Starting stack (migrations run first)…"
# --no-build: we either built explicitly above or are running a prebuilt image
# (compose still pulls the image if it isn't present locally).
compose up -d --no-build --remove-orphans
ok "Containers started"

# --- wait for health ---------------------------------------------------------
HEALTH_URL="http://localhost:${HEALTH_PORT}/api/health"
info "Waiting for API health at ${HEALTH_URL} …"
for attempt in $(seq 1 30); do
  if curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then
    ok "API is healthy"
    bold "Deploy complete"
    echo "  API:     http://localhost:${HEALTH_PORT}"
    echo "  Health:  ${HEALTH_URL}"
    echo "  Docs:    http://localhost:${HEALTH_PORT}/api/docs"
    echo "  Logs:    ${COMPOSE[*]} -f ${COMPOSE_FILE} logs -f"
    echo "  Stop:    ./scripts/deploy.sh --down"
    [ "${DO_LOGS}" -eq 1 ] && compose logs -f
    exit 0
  fi
  sleep 2
done

warn "API did not report healthy within ~60s. Recent logs:"
compose logs --tail=40 app || true
die "Deploy did not reach a healthy state. Inspect the logs above."
