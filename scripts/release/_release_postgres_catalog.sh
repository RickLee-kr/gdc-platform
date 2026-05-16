# shellcheck shell=bash
# Shared helpers for release scripts: infer the PostgreSQL catalog (POSTGRES_DB)
# for the Compose `postgres` service. Safe to `source` from other bash scripts.
#
# Resolution order for gdc_release_resolve_postgres_db_name:
#   1) If explicit_override is non-empty, use it (warn when it differs from compose).
#   2) Else POSTGRES_DB from `docker compose … config` (authoritative merged compose).
#   3) Else conservative path-based fallback (keeps behavior if `config` fails).

gdc_release_compose_postgres_db_from_config() {
  local root="$1" compose_rel="$2" out
  out="$(
    (cd "$root" && docker compose -f "$compose_rel" config 2>/dev/null) | awk '
      /^  postgres:$/ { pg=1; next }
      !pg { next }
      pg && /^      POSTGRES_DB:/ {
        val=$0
        sub(/^      POSTGRES_DB:[[:space:]]*/, "", val)
        gsub(/^['\''"]|['\''"]$/, "", val)
        print val
        exit 0
      }
      pg && /^  [a-z0-9_-]+:$/ { exit 1 }
    '
  )"
  if [[ -n "${out//[[:space:]]/}" ]]; then
    printf '%s\n' "$out"
  fi
}

gdc_release_fallback_postgres_db_for_compose() {
  local compose_rel="$1"
  case "$compose_rel" in
    docker-compose.platform.yml | */docker-compose.platform.yml) printf '%s\n' "gdc_test" ;;
    deploy/docker-compose.https.yml | */deploy/docker-compose.https.yml) printf '%s\n' "gdc" ;;
    docker-compose.yml | */docker-compose.yml) printf '%s\n' "gdc" ;;
    *) printf '%s\n' "gdc" ;;
  esac
}

# Args: ROOT COMPOSE_REL [explicit_override]
# Prints the database name to use for backup/restore. Warnings on stderr when
# explicit_override disagrees with the compose-inferred catalog.
gdc_release_resolve_postgres_db_name() {
  local root="$1" compose_rel="$2" explicit="${3-}"
  local from_config from_fb inferred
  from_config="$(gdc_release_compose_postgres_db_from_config "$root" "$compose_rel" || true)"
  from_fb="$(gdc_release_fallback_postgres_db_for_compose "$compose_rel")"
  inferred="${from_config:-$from_fb}"
  if [[ -n "$explicit" ]]; then
    if [[ "$explicit" != "$inferred" ]]; then
      echo "WARN: explicit database name '$explicit' differs from compose-inferred POSTGRES_DB='$inferred' (compose file: $compose_rel)." >&2
      echo "      If this is unintentional, pg_dump/restore may target the wrong catalog." >&2
    fi
    printf '%s\n' "$explicit"
    return 0
  fi
  printf '%s\n' "$inferred"
}
