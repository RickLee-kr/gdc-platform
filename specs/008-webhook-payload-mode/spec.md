# 008 Webhook payload mode

## Scope

WEBHOOK_POST destinations support `config_json.payload_mode`:

- `SINGLE_EVENT_OBJECT` (default): one HTTP POST per event with a JSON object body.
- `BATCH_JSON_ARRAY`: existing behavior — JSON array body, optionally chunked by `batch_size`.

Syslog destinations must not set `payload_mode`. Checkpoint and retry semantics are unchanged.
