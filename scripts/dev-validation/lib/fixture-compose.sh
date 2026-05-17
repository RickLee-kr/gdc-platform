# Shared docker compose helpers for dev-validation fixture stack (source from bash scripts).
# shellcheck shell=bash
DEV_VALIDATION_ROOT="${DEV_VALIDATION_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
DEV_VALIDATION_COMPOSE_FILE="${GDC_DEV_VALIDATION_COMPOSE_FILE:-$DEV_VALIDATION_ROOT/docker-compose.dev-validation.yml}"
DEV_VALIDATION_COMPOSE_PROJECT="${GDC_DEV_VALIDATION_COMPOSE_PROJECT:-gdc-platform-test}"
DEV_VALIDATION_PROFILE="${GDC_DEV_VALIDATION_PROFILE:-dev-validation}"
DEV_VALIDATION_DOCKER_NETWORK="${GDC_DEV_VALIDATION_DOCKER_NETWORK:-gdc-dev-validation}"

_fixture_compose() {
  docker compose -p "$DEV_VALIDATION_COMPOSE_PROJECT" -f "$DEV_VALIDATION_COMPOSE_FILE" --profile "$DEV_VALIDATION_PROFILE" "$@"
}

_fixture_service_running() {
  local svc="$1"
  _fixture_compose ps --status running "$svc" 2>/dev/null | grep -q "$svc"
}
