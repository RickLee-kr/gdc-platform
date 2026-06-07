# M13 Classification Engine MVP

Rule-based data classification after Sensitive Detection and before Protection.

## Levels

`PUBLIC` < `INTERNAL` < `CONFIDENTIAL` < `RESTRICTED` (highest wins on multi-match).

## Defaults (no explicit rule match)

| Finding | Level |
|---------|-------|
| (none) | INTERNAL |
| secret | RESTRICTED |
| pii | CONFIDENTIAL |
| security_metadata | INTERNAL |

Explicit `stream_classification_rules` override defaults when matched.

## Event fields

- `classification_level` when absent on source event
- `classification_level_gdc` when source already has `classification_level`

## Integrations

- Policy / Dynamic Routing: `condition_json.classification_level` (additive; `sensitivity_class` unchanged)
- Quarantine: via existing policy `quarantine` action on classification conditions
- Preview: same engine; no persistence
- Observability: `delivery_logs` stage `classification_complete`

## Excluded

AI/ML, new policy actions, replay/failover/routing engine changes.
