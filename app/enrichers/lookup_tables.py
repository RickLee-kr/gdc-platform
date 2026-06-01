"""In-memory lookup tables for enrichment lookup rules."""

from __future__ import annotations

AWS_REGIONS: dict[str, str] = {
    "us-east-1": "US East (N. Virginia)",
    "us-east-2": "US East (Ohio)",
    "us-west-1": "US West (N. California)",
    "us-west-2": "US West (Oregon)",
    "eu-west-1": "EU (Ireland)",
    "eu-central-1": "EU (Frankfurt)",
    "ap-southeast-1": "Asia Pacific (Singapore)",
    "ap-northeast-1": "Asia Pacific (Tokyo)",
}

SEVERITY_LABELS: dict[str, str] = {
    "1": "low",
    "2": "medium",
    "3": "high",
    "4": "critical",
    "low": "low",
    "medium": "medium",
    "high": "high",
    "critical": "critical",
}

TABLES: dict[str, dict[str, str]] = {
    "aws_regions": AWS_REGIONS,
    "aws-regions": AWS_REGIONS,
    "severity_labels": SEVERITY_LABELS,
    "severity-labels": SEVERITY_LABELS,
    "severity_mapping": SEVERITY_LABELS,
}


def normalize_table_name(name: str) -> str:
    return name.strip().lower().replace("-", "_")


def lookup_value(table_name: str, key: str) -> str | None:
    """Resolve ``key`` in the named lookup table; ``None`` when missing."""

    raw = table_name.strip()
    table = TABLES.get(raw) or TABLES.get(normalize_table_name(raw))
    if table is None:
        return None
    lookup_key = str(key).strip()
    if lookup_key in table:
        return table[lookup_key]
    return table.get(lookup_key.lower())
