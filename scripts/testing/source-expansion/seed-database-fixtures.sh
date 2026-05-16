#!/usr/bin/env bash
# Seed isolated fixture databases for DATABASE_QUERY lab (NOT platform gdc / datarelay).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
COMPOSE="${GDC_DEV_VALIDATION_COMPOSE_FILE:-$ROOT/docker-compose.dev-validation.yml}"
PROJECT="${GDC_DEV_VALIDATION_COMPOSE_PROJECT:-gdc-platform-test}"

PG_URL="${DATABASE_QUERY_PG_URL:-postgresql://gdc_fixture:gdc_fixture_pw@127.0.0.1:55433/gdc_query_fixture}"

SQL_PG="$(cat <<'SQL'
CREATE TABLE IF NOT EXISTS security_events (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS waf_events (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL
);
TRUNCATE security_events, audit_logs, waf_events RESTART IDENTITY;
INSERT INTO security_events (event_id, message, severity) VALUES
 ('evt-1','login ok','info'),
 ('evt-2','policy hit','medium'),
 ('evt-3','blocked','high');
INSERT INTO audit_logs (event_id, message, severity) VALUES ('a-1','rotate keys','info');
INSERT INTO waf_events (event_id, message, severity) VALUES ('w-1','sql sig','critical');
SQL
)"

if command -v docker >/dev/null 2>&1 && docker compose -p "$PROJECT" -f "$COMPOSE" --profile dev-validation ps --status running postgres-query-test 2>/dev/null | grep -q postgres-query-test; then
  echo "Seeding postgres-query-test via docker compose exec …"
  docker compose -p "$PROJECT" -f "$COMPOSE" --profile dev-validation exec -T postgres-query-test \
    psql -U gdc_fixture -d gdc_query_fixture -v ON_ERROR_STOP=1 -c "$SQL_PG"
elif command -v psql >/dev/null 2>&1; then
  echo "Seeding via psql DATABASE_QUERY_PG_URL …"
  psql "$PG_URL" -v ON_ERROR_STOP=1 -c "$SQL_PG"
else
  echo "Neither docker postgres-query-test nor psql available; skip PostgreSQL fixtures."
fi

SQL_MY="$(cat <<'SQL'
CREATE TABLE IF NOT EXISTS security_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id VARCHAR(128) NOT NULL,
  message TEXT NOT NULL,
  severity VARCHAR(32) NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id VARCHAR(128) NOT NULL,
  message TEXT NOT NULL,
  severity VARCHAR(32) NOT NULL
);
CREATE TABLE IF NOT EXISTS waf_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id VARCHAR(128) NOT NULL,
  message TEXT NOT NULL,
  severity VARCHAR(32) NOT NULL
);
DELETE FROM security_events;
DELETE FROM audit_logs;
DELETE FROM waf_events;
INSERT INTO security_events (event_id, message, severity) VALUES
 ('evt-1','login ok','info'),
 ('evt-2','policy hit','medium'),
 ('evt-3','blocked','high');
INSERT INTO audit_logs (event_id, message, severity) VALUES ('a-1','rotate keys','info');
INSERT INTO waf_events (event_id, message, severity) VALUES ('w-1','sql sig','critical');
SQL
)"

if command -v docker >/dev/null 2>&1 && docker compose -p "$PROJECT" -f "$COMPOSE" --profile dev-validation ps --status running mysql-query-test 2>/dev/null | grep -q mysql-query-test; then
  docker compose -p "$PROJECT" -f "$COMPOSE" --profile dev-validation exec -T mysql-query-test \
    mysql -ugdc_fixture -pgdc_fixture_pw gdc_query_fixture -e "$SQL_MY"
fi

if command -v docker >/dev/null 2>&1 && docker compose -p "$PROJECT" -f "$COMPOSE" --profile dev-validation ps --status running mariadb-query-test 2>/dev/null | grep -q mariadb-query-test; then
  docker compose -p "$PROJECT" -f "$COMPOSE" --profile dev-validation exec -T mariadb-query-test \
    mariadb -ugdc_fixture -pgdc_fixture_pw gdc_query_fixture -e "$SQL_MY"
fi

echo "Database query fixtures applied (security_events / audit_logs / waf_events)."
