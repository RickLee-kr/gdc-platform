# M12 Quarantine MVP

## Scope

Policy-driven and manual-source quarantine of protected delivery payloads. Operator release and discard only.

## Pipeline position

Sensitive Detection → Protection → Policy → **Quarantine** → Destination

## Excluded

Auto release, auto approval, classification engine, replay auto-creation, enriched event storage.

## Checkpoint

- `quarantined`: no destination send, no checkpoint update
- `released`: destination send success → checkpoint may advance
- `discarded`: no checkpoint update

## Release

Uses stored `protected_payload_json` only; no mapping, enrichment, protection, policy, or replay.
