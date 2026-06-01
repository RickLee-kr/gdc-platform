# Advanced enrichment rules

Enrichment runs **after mapping** and **before** the formatter and destination. The same engine powers runtime delivery and wizard preview APIs.

## Pipeline position

```
Source → Mapping → Enrichment → Formatter → Destination
```

Checkpoints advance only after successful destination delivery (unchanged).

## Storage shape

| Layer | Where rules live |
|--------|------------------|
| Static values | Top-level keys in `enrichment_json` (e.g. `vendor`, `tenant`) |
| Advanced rules | `enrichment_json.__rules`, keyed by **target field name** |

Example:

```json
{
  "tenant": "acme-corp",
  "vendor": "Stellar Cyber",
  "__rules": {
    "metadata.severity_label": {
      "type": "lookup",
      "lookup_table": "severity_labels",
      "lookup_key_field": "severity",
      "enabled": true
    },
    "metadata.ingest_ts": {
      "type": "normalize",
      "source_field": "timestamp",
      "format": "iso8601",
      "enabled": true
    }
  }
}
```

`__rules`, `__computed`, and other `__*` keys are **never** sent to formatters or destinations.

## Supported rule types

| Type | Purpose |
|------|---------|
| `static` | Fixed value or `{{now_utc}}` template |
| `calculated` | Sandboxed expression (see below) |
| `lookup` | Map a field value through a built-in table |
| `conditional` | First matching `when` / `then`, optional `default` |
| `normalize` | Format or case-transform a source field |

Disabled rules (`enabled: false`) are skipped at runtime.

## Calculated expressions

**Functions:** `concat`, `upper`, `lower`, `coalesce`, `now_utc`

**Field references:** `{{field}}` or `{{nested.path}}`

**Legacy:** JavaScript-style ternaries with `.includes()` are still supported for compatibility, e.g.:

```
eventName.includes('Delete') ? 8 : 5
```

Failed expressions emit warning `calculated_expression_failed` and do not write the target field.

## Lookup tables

Built-in tables (aliases accepted):

| Name | Keys | Example value |
|------|------|----------------|
| `aws_regions` / `aws-regions` | AWS region codes | `us-east-1` → display name |
| `severity_labels` / `severity-labels` | Severity codes | `high` → `High` |

Warnings:

- `lookup_key_missing` — key field absent on event
- `lookup_miss` — key present but not in table (field not set)

## Normalize formats

`iso8601`, `lowercase`, `uppercase`, `trim`

Failures emit `normalize_failed`.

## Conditional rules

Supported `when` patterns (simplified):

- `field == value`
- `field != value`
- `field.includes('text')`
- `field` (exists)

Unmatched conditions use `default`. Empty result with no default → `conditional_invalid` warning.

## Override policy

Per stream: `KEEP_EXISTING` (default), `OVERRIDE`, `ERROR_ON_CONFLICT`.

When `KEEP_EXISTING`, enrichment does not overwrite keys already present on the mapped event.

## Validation (no execution)

`POST /api/v1/runtime/preview/enrichment-validate`

Returns structured issues:

- Errors block save in the wizard (missing target, invalid table, bad expression, invalid paths)
- Warnings include duplicate target fields and legacy expression hints

## Preview vs runtime

| API | Behavior |
|-----|----------|
| `POST .../preview/enrichment-exec` | Single mapped event; returns `final_event`, `warnings`, `duration_ms` |
| Runtime `StreamRunner` | Batch enrichment; warnings deduplicated and logged once per batch |
| Enrichment stage log | Includes `duration_ms`, `warning_count` |

Preview does not write checkpoints or call destinations.

## Stellar Cyber multi-tenant examples

Typical tenant isolation fields applied as **static** enrichment:

```json
{
  "tenant_id": "customer-42",
  "tenant_name": "Acme Security",
  "data_source": "stellar_cyber",
  "product": "XDR",
  "__rules": {
    "metadata.tenant_id": {
      "type": "calculated",
      "expression": "concat('sc-', {{organization_id}})",
      "enabled": true
    },
    "metadata.severity_label": {
      "type": "lookup",
      "lookup_table": "severity_labels",
      "lookup_key_field": "severity",
      "enabled": true
    }
  }
}
```

Use separate streams or routes per tenant when destinations require strict isolation.

## Limitations

- Lookup tables are in-memory built-ins only (no custom CSV upload yet).
- Calculated rules are not arbitrary Python/JS; use supported functions or legacy ternary subset.
- Conditional parsing is intentionally limited (no full expression language).
- Validation cannot prove runtime lookup hits without sample data (use preview).
- Batch runtime logs one deduplicated warning set per enrichment stage, not per event.

## Related tests

- `tests/test_enrichment_rules.py` — engine semantics
- `tests/test_enrichment_validation.py` — validation and payload safety
- `tests/test_stream_runner_advanced_enrichment_delivery.py` — delivery path
