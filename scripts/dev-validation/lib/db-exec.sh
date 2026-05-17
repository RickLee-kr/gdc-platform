# MySQL/MariaDB/PostgreSQL exec via docker compose (TCP inside container; no host DB clients).
# shellcheck shell=bash

_wait_sql_tcp() {
  local service="$1" user="$2" pass="$3" db="${4:-}"
  local attempts="${5:-90}"
  local i
  for i in $(seq 1 "$attempts"); do
    if _sql_tcp_query "$service" "$user" "$pass" "$db" "SELECT 1" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for $service SQL readiness" >&2
  return 1
}

_sql_tcp_query() {
  local service="$1" user="$2" pass="$3" db="${4:-}" sql="$5"
  case "$service" in
    postgres-query-test)
      local args=(-U "$user")
      [[ -n "$db" ]] && args+=(-d "$db")
      _fixture_compose exec -T "$service" psql "${args[@]}" -v ON_ERROR_STOP=1 -c "$sql"
      ;;
    mysql-query-test | mariadb-query-test)
      _fixture_compose exec -T "$service" sh -ec "
        set -e
        CLI=\$(command -v mariadb 2>/dev/null || command -v mysql 2>/dev/null || true)
        if [ -z \"\$CLI\" ]; then echo 'no mysql/mariadb client in container' >&2; exit 127; fi
        if [ -n \"$db\" ]; then
          exec \"\$CLI\" -h127.0.0.1 -P3306 --protocol=TCP -u\"$user\" -p\"$pass\" \"$db\" -e \"$sql\"
        else
          exec \"\$CLI\" -h127.0.0.1 -P3306 --protocol=TCP -u\"$user\" -p\"$pass\" -e \"$sql\"
        fi
      "
      ;;
    *)
      echo "unsupported SQL service: $service" >&2
      return 1
      ;;
  esac
}

_sql_tcp_stdin() {
  local service="$1" user="$2" pass="$3" db="${4:-}"
  case "$service" in
    postgres-query-test)
      local args=(-U "$user")
      [[ -n "$db" ]] && args+=(-d "$db")
      _fixture_compose exec -T "$service" psql "${args[@]}" -v ON_ERROR_STOP=1
      ;;
    mysql-query-test | mariadb-query-test)
      _fixture_compose exec -T "$service" sh -ec "
        set -e
        CLI=\$(command -v mariadb 2>/dev/null || command -v mysql 2>/dev/null || true)
        if [ -z \"\$CLI\" ]; then echo 'no mysql/mariadb client in container' >&2; exit 127; fi
        exec \"\$CLI\" -h127.0.0.1 -P3306 --protocol=TCP -u\"$user\" -p\"$pass\" \"$db\"
      "
      ;;
    *)
      echo "unsupported SQL service: $service" >&2
      return 1
      ;;
  esac
}
