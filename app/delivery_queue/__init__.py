"""Durable delivery queue (PERSISTENT_QUEUE).

Phase 1: DB model + claim/lease repository.
Phase 2: Webhook Destination path wired via StreamRunner when
``stream.config_json.reliability_mode == PERSISTENT_QUEUE``.
Phase 3: Runtime restart recovery reclaiming PENDING / RETRY_WAIT /
stale IN_FLIGHT items via the same claim + destination send path.
Phase 4: SYSLOG_TCP added to the same shared queue lifecycle (DIRECT
mode unchanged; SYSLOG_UDP / SYSLOG_TLS / AI_PROVIDER_POST remain DIRECT).
Phase 5: Backpressure / queue operational protection — depth/age gates
suppress new Source fetch when pressure exceeds high-water; auto-resume
below low-water; EXHAUSTED excluded from pressure; DIRECT unchanged.

Exactly-once limitation (crash window B / C): if the destination sink
accepts the payload and Data Relay crashes before ``DELIVERED`` is
persisted, a later claim/re-send may duplicate. Webhook optional
``X-Data-Relay-Delivery-Id`` and existing dedup registry mitigate but
cannot guarantee exactly-once when the sink lacks idempotency. Syslog
TCP has no application-level ACK/idempotency key — duplicates remain
possible after crash window B/C. Events are never dropped to force
``duplicate=0``. Restart recovery preserves this at-least-once contract
intentionally. Backpressure never discards events or advances checkpoint
to shed load.
"""
