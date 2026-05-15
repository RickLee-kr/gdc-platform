#!/usr/bin/env bash
# Dev Validation Lab — simplified stop command.
#
# Stops the backend (uvicorn) and frontend (Vite) processes that start.sh
# spawned, using PID files under .dev-validation-logs/. With --with-docker,
# also runs `docker compose stop` on the test stack. Docker VOLUMES are never
# removed by this command — your gdc_test database state is preserved.
#
# Underlying script: scripts/dev-validation/stop-dev-validation-lab.sh.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNDERLYING="$ROOT/scripts/dev-validation/stop-dev-validation-lab.sh"

if [[ ! -x "$UNDERLYING" ]]; then
  echo "ERROR: cannot execute $UNDERLYING" >&2
  exit 1
fi

for arg in "$@"; do
  case "$arg" in
  -h | --help)
    cat <<EOF
Usage: $0 [--with-docker]

  --with-docker  Also stop the docker test stack (containers only; volumes kept).
                 Without this flag, only backend/frontend processes are stopped.

  Never deletes Docker volumes. If you need to wipe gdc_test, use:
    $(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/reset-db.sh
EOF
    exit 0
    ;;
  esac
done

exec "$UNDERLYING" "$@"
