"""Durable delivery queue (PERSISTENT_QUEUE).

Phase 1: DB model + claim/lease repository.
Phase 2: Webhook Destination path wired via StreamRunner when
``stream.config_json.reliability_mode == PERSISTENT_QUEUE``.

Exactly-once limitation (crash window B): if the webhook sink accepts the
request and Data Relay crashes before ``DELIVERED`` is persisted, a later
claim/re-send may duplicate. Destination idempotency (optional
``X-Data-Relay-Delivery-Id``) and existing dedup registry mitigate but cannot
guarantee exactly-once when the sink lacks idempotency. Events are never
dropped to force ``duplicate=0``.
"""
