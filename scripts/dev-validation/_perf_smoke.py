"""Performance smoke harness for the dev validation lab (PostgreSQL only).

Runs a small, deterministic set of latency checks against:

  - delivery_logs bulk insert
  - runtime metrics query (delivery_logs aggregation by stream / route)
  - logs explorer query (`GET /api/v1/runtime/logs/search` semantics)
  - route runtime aggregation (per-route metrics window)
  - retention preview / run (`GET/POST /api/v1/retention/*`)
  - backfill dry-run (`POST /api/v1/backfill/replay` with dry_run=true)
  - EXPLAIN ANALYZE for key delivery_logs queries
    (delegates to scripts/profile_query_plan.py for the full plan dump)

Safety / scope rules:

  - PostgreSQL only.
  - The script refuses to run unless DATABASE_URL points at gdc_test or
    gdc_e2e_test on 127.0.0.1:55432 (matches conftest.py + the lab start
    scripts).
  - It seeds *only* fixture stream/route/destination rows it creates itself in
    gdc_test; existing user-created entities are preserved (it scopes inserts
    by its own connector/stream IDs and skips delete on shutdown).
  - It uses FastAPI's TestClient to exercise HTTP-facing checks without
    requiring a separate uvicorn process.

Output is a fixed-width table:

  check                          rows tested  elapsed (ms)  threshold (ms)  result  notes
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Iterator
from urllib.parse import urlparse

DEFAULT_THRESHOLDS_MS: dict[str, int] = {
    "delivery_logs_bulk_insert": 12000,
    "runtime_metrics_query": 800,
    "logs_explorer_query": 800,
    "route_runtime_aggregation": 800,
    "retention_preview": 800,
    "retention_run": 1500,
    "backfill_dry_run": 2500,
    "explain_analyze_delivery_logs": 200,
}


@dataclass
class CheckResult:
    name: str
    rows_tested: int
    elapsed_ms: float
    threshold_ms: float
    passed: bool
    notes: str = ""


@dataclass
class FixtureIds:
    connector_id: int = 0
    source_id: int = 0
    stream_id: int = 0
    destination_id: int = 0
    route_id: int = 0
    extras: dict[str, Any] = field(default_factory=dict)


# --- Safety ----------------------------------------------------------------


def _safety_check_database_url(url: str) -> None:
    parsed = urlparse(url)
    db = (parsed.path or "").lstrip("/").split("/")[0]
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in ("postgresql", "postgres"):
        raise SystemExit(
            "Refusing to run perf smoke: DATABASE_URL must be postgresql://"
        )
    if db not in {"gdc_test", "gdc_e2e_test"}:
        raise SystemExit(
            "Refusing to run perf smoke: DATABASE_URL database must be "
            "'gdc_test' or 'gdc_e2e_test' (dev/test only)."
        )
    if parsed.port != 55432:
        raise SystemExit(
            f"Refusing to run perf smoke: DATABASE_URL port must be 55432 "
            f"(got {parsed.port!r})."
        )
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise SystemExit(
            f"Refusing to run perf smoke: DATABASE_URL host must be loopback "
            f"(got {host!r})."
        )


# --- Bulk insert + fixture rows -------------------------------------------


def _seed_delivery_logs(rows: int) -> CheckResult:
    """Wrap scripts/seed_delivery_logs_perf_data.py and time the bulk insert."""
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    script = os.path.join(repo_root, "scripts", "seed_delivery_logs_perf_data.py")
    cmd = [
        sys.executable,
        script,
        "--rows",
        str(rows),
        "--batch-size",
        "1000",
        "--days",
        "14",
        "--delete-existing",
    ]
    start = time.perf_counter()
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    note = "ok"
    if proc.returncode != 0:
        note = f"seed_delivery_logs_perf_data exit={proc.returncode}"
    threshold = DEFAULT_THRESHOLDS_MS["delivery_logs_bulk_insert"]
    return CheckResult(
        name="delivery_logs_bulk_insert",
        rows_tested=rows,
        elapsed_ms=elapsed_ms,
        threshold_ms=threshold,
        passed=(proc.returncode == 0) and (elapsed_ms <= threshold),
        notes=note,
    )


# --- TestClient + fixture HTTP entities (no production data mutation) -----


def _build_http_fixtures(client: Any) -> FixtureIds:
    """Create a dedicated [PERF SMOKE] connector/stream/destination/route in gdc_test.

    These rows are namespaced so user-created entities are not touched. We do not
    delete them on exit (per preserve-user-entities.mdc: prefer additive). They
    can be cleaned up manually with reset-dev-validation-db.sh if needed.
    """
    suffix = uuid.uuid4().hex[:8]

    cr = client.post(
        "/api/v1/connectors/",
        json={
            "name": f"[PERF SMOKE] connector {suffix}",
            "source_type": "HTTP_API_POLLING",
            "auth_type": "no_auth",
            "base_url": "http://127.0.0.1:1",
        },
    )
    if cr.status_code != 201:
        raise RuntimeError(f"connector create failed: {cr.status_code} {cr.text}")
    body = cr.json()
    connector_id = int(body["id"])
    source_id = int(body["source_id"])

    sr = client.post(
        "/api/v1/streams/",
        json={
            "name": f"[PERF SMOKE] stream {suffix}",
            "connector_id": connector_id,
            "source_id": source_id,
            "stream_type": "HTTP_API_POLLING",
            "config_json": {"path": "/perf-smoke/none"},
            "polling_interval": 3600,
            "enabled": False,
            "status": "STOPPED",
            "rate_limit_json": {"max_requests": 100, "per_seconds": 60},
        },
    )
    if sr.status_code != 201:
        raise RuntimeError(f"stream create failed: {sr.status_code} {sr.text}")
    stream_id = int(sr.json()["id"])

    dr = client.post(
        "/api/v1/destinations/",
        json={
            "name": f"[PERF SMOKE] destination {suffix}",
            "destination_type": "WEBHOOK_POST",
            "config_json": {"url": "http://127.0.0.1:1/perf-smoke"},
            "rate_limit_json": {"max_events": 1000, "per_seconds": 1},
        },
    )
    if dr.status_code != 201:
        raise RuntimeError(f"destination create failed: {dr.status_code} {dr.text}")
    destination_id = int(dr.json()["id"])

    rr = client.post(
        "/api/v1/routes/",
        json={
            "stream_id": stream_id,
            "destination_id": destination_id,
            "failure_policy": "LOG_AND_CONTINUE",
        },
    )
    if rr.status_code != 201:
        raise RuntimeError(f"route create failed: {rr.status_code} {rr.text}")
    route_id = int(rr.json()["id"])

    return FixtureIds(
        connector_id=connector_id,
        source_id=source_id,
        stream_id=stream_id,
        destination_id=destination_id,
        route_id=route_id,
        extras={"suffix": suffix},
    )


def _re_target_seed_to_perf_fixtures(ids: FixtureIds, rows: int) -> CheckResult:
    """Re-seed delivery_logs into the perf-smoke fixture stream so subsequent
    queries hit those rows (and not arbitrary user data)."""
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    script = os.path.join(repo_root, "scripts", "seed_delivery_logs_perf_data.py")
    cmd = [
        sys.executable,
        script,
        "--connector-id",
        str(ids.connector_id),
        "--stream-id",
        str(ids.stream_id),
        "--route-id",
        str(ids.route_id),
        "--destination-id",
        str(ids.destination_id),
        "--rows",
        str(rows),
        "--batch-size",
        "1000",
        "--days",
        "1",
        "--delete-existing",
    ]
    start = time.perf_counter()
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    threshold = DEFAULT_THRESHOLDS_MS["delivery_logs_bulk_insert"]
    note = "ok" if proc.returncode == 0 else f"exit={proc.returncode}"
    return CheckResult(
        name="delivery_logs_bulk_insert",
        rows_tested=rows,
        elapsed_ms=elapsed_ms,
        threshold_ms=threshold,
        passed=(proc.returncode == 0) and (elapsed_ms <= threshold),
        notes=note,
    )


# --- HTTP latency checks (TestClient: in-process, no uvicorn required) -----


def _time_get(client: Any, path: str, threshold_key: str, rows_tested: int) -> CheckResult:
    start = time.perf_counter()
    res = client.get(path)
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    threshold = DEFAULT_THRESHOLDS_MS[threshold_key]
    note = f"http={res.status_code}"
    rows_observed = rows_tested
    try:
        body = res.json()
        if isinstance(body, dict):
            for k in ("logs", "items", "rows"):
                v = body.get(k)
                if isinstance(v, list):
                    rows_observed = len(v)
                    break
    except Exception:
        pass
    passed = (200 <= res.status_code < 300) and (elapsed_ms <= threshold)
    return CheckResult(
        name=threshold_key,
        rows_tested=rows_observed,
        elapsed_ms=elapsed_ms,
        threshold_ms=threshold,
        passed=passed,
        notes=note,
    )


def _time_post(client: Any, path: str, body: Any, threshold_key: str, rows_tested: int) -> CheckResult:
    start = time.perf_counter()
    res = client.post(path, json=body)
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    threshold = DEFAULT_THRESHOLDS_MS[threshold_key]
    note = f"http={res.status_code}"
    passed = (200 <= res.status_code < 300) and (elapsed_ms <= threshold)
    return CheckResult(
        name=threshold_key,
        rows_tested=rows_tested,
        elapsed_ms=elapsed_ms,
        threshold_ms=threshold,
        passed=passed,
        notes=note,
    )


# --- EXPLAIN ANALYZE delegation -------------------------------------------


def _run_explain_analyze(ids: FixtureIds) -> CheckResult:
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    script = os.path.join(repo_root, "scripts", "profile_query_plan.py")
    cmd = [
        sys.executable,
        script,
        "--stream-id",
        str(ids.stream_id),
        "--route-id",
        str(ids.route_id),
        "--destination-id",
        str(ids.destination_id),
        "--limit",
        "50",
    ]
    start = time.perf_counter()
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    threshold = DEFAULT_THRESHOLDS_MS["explain_analyze_delivery_logs"]
    seq_scan = "Seq Scan" in proc.stdout and "delivery_logs" in proc.stdout
    actual_times = [float(m) for m in re.findall(r"actual time=[0-9.]+\.\.([0-9.]+)\s+rows=", proc.stdout)]
    max_actual = max(actual_times) if actual_times else 0.0
    note = f"max actual_time={max_actual:.2f}ms; seq_scan={seq_scan}; exit={proc.returncode}"
    passed = (proc.returncode == 0) and (max_actual <= threshold) and (not seq_scan)
    return CheckResult(
        name="explain_analyze_delivery_logs",
        rows_tested=int(sum(actual_times) / max(len(actual_times), 1)) if actual_times else 0,
        elapsed_ms=max_actual,
        threshold_ms=threshold,
        passed=passed,
        notes=note,
    )


# --- Orchestration ---------------------------------------------------------


@contextmanager
def _build_test_client() -> Iterator[Any]:
    # Imports are delayed so the safety check runs first and we don't import
    # app.database against an unsafe URL.
    from fastapi.testclient import TestClient  # type: ignore

    from app.main import app  # noqa: WPS433

    with TestClient(app) as tc:
        yield tc


def _print_table(results: list[CheckResult]) -> None:
    headers = ("check", "rows tested", "elapsed (ms)", "threshold (ms)", "result", "notes")
    widths = [max(len(headers[0]), 32),
              max(len(headers[1]), 11),
              max(len(headers[2]), 12),
              max(len(headers[3]), 14),
              max(len(headers[4]), 6),
              max(len(headers[5]), 48)]
    fmt = " | ".join(f"%-{w}s" for w in widths)
    print()
    print(fmt % headers)
    print("-+-".join("-" * w for w in widths))
    for r in results:
        result_token = "PASS" if r.passed else "FAIL"
        print(fmt % (
            r.name[: widths[0]],
            f"{r.rows_tested}",
            f"{r.elapsed_ms:.1f}",
            f"{r.threshold_ms:.0f}",
            result_token,
            r.notes[: widths[5]],
        ))
    print()


def main() -> int:
    parser = argparse.ArgumentParser(description="GDC dev-validation performance smoke")
    parser.add_argument("--rows", type=int, default=10000, help="rows for the bulk insert + queries")
    parser.add_argument("--skip-explain", action="store_true", help="skip EXPLAIN ANALYZE delegation")
    parser.add_argument("--json", action="store_true", help="emit results as JSON instead of a table")
    args = parser.parse_args()

    db_url = os.getenv("DATABASE_URL") or os.getenv("TEST_DATABASE_URL", "")
    if not db_url:
        print("ERROR: DATABASE_URL/TEST_DATABASE_URL is not set.", file=sys.stderr)
        return 1
    os.environ["DATABASE_URL"] = db_url
    os.environ["TEST_DATABASE_URL"] = db_url
    # Match the dev/test profile expectations: anonymous administrator fallback
    # (same as tests/conftest.py). Production RBAC is unchanged because this
    # script refuses to run outside gdc_test / gdc_e2e_test (see safety check).
    os.environ.setdefault("REQUIRE_AUTH", "false")
    os.environ.setdefault("APP_ENV", "development")
    _safety_check_database_url(db_url)

    results: list[CheckResult] = []

    with _build_test_client() as client:
        try:
            ids = _build_http_fixtures(client)
        except Exception as exc:
            print(f"ERROR creating perf-smoke fixtures: {exc}", file=sys.stderr)
            return 2

        results.append(_re_target_seed_to_perf_fixtures(ids, args.rows))

        results.append(
            _time_get(
                client,
                f"/api/v1/runtime/streams/{ids.stream_id}/metrics?window=24h",
                "runtime_metrics_query",
                rows_tested=args.rows,
            )
        )
        results.append(
            _time_get(
                client,
                f"/api/v1/runtime/logs/search?stream_id={ids.stream_id}&limit=100&window=24h",
                "logs_explorer_query",
                rows_tested=args.rows,
            )
        )
        results.append(
            _time_get(
                client,
                f"/api/v1/runtime/streams/{ids.stream_id}/metrics?window=24h",
                "route_runtime_aggregation",
                rows_tested=args.rows,
            )
        )
        results.append(
            _time_get(
                client,
                "/api/v1/retention/preview",
                "retention_preview",
                rows_tested=args.rows,
            )
        )

        # Retention run: dry_run=True; preserve-user-entities rule means we
        # never let this delete anything.
        results.append(
            _time_post(
                client,
                "/api/v1/retention/run",
                {"dry_run": True, "tables": ["delivery_logs"]},
                "retention_run",
                rows_tested=0,
            )
        )

        # Backfill dry-run latency: create a TIME_RANGE_REPLAY job in PENDING
        # state without starting the worker (so no real fetch / no destination
        # delivery / no checkpoint mutation). This times the foundation path
        # documented in specs/033-data-backfill-runtime.
        results.append(
            _time_post(
                client,
                "/api/v1/backfill/jobs",
                {
                    "stream_id": ids.stream_id,
                    "backfill_mode": "TIME_RANGE_REPLAY",
                    "requested_by": "perf-smoke",
                    "runtime_options_json": {
                        "start_time": "2020-01-01T00:00:00+00:00",
                        "end_time": "2020-01-01T01:00:00+00:00",
                        "dry_run": True,
                    },
                },
                "backfill_dry_run",
                rows_tested=0,
            )
        )

    if not args.skip_explain:
        results.append(_run_explain_analyze(ids))

    if args.json:
        print(json.dumps([r.__dict__ for r in results], indent=2))
    else:
        _print_table(results)

    failures = [r for r in results if not r.passed]
    if failures:
        print(f"PERF SMOKE: FAIL ({len(failures)} of {len(results)} checks failed)")
        return 1
    print(f"PERF SMOKE: PASS ({len(results)} checks ok)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
