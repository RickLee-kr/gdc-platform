#!/usr/bin/env bash
# Stop the full E2E dev validation lab containers. Preserves named volumes by
# default (datarelay catalog, MinIO objects, fixture PG, SFTP files). Volume
# removal requires explicit --with-volumes and CONFIRM=1 to satisfy the
# preserve-user-entities rule.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.test.yml"
COMPOSE_PROJECT="${GDC_FULL_E2E_COMPOSE_PROJECT:-gdc-platform-test}"
PROFILE="${GDC_FULL_E2E_COMPOSE_PROFILE:-test}"

REMOVE_CONTAINERS=false
REMOVE_VOLUMES=false

usage() {
  cat <<EOF
Usage: $0 [--down] [--with-volumes]

Default behaviour: 'docker compose stop' for the full E2E test profile.
Containers and named volumes (datarelay, MinIO, fixture PG, SFTP) are kept.

Options:
  --down           Run 'docker compose down' (remove containers, networks).
                   Named volumes are still kept unless --with-volumes is set.
  --with-volumes   DESTRUCTIVE: also remove named volumes used by the test stack.
                   Requires --down and CONFIRM=1. Only test/fixture data is
                   stored in these volumes; the production stack
                   (docker-compose.platform.yml) is untouched.
EOF
}

for arg in "$@"; do
  case "$arg" in
  --down) REMOVE_CONTAINERS=true ;;
  --with-volumes) REMOVE_VOLUMES=true ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    echo "Unknown option: $arg (try --help)" >&2
    exit 1
    ;;
  esac
done

if [[ "$REMOVE_VOLUMES" == true ]]; then
  if [[ "$REMOVE_CONTAINERS" != true ]]; then
    echo "ERROR: --with-volumes requires --down" >&2
    exit 1
  fi
  if [[ "${CONFIRM:-}" != "1" ]]; then
    echo "ERROR: --with-volumes is destructive; set CONFIRM=1 to proceed." >&2
    echo "  Volumes wiped: gdc_test_postgres_data, gdc_minio_test_data," >&2
    echo "                 gdc_postgres_query_data, gdc_sftp_test_data," >&2
    echo "                 gdc_mysql_query_data, gdc_mariadb_query_data," >&2
    echo "                 gdc_ssh_scp_test_data." >&2
    exit 1
  fi
fi

if [[ "$REMOVE_CONTAINERS" == true ]]; then
  if [[ "$REMOVE_VOLUMES" == true ]]; then
    echo "Bringing full E2E lab down (containers + named volumes; test data only) …"
    docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" --profile "$PROFILE" down -v
  else
    echo "Bringing full E2E lab down (containers; named volumes preserved) …"
    docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" --profile "$PROFILE" down
  fi
else
  echo "Stopping full E2E lab containers (preserving containers + volumes) …"
  docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" --profile "$PROFILE" stop
fi

echo "Done."
