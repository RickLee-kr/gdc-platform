#!/usr/bin/env bash
# Fresh install: validate tooling, prepare .env and directories, run migrations, start the stack.
# PostgreSQL-only; never uses SQLite. Does not delete existing Docker volumes.
#
# Options:
#   (default)  Full install: use existing images; compose builds only if a required image is missing.
#   --build    Rebuild api, frontend, and reverse-proxy images (docker compose build per service group).
#   --pull     Pull images for services that declare image: (e.g. postgres) before build/up.
#   --no-build Restart / redeploy only: docker compose up -d --no-build (no migrations, no admin seed).
#   -h, --help Show usage.
set -Eeuo pipefail
set -o errtrace

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=scripts/release/_release_postgres_catalog.sh
source "$SCRIPT_DIR/_release_postgres_catalog.sh"
COMPOSE_REL="${GDC_RELEASE_COMPOSE_FILE:-docker-compose.platform.yml}"
ENV_EXAMPLE="$ROOT/.env.example"
ENV_FILE="$ROOT/.env"

INSTALL_START_EPOCH="$(date +%s)"
IMAGE_BUILD_SECONDS=""
MIGRATION_SECONDS=""

DO_PULL=0
DO_BUILD=0
RESTART_ONLY=0
LAST_HEALTH_BACKEND_RESULT=""
LAST_HEALTH_FRONTEND_RESULT=""
STEP_TOTAL=11
STEP_NUM=0
CURRENT_STEP=""
MIN_INSTALL_MEM_MB="${GDC_INSTALL_MIN_MEM_MB:-2048}"
MIN_INSTALL_DISK_GB="${GDC_INSTALL_MIN_DISK_GB:-10}"
INSTALL_REQUIRED_PORTS=(18080 18443 55432)

die() { echo "ERROR: $*" >&2; exit 1; }

ts() { date '+%Y-%m-%d %H:%M:%S'; }

elapsed_seconds() { echo "$(($(date +%s) - INSTALL_START_EPOCH))"; }

format_elapsed() {
  local sec="${1:-0}"
  local m=$((sec / 60)) s=$((sec % 60))
  if [[ "$m" -gt 0 ]]; then
    echo "${m}m ${s}s"
  else
    echo "${s}s"
  fi
}

err_trap() {
  local ec=$?
  echo "" >&2
  echo "==================================================" >&2
  echo "FAILED at step: ${CURRENT_STEP:-unknown}" >&2
  echo "Exit code: ${ec}" >&2
  echo "Failing command: ${BASH_COMMAND}" >&2
  echo "==================================================" >&2
  exit "$ec"
}
trap err_trap ERR

emit_install_timing_summary() {
  local total_now
  total_now="$(date +%s)"
  local install_total_seconds=$((total_now - INSTALL_START_EPOCH))
  python3 - "$IMAGE_BUILD_SECONDS" "$MIGRATION_SECONDS" "$install_total_seconds" <<'PY'
import json
import sys

img_raw, mig_raw, tot_raw = sys.argv[1], sys.argv[2], sys.argv[3]

def opt_int(s: str):
    s = (s or "").strip()
    if not s:
        return None
    return int(s)

print(
    json.dumps(
        {
            "stage": "install_timing_summary",
            "image_build_seconds": opt_int(img_raw),
            "migration_seconds": int(mig_raw) if str(mig_raw).strip() else None,
            "install_total_seconds": int(tot_raw),
        },
        separators=(",", ":"),
    )
)
PY
}

docker_engine_installed() {
  command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1
}

docker_daemon_usable() {
  docker info >/dev/null 2>&1
}

user_in_docker_group() {
  local user="${1:-$(id -un)}"
  local members
  members="$(getent group docker 2>/dev/null | awk -F: '{print $4}')"
  [[ -n "$members" ]] || return 1
  tr ',' '\n' <<<"$members" | grep -qx "$user"
}

docker_group_membership_pending() {
  user_in_docker_group && ! docker_daemon_usable
}

die_docker_group_refresh_required() {
  echo "Docker installed successfully." >&2
  echo "Run:" >&2
  echo "  newgrp docker" >&2
  echo "Or logout/login, then re-run install.sh." >&2
  exit 1
}

install_docker_on_ubuntu_2404() {
  local installer="$ROOT/scripts/install-docker-ubuntu2404.sh"
  [[ -f "$installer" ]] || die "Docker installer not found: $installer"
  echo "Docker Engine / Compose plugin not found; installing for Ubuntu 24.04..."
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    sudo -E bash "$installer"
  else
    bash "$installer"
  fi
  if user_in_docker_group; then
    die_docker_group_refresh_required
  fi
}

ensure_docker_ready() {
  if docker_daemon_usable; then
    return 0
  fi
  if ! docker_engine_installed; then
    if [[ -r /etc/os-release ]]; then
      # shellcheck disable=SC1091
      source /etc/os-release
      if [[ "${ID:-}" == "ubuntu" && "${VERSION_ID:-}" == "24.04" ]]; then
        install_docker_on_ubuntu_2404
      else
        die "Docker is not installed. Automatic install supports Ubuntu 24.04 only; install Docker Engine + Compose plugin manually."
      fi
    else
      die "Docker is not installed and OS could not be detected for automatic install."
    fi
  fi
  if ! docker_engine_installed; then
    die "Docker installation finished but 'docker' or 'docker compose' is still unavailable on PATH."
  fi
  if ! systemctl is-active --quiet docker 2>/dev/null; then
    if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
      sudo systemctl enable --now docker || die "Docker daemon is not running and could not be started."
    else
      systemctl enable --now docker || die "Docker daemon is not running and could not be started."
    fi
  fi
  if docker_daemon_usable; then
    return 0
  fi
  if docker_group_membership_pending; then
    die_docker_group_refresh_required
  fi
  if getent group docker >/dev/null 2>&1 && ! user_in_docker_group; then
    die "Docker is installed but user '$(id -un)' is not in the docker group. Run: sudo usermod -aG docker '$(id -un)' && newgrp docker"
  fi
  die "Docker daemon is not reachable (docker info failed). Check: sudo systemctl status docker"
}

validate_system_resources() {
  local mem_kb avail_kb disk_kb
  if [[ -r /proc/meminfo ]]; then
    mem_kb="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
    if [[ -n "$mem_kb" && "$mem_kb" -lt $((MIN_INSTALL_MEM_MB * 1024)) ]]; then
      die "Insufficient memory: need at least ${MIN_INSTALL_MEM_MB} MiB (MemTotal=$((mem_kb / 1024)) MiB)."
    fi
  fi
  if command -v df >/dev/null 2>&1; then
    disk_kb="$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')"
    if [[ -n "$disk_kb" && "$disk_kb" -lt $((MIN_INSTALL_DISK_GB * 1024 * 1024)) ]]; then
      die "Insufficient free disk under $ROOT: need at least ${MIN_INSTALL_DISK_GB} GiB free."
    fi
  fi
}

port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -H -ltn "sport = :$port" 2>/dev/null | grep -q .
    return $?
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  return 1
}

validate_required_ports_free() {
  local port busy=()
  for port in "${INSTALL_REQUIRED_PORTS[@]}"; do
    if port_in_use "$port"; then
      busy+=("$port")
    fi
  done
  if [[ "${#busy[@]}" -gt 0 ]]; then
    die "Required host ports already in use: ${busy[*]} (platform HTTP 18080, HTTPS 18443, PostgreSQL 55432)."
  fi
}

# Read a single KEY=value from .env-style file (no shell evaluation). Empty if missing.
read_env_assignment() {
  local file="$1" key="$2"
  python3 - "$file" "$key" <<'PY'
import re
import sys

path, key = sys.argv[1], sys.argv[2]
try:
    lines = open(path, encoding="utf-8").read().splitlines()
except OSError:
    sys.exit(0)
pat = re.compile(rf"^\s*{re.escape(key)}\s*=\s*(.*)\s*$")
for line in reversed(lines):
    if not line.strip() or line.lstrip().startswith("#"):
        continue
    m = pat.match(line)
    if not m:
        continue
    val = m.group(1).strip()
    if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
        val = val[1:-1]
    print(val, end="")
    break
PY
}

# shellcheck disable=SC2317
resolve_install_web_ui_url() {
  python3 - "$ENV_FILE" <<'PY'
import os, re, socket, subprocess, sys
from pathlib import Path


def read_env(path: str, key: str) -> str:
    p = Path(path)
    if not p.is_file():
        return ""
    pat = re.compile(rf"^\s*{re.escape(key)}\s*=\s*(.*)\s*$")
    for line in reversed(p.read_text(encoding="utf-8").splitlines()):
        ls = line.strip()
        if not ls or ls.startswith("#"):
            continue
        m = pat.match(line)
        if not m:
            continue
        val = m.group(1).strip()
        if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
            val = val[1:-1]
        return val
    return ""


def host_port_from_mapping(raw: str) -> int:
    raw = (raw or "").strip() or "18080"
    parts = raw.split(":")
    if len(parts) == 1 and parts[0].isdigit():
        return int(parts[0])
    if len(parts) == 2 and parts[0].isdigit():
        return int(parts[0])
    if len(parts) == 3 and parts[1].isdigit():
        return int(parts[1])
    for p in parts:
        if p.isdigit():
            return int(p)
    return 18080


def first_non_loopback_from_hostname_i() -> str | None:
    try:
        out = subprocess.check_output(["hostname", "-I"], text=True, stderr=subprocess.DEVNULL).split()
    except (OSError, subprocess.CalledProcessError):
        return None
    for ip in out:
        ip = ip.strip()
        if ip and not ip.startswith("127."):
            return ip
    return None


def udp_local_ip() -> str | None:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.25)
        s.connect(("1.1.1.1", 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and not ip.startswith("127."):
            return ip
    except OSError:
        pass
    return None


def hostname_i_first() -> str | None:
    try:
        out = subprocess.check_output(["hostname", "-I"], text=True, stderr=subprocess.DEVNULL).split()
    except (OSError, subprocess.CalledProcessError):
        return None
    if not out:
        return None
    first = out[0].strip()
    return first or None


env_file = sys.argv[1]
public = (os.environ.get("GDC_PUBLIC_URL") or "").strip() or read_env(env_file, "GDC_PUBLIC_URL").strip()
if public:
    print(public.rstrip("/") + "/")
    raise SystemExit(0)

port = host_port_from_mapping(read_env(env_file, "GDC_ENTRY_HTTP_PORT"))
ip = udp_local_ip() or first_non_loopback_from_hostname_i() or hostname_i_first()
if not ip or ip.startswith("127."):
    ip = "localhost"
print(f"http://{ip}:{port}/")
PY
}

print_install_completion_banner() {
  local web_url
  web_url="$(resolve_install_web_ui_url)"
  echo ""
  echo "=================================================="
  echo "GDC Platform installation completed"
  echo "=================================================="
  echo ""
  echo "Web UI:"
  echo "  ${web_url}"
  echo ""
  local _admin_pw _pw_source
  _admin_pw="$(resolve_install_admin_password)"
  if [[ -n "${GDC_SEED_ADMIN_PASSWORD:-}" ]] || grep -qE '^[[:space:]]*GDC_SEED_ADMIN_PASSWORD=.+' "$ENV_FILE" 2>/dev/null; then
    _pw_source="GDC_SEED_ADMIN_PASSWORD in environment or .env"
  else
    _pw_source='default bootstrap password "admin" (.env.example / install.sh when GDC_SEED_ADMIN_PASSWORD is unset)'
  fi
  echo "Initial login:"
  echo "  Username: admin"
  echo "  Password: ${_admin_pw}"
  echo "    (source: ${_pw_source})"
  echo ""
  echo "Important:"
  echo "  You will be required to change the password immediately after first login"
  echo "  when the default password is in effect."
  echo ""
  echo "Security:"
  echo "  Set strong JWT_SECRET_KEY, GDC_PROXY_RELOAD_TOKEN, and POSTGRES_PASSWORD in .env before production exposure."
  echo ""
  echo "=================================================="
}

validate_env_file() {
  local key val missing=()
  [[ -f "$ENV_FILE" ]] || die ".env missing after bootstrap (unexpected)."
  for key in POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL; do
    val="$(read_env_assignment "$ENV_FILE" "$key")"
    if [[ -z "$val" ]]; then
      missing+=("$key")
    fi
  done
  if [[ "${#missing[@]}" -gt 0 ]]; then
    die "Missing required .env keys: ${missing[*]} (see .env.example)."
  fi
  local url
  url="$(read_env_assignment "$ENV_FILE" DATABASE_URL)"
  case "$url" in
    postgresql://*|postgres://*) ;;
    sqlite*) die "SQLite is not supported. Set DATABASE_URL to a PostgreSQL URL." ;;
    *) die "DATABASE_URL must start with postgresql:// or postgres:// (PostgreSQL only)." ;;
  esac
  local pg_db pg_user
  pg_db="$(read_env_assignment "$ENV_FILE" POSTGRES_DB)"
  pg_user="$(read_env_assignment "$ENV_FILE" POSTGRES_USER)"
  if [[ "$pg_db" != "datarelay" ]]; then
    echo "WARN: POSTGRES_DB is '$pg_db' (platform install expects datarelay)." >&2
  fi
  if [[ "$COMPOSE_REL" == *"platform"* && "$pg_user" != "datarelay" ]]; then
    echo "WARN: POSTGRES_USER is '$pg_user' (docker-compose.platform.yml defaults to datarelay)." >&2
  fi
}

resolve_install_admin_password() {
  local pw="${GDC_SEED_ADMIN_PASSWORD:-}"
  if [[ -z "$pw" && -f "$ENV_FILE" ]]; then
    pw="$(read_env_assignment "$ENV_FILE" GDC_SEED_ADMIN_PASSWORD)"
  fi
  if [[ -z "$pw" ]]; then
    pw="admin"
  fi
  printf '%s' "$pw"
}

warn_lab_database_url_for_platform() {
  case "$COMPOSE_REL" in
    docker-compose.platform.yml|*/docker-compose.platform.yml) ;;
    deploy/docker-compose.https.yml|*/deploy/docker-compose.https.yml) ;;
    *) return 0 ;;
  esac
  if grep -qE '^[[:space:]]*DATABASE_URL=.*gdc_pytest' "$ENV_FILE" 2>/dev/null; then
    echo "WARN: .env DATABASE_URL points at pytest catalog gdc_pytest (destructive tests)." >&2
    echo "      Use datarelay for platform host-side tools; see .env.example." >&2
  fi
}

bootstrap_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    if [[ ! -f "$ENV_EXAMPLE" ]]; then
      die ".env.example not found at $ENV_EXAMPLE"
    fi
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    echo "Created $ENV_FILE from .env.example (edit secrets before production)."
  fi
}

bootstrap_platform_admin() {
  echo "Ensuring platform administrator account exists (create-only; see python -m app.db.seed --help)..."
  local -a docker_env_args=()
  local seed_pw="${GDC_SEED_ADMIN_PASSWORD:-}"
  if [[ -z "$seed_pw" && -f "$ENV_FILE" ]]; then
    seed_pw="$(read_env_assignment "$ENV_FILE" GDC_SEED_ADMIN_PASSWORD)"
  fi
  if [[ -n "$seed_pw" ]]; then
    local plen="${#seed_pw}"
    if [[ "$plen" -lt 8 ]]; then
      die "GDC_SEED_ADMIN_PASSWORD must be at least 8 characters when set (see .env / environment)."
    fi
    docker_env_args=(-e "GDC_SEED_ADMIN_PASSWORD=${seed_pw}")
  fi
  docker compose -f "$COMPOSE_REL" run --rm --no-deps "${docker_env_args[@]}" api python -m app.db.seed --platform-admin-only
}

usage() {
  cat <<'EOF'
Usage: install.sh [OPTION]...

Fresh platform install: .env bootstrap, migrations, then full stack (see script header).
Restart-only: use --no-build (docker compose up -d --no-build; no migrations or admin seed).

Options:
  (none)     Full install: existing images; compose builds only if a required image is missing.
  --build    Rebuild api, frontend, and reverse-proxy images.
  --pull     Pull declared images (e.g. postgres:16-alpine) before build/up.
  --no-build Restart/redeploy: pull (if also --pull), then docker compose up -d --no-build only.
  -h, --help Show this help.

Environment:
  GDC_RELEASE_COMPOSE_FILE  Compose file (default: docker-compose.platform.yml)
  GDC_INSTALL_GENERATE_TLS  Set to 1 to generate self-signed TLS before start (full install only).
  GDC_PUBLIC_URL            Optional full browser URL for completion banner (e.g. https://gdc.example.com:18443/ or https://gdc.example.com/)
  GDC_INSTALL_MIN_MEM_MB    Minimum host RAM for install (default: 2048)
  GDC_INSTALL_MIN_DISK_GB   Minimum free disk under repo (default: 10)

On Ubuntu 24.04 without Docker, install.sh runs scripts/install-docker-ubuntu2404.sh (sudo).
If group membership changed, re-run after: newgrp docker
EOF
}

log_step() {
  STEP_NUM=$((STEP_NUM + 1))
  CURRENT_STEP="$2"
  echo "[$(ts)] [${STEP_NUM}/${1}] ${CURRENT_STEP} (elapsed $(format_elapsed "$(elapsed_seconds)"))"
}

wait_for_backend_health() {
  local deadline=$(( $(date +%s) + 180 ))
  while [[ "$(date +%s)" -lt "$deadline" ]]; do
    if docker compose -f "$COMPOSE_REL" exec -T api \
      wget -qO- "http://127.0.0.1:8000/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 3
  done
  return 1
}

verify_frontend_container_running() {
  local cid
  cid="$(docker compose -f "$COMPOSE_REL" ps -q frontend 2>/dev/null || true)"
  [[ -n "$cid" ]] || return 1
  local running
  running="$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null || echo false)"
  [[ "$running" == "true" ]]
}

print_health_summary_lines() {
  local backend_ok="$1" frontend_ok="$2"
  echo ""
  echo "Health checks:"
  echo "  Backend GET /health (inside api container): $backend_ok"
  echo "  Frontend container running: $frontend_ok"
}

print_final_banner() {
  CURRENT_STEP="Install completion summary (banner and health)"
  local health_backend="$1" health_frontend="$2"
  local overall_health="FAILED"
  if [[ "$health_backend" == "PASS" && "$health_frontend" == "PASS" ]]; then
    overall_health="OK"
  fi
  print_install_completion_banner
  echo ""
  echo "Health checks: backend=$health_backend frontend=$health_frontend ($overall_health)"
  echo "Elapsed: $(format_elapsed "$(elapsed_seconds)")"
  if [[ "$COMPOSE_REL" == *"https"* ]]; then
    local _https_port
    _https_port="$(read_env_assignment "$ENV_FILE" GDC_ENTRY_HTTPS_PORT)"
    [[ -z "$_https_port" ]] && _https_port=443
    echo "HTTPS (after Admin TLS + PEM): see docs/deployment/https-reverse-proxy.md (host port often ${_https_port})."
  fi
  echo "Compose file: $COMPOSE_REL"
}

resolve_entry_http_port() {
  local raw
  raw="$(read_env_assignment "$ENV_FILE" GDC_ENTRY_HTTP_PORT)"
  [[ -z "$raw" ]] && raw="18080"
  case "$raw" in
    *:*)
      raw="${raw##*:}"
      raw="${raw%%/*}"
      ;;
  esac
  printf '%s' "$raw"
}

verify_reverse_proxy_health() {
  local port body
  port="$(resolve_entry_http_port)"
  if ! command -v curl >/dev/null 2>&1; then
    echo "WARN: curl not installed; skipping reverse-proxy /health check." >&2
    return 0
  fi
  body="$(curl -fsS "http://127.0.0.1:${port}/health" 2>/dev/null || true)"
  [[ -n "$body" ]] || return 1
  return 0
}

verify_login_endpoint() {
  local port pw payload http_code
  port="$(resolve_entry_http_port)"
  pw="$(resolve_install_admin_password)"
  if ! command -v curl >/dev/null 2>&1; then
    echo "WARN: curl not installed; skipping login endpoint check." >&2
    return 0
  fi
  payload="$(python3 - "$pw" <<'PY'
import json, sys
print(json.dumps({"username": "admin", "password": sys.argv[1]}))
PY
)"
  http_code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
    "http://127.0.0.1:${port}/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null || echo "000")"
  [[ "$http_code" == "200" ]]
}

run_health_checks_or_fail() {
  local backend_st="FAIL" frontend_st="FAIL" proxy_st="FAIL" login_st="FAIL"
  if wait_for_backend_health; then
    backend_st="PASS"
  fi
  if verify_frontend_container_running; then
    frontend_st="PASS"
  fi
  if verify_reverse_proxy_health; then
    proxy_st="PASS"
  fi
  if verify_login_endpoint; then
    login_st="PASS"
  fi
  LAST_HEALTH_BACKEND_RESULT="$backend_st"
  LAST_HEALTH_FRONTEND_RESULT="$frontend_st"
  print_health_summary_lines "$backend_st" "$frontend_st"
  echo "  Reverse-proxy GET /health (host): $proxy_st"
  echo "  POST /api/v1/auth/login (host): $login_st"
  if [[ "$backend_st" != "PASS" || "$frontend_st" != "PASS" || "$proxy_st" != "PASS" || "$login_st" != "PASS" ]]; then
    echo "" >&2
    echo "ERROR: One or more health checks failed (see above)." >&2
    exit 1
  fi
}

install_restart_only() {
  STEP_TOTAL=5
  STEP_NUM=0
  cd "$ROOT"

  if [[ ! -f "$ROOT/$COMPOSE_REL" ]]; then
    die "Compose file not found: $ROOT/$COMPOSE_REL"
  fi

  log_step "$STEP_TOTAL" "Checking Docker and Compose"
  ensure_docker_ready

  log_step "$STEP_TOTAL" "Preparing environment (.env validation)"
  bootstrap_env
  validate_env_file
  warn_lab_database_url_for_platform

  if [[ "$DO_PULL" -eq 1 ]]; then
    log_step "$STEP_TOTAL" "Pulling images (docker compose pull)"
    docker compose -f "$COMPOSE_REL" pull
  else
    log_step "$STEP_TOTAL" "Pulling images (skipped; use --pull to pull bases)"
  fi

  log_step "$STEP_TOTAL" "Starting containers (docker compose up -d --no-build)"
  echo "NOTE: --no-build mode skips migrations and admin seed. Use a full install for first-time database setup."
  docker compose -f "$COMPOSE_REL" up -d --no-build

  log_step "$STEP_TOTAL" "Waiting for healthcheck (backend /health, frontend container)"
  run_health_checks_or_fail
  print_final_banner "$LAST_HEALTH_BACKEND_RESULT" "$LAST_HEALTH_FRONTEND_RESULT"
  echo ""
  CURRENT_STEP="Emitting install timing summary"
  emit_install_timing_summary
}

install_full() {
  STEP_TOTAL=11
  STEP_NUM=0
  cd "$ROOT"

  log_step "$STEP_TOTAL" "Checking Docker and Compose (install if missing on Ubuntu 24.04)"
  ensure_docker_ready

  log_step "$STEP_TOTAL" "Validating system resources (memory, disk)"
  validate_system_resources

  log_step "$STEP_TOTAL" "Validating required host ports are free (18080, 18443, 55432)"
  validate_required_ports_free

  log_step "$STEP_TOTAL" "Preparing environment (.env bootstrap and validation)"
  mkdir -p deploy/tls deploy/backups
  bootstrap_env
  validate_env_file
  warn_lab_database_url_for_platform

  log_step "$STEP_TOTAL" "Optional TLS material (GDC_INSTALL_GENERATE_TLS)"
  if [[ "${GDC_INSTALL_GENERATE_TLS:-}" == "1" ]]; then
    "$SCRIPT_DIR/generate-self-signed-cert.sh"
  else
    echo "TLS generation skipped (set GDC_INSTALL_GENERATE_TLS=1 to run generate-self-signed-cert.sh)."
  fi

  if [[ ! -f "$ROOT/$COMPOSE_REL" ]]; then
    die "Compose file not found: $ROOT/$COMPOSE_REL"
  fi

  if [[ "$DO_PULL" -eq 1 ]]; then
    log_step "$STEP_TOTAL" "Pulling images (docker compose pull)"
    docker compose -f "$COMPOSE_REL" pull
  else
    log_step "$STEP_TOTAL" "Pulling images (skipped; use --pull to pull bases)"
  fi

  local _build_start _build_end _built=0
  if [[ "$DO_BUILD" -eq 1 ]]; then
    log_step "$STEP_TOTAL" "Building backend (api) image"
    _build_start="$(date +%s)"
    docker compose -f "$COMPOSE_REL" build api
    log_step "$STEP_TOTAL" "Building frontend and reverse-proxy images"
    docker compose -f "$COMPOSE_REL" build frontend reverse-proxy
    _build_end="$(date +%s)"
    IMAGE_BUILD_SECONDS=$((_build_end - _build_start))
    _built=1
  else
    log_step "$STEP_TOTAL" "Building service images (skipped; use --build for a full rebuild)"
    log_step "$STEP_TOTAL" "Deferred image builds (compose builds missing images on startup if needed)"
  fi
  if [[ "$_built" -eq 0 ]]; then
    IMAGE_BUILD_SECONDS=""
  fi

  local _pg_db _pg_user
  _pg_db="$(gdc_release_resolve_postgres_db_name "$ROOT" "$COMPOSE_REL" "")"
  _pg_user="$(gdc_release_resolve_postgres_user "$ROOT" "$COMPOSE_REL")"
  log_step "$STEP_TOTAL" "Starting PostgreSQL and waiting for readiness (catalog: $_pg_db, user: $_pg_user)"
  docker compose -f "$COMPOSE_REL" up -d postgres
  for _ in $(seq 1 45); do
    if docker compose -f "$COMPOSE_REL" exec -T postgres pg_isready -U "$_pg_user" -d "$_pg_db" >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
  if ! docker compose -f "$COMPOSE_REL" exec -T postgres pg_isready -U "$_pg_user" -d "$_pg_db" >/dev/null 2>&1; then
    die "PostgreSQL did not become ready in time (expected catalog $_pg_db). Check: docker compose -f $COMPOSE_REL logs postgres"
  fi

  log_step "$STEP_TOTAL" "Pre-migration integrity check (read-only)"
  export GDC_RELEASE_COMPOSE_FILE="$COMPOSE_REL"
  set +e
  docker compose -f "$COMPOSE_REL" run --rm --no-deps api python -m app.db.validate_migrations --pre-upgrade
  _mig_val_rc=$?
  set -e
  if [[ "$_mig_val_rc" -eq 1 ]]; then
    die "Migration integrity check failed before alembic upgrade. See docs/operations/migration-recovery-runbook.md"
  fi
  if [[ "$_mig_val_rc" -eq 2 ]]; then
    echo "WARN: Migration integrity reported warnings (see output above)." >&2
  fi

  log_step "$STEP_TOTAL" "Running Alembic migrations (docker compose run api)"
  local _mig_start
  _mig_start="$(date +%s)"
  docker compose -f "$COMPOSE_REL" run --rm --no-deps api alembic upgrade head
  MIGRATION_SECONDS=$(( $(date +%s) - _mig_start ))

  CURRENT_STEP="Bootstrapping platform administrator (create-only)"
  bootstrap_platform_admin

  log_step "$STEP_TOTAL" "Starting full application stack (docker compose up -d)"
  docker compose -f "$COMPOSE_REL" up -d

  log_step "$STEP_TOTAL" "Waiting for healthcheck (backend, frontend, reverse-proxy /health, login)"
  run_health_checks_or_fail
  print_final_banner "$LAST_HEALTH_BACKEND_RESULT" "$LAST_HEALTH_FRONTEND_RESULT"
  echo ""
  CURRENT_STEP="Emitting install timing summary"
  emit_install_timing_summary
}

main() {
  DO_PULL=0
  DO_BUILD=0
  RESTART_ONLY=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --build) DO_BUILD=1; shift ;;
      --pull) DO_PULL=1; shift ;;
      --no-build) RESTART_ONLY=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "Unknown option: $1 (try --help)" ;;
    esac
  done
  if [[ "$DO_BUILD" -eq 1 && "$RESTART_ONLY" -eq 1 ]]; then
    die "Cannot combine --build and --no-build."
  fi

  if [[ "$RESTART_ONLY" -eq 1 ]]; then
    install_restart_only
    return 0
  fi

  install_full
}

main "$@"
