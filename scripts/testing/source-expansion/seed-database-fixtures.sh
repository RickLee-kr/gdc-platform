#!/usr/bin/env bash
# Seed isolated fixture databases for DATABASE_QUERY lab (NOT platform catalog DB).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# shellcheck source=scripts/dev-validation/lib/fixture-compose.sh
source "$ROOT/scripts/dev-validation/lib/fixture-compose.sh"
# shellcheck source=scripts/dev-validation/lib/db-exec.sh
source "$ROOT/scripts/dev-validation/lib/db-exec.sh"

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

if _fixture_service_running postgres-query-test; then
  echo "Waiting for postgres-query-test …"
  _wait_sql_tcp postgres-query-test gdc_fixture gdc_fixture_pw gdc_query_fixture
  echo "Seeding postgres-query-test via docker compose exec …"
  printf '%s\n' "$SQL_PG" | _sql_tcp_stdin postgres-query-test gdc_fixture gdc_fixture_pw gdc_query_fixture
else
  echo "postgres-query-test not running; skip PostgreSQL fixtures."
fi

if _fixture_service_running mysql-query-test; then
  echo "Waiting for mysql-query-test …"
  _wait_sql_tcp mysql-query-test gdc_fixture gdc_fixture_pw gdc_query_fixture
  echo "Seeding mysql-query-test via docker compose exec (TCP) …"
  printf '%s\n' "$SQL_MY" | _sql_tcp_stdin mysql-query-test gdc_fixture gdc_fixture_pw gdc_query_fixture
else
  echo "mysql-query-test not running; skip MySQL fixtures."
fi

if _fixture_service_running mariadb-query-test; then
  echo "Waiting for mariadb-query-test …"
  _wait_sql_tcp mariadb-query-test gdc_fixture gdc_fixture_pw gdc_query_fixture
  echo "Seeding mariadb-query-test via docker compose exec (TCP) …"
  printf '%s\n' "$SQL_MY" | _sql_tcp_stdin mariadb-query-test gdc_fixture gdc_fixture_pw gdc_query_fixture
else
  echo "mariadb-query-test not running; skip MariaDB fixtures."
fi

echo "Database query fixtures applied (security_events / audit_logs / waf_events)."
