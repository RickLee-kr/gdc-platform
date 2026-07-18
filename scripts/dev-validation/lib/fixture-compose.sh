# Shared docker compose helpers for dev-validation fixture stack (source from bash scripts).
# shellcheck shell=bash
DEV_VALIDATION_ROOT="${DEV_VALIDATION_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
DEV_VALIDATION_COMPOSE_FILE="${GDC_DEV_VALIDATION_COMPOSE_FILE:-$DEV_VALIDATION_ROOT/docker-compose.dev-validation.yml}"
DEV_VALIDATION_COMPOSE_PROJECT="${GDC_DEV_VALIDATION_COMPOSE_PROJECT:-gdc-platform-test}"
DEV_VALIDATION_PROFILE="${GDC_DEV_VALIDATION_PROFILE:-dev-validation}"
DEV_VALIDATION_DOCKER_NETWORK="${GDC_DEV_VALIDATION_DOCKER_NETWORK:-gdc-dev-validation}"

# Canonical hostname for platform + lab HTTP streams (compose alias on gdc-wiremock-test).
GDC_PLATFORM_WIREMOCK_HOSTNAME="${GDC_PLATFORM_WIREMOCK_HOSTNAME:-gdc-platform-wiremock-test}"
GDC_PLATFORM_WIREMOCK_BASE_URL="${GDC_PLATFORM_WIREMOCK_BASE_URL:-http://${GDC_PLATFORM_WIREMOCK_HOSTNAME}:8080}"

_fixture_compose() {
  docker compose -p "$DEV_VALIDATION_COMPOSE_PROJECT" -f "$DEV_VALIDATION_COMPOSE_FILE" --profile "$DEV_VALIDATION_PROFILE" "$@"
}

_fixture_service_running() {
  local svc="$1"
  _fixture_compose ps --status running "$svc" 2>/dev/null | grep -q "$svc"
}

_platform_lab_wiremock_running() {
  # Platform compose service gdc-wiremock-test (project gdc-platform).
  if docker ps --filter "label=com.docker.compose.project=gdc-platform" \
    --filter "label=com.docker.compose.service=gdc-wiremock-test" \
    --filter "status=running" --format '{{.Names}}' 2>/dev/null | grep -q .; then
    return 0
  fi
  # Fallback: common container name from docker compose.
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qE '^gdc-platform-gdc-wiremock-test'; then
    return 0
  fi
  return 1
}

_count_running_wiremock_containers() {
  docker ps --filter "status=running" --format '{{.Names}}' 2>/dev/null | grep -ciE 'wiremock' || true
}

_warn_duplicate_wiremock_containers() {
  local count
  count="$(_count_running_wiremock_containers)"
  count="${count:-0}"
  if [[ "$count" -gt 1 ]]; then
    echo "WARNING: ${count} running WireMock containers detected." >&2
    echo "  Lab streams must use ${GDC_PLATFORM_WIREMOCK_BASE_URL} only." >&2
    echo "  Do not start gdc-platform-test wiremock-test alongside platform --profile lab WireMock" >&2
    echo "  (DNS split-brain on ${DEV_VALIDATION_DOCKER_NETWORK})." >&2
    docker ps --filter "status=running" --format 'table {{.Names}}\t{{.Status}}\t{{.Label "com.docker.compose.project"}}' \
      2>/dev/null | grep -iE 'NAMES|wiremock' || true
  fi
}

# Drop wiremock-test from a service list when platform lab WireMock is already up
# (or when the caller will start it next). Prints remaining services one per line.
_filter_fixture_services_skip_wiremock_if_needed() {
  local skip_wiremock="${1:-auto}"
  shift || true
  local svc
  if [[ "$skip_wiremock" == "auto" ]]; then
    if _platform_lab_wiremock_running; then
      skip_wiremock="yes"
    else
      skip_wiremock="no"
    fi
  fi
  for svc in "$@"; do
    if [[ "$svc" == "wiremock-test" && "$skip_wiremock" == "yes" ]]; then
      echo "WARN: skipping fixture wiremock-test — reusing platform WireMock (${GDC_PLATFORM_WIREMOCK_BASE_URL})." >&2
      echo "      Do not docker start exited gdc-platform-test WireMock while lab is on platform WireMock." >&2
      continue
    fi
    printf '%s\n' "$svc"
  done
}
