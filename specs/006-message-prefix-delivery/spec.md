# Message prefix (route delivery)

## Purpose

Optional prefix applied **only** when delivering to a destination: `prefix + space + compact JSON` of the enriched event.

Mapping, enrichment, and checkpoints operate on the original event objects unchanged.

## Storage

Route `formatter_config_json`:

- `message_prefix_enabled` (boolean, optional — defaults by destination type)
- `message_prefix_template` (string, optional — platform default when missing)

## Defaults

- SYSLOG (`SYSLOG_UDP` / `SYSLOG_TCP`): `message_prefix_enabled` defaults **true**
- `WEBHOOK_POST`: defaults **false**

Default template: `<134> gdc generic-connector event:`

## Resolution note

Prefix keys are stripped before `resolve_formatter_config` so a route may carry only prefix settings without replacing destination syslog formatter metadata used for validation/resolution.
