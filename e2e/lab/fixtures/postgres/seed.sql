-- Full E2E Lab PostgreSQL source fixture (idempotent).
-- Table: full_e2e_rows

CREATE TABLE IF NOT EXISTS full_e2e_rows (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  e2e_correlation_id TEXT NOT NULL,
  message TEXT,
  severity TEXT,
  event_ts TIMESTAMPTZ NOT NULL,
  ordering_seq INT NOT NULL,
  nullable_note TEXT,
  rare_field TEXT,
  email_like TEXT
);

DELETE FROM full_e2e_rows WHERE e2e_correlation_id LIKE 'full-e2e-%';

-- Initial rows
INSERT INTO full_e2e_rows
  (event_id, e2e_correlation_id, message, severity, event_ts, ordering_seq, nullable_note, rare_field, email_like)
VALUES
  ('fe2e-db-1', 'full-e2e-corr-db-1', 'initial row', 'low', '2026-01-01T00:00:00Z', 1, NULL, NULL, 'user1@example.com'),
  ('fe2e-db-2', 'full-e2e-corr-db-2', 'second row', 'medium', '2026-01-01T00:00:01Z', 2, 'note', NULL, NULL),
  ('fe2e-db-3', 'full-e2e-corr-db-3', 'third row', 'high', '2026-01-01T00:00:02Z', 3, NULL, 'rare-value', 'ops@example.com');

-- Duplicate event_id (dedup scenarios)
INSERT INTO full_e2e_rows
  (event_id, e2e_correlation_id, message, severity, event_ts, ordering_seq, nullable_note, rare_field, email_like)
VALUES
  ('fe2e-db-1', 'full-e2e-corr-db-dup-1', 'duplicate of first', 'low', '2026-01-01T00:00:03Z', 4, NULL, NULL, NULL);

-- Out-of-order timestamp
INSERT INTO full_e2e_rows
  (event_id, e2e_correlation_id, message, severity, event_ts, ordering_seq, nullable_note, rare_field, email_like)
VALUES
  ('fe2e-db-ooo', 'full-e2e-corr-db-ooo', 'out of order', 'info', '2025-12-31T23:59:00Z', 5, NULL, NULL, NULL);

-- Incremental / new rows
INSERT INTO full_e2e_rows
  (event_id, e2e_correlation_id, message, severity, event_ts, ordering_seq, nullable_note, rare_field, email_like)
VALUES
  ('fe2e-db-new', 'full-e2e-corr-db-new', 'incremental new', 'info', '2026-01-01T00:01:00Z', 6, NULL, NULL, 'new@example.com');
