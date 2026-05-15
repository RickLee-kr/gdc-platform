from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass

from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError


@dataclass
class PlanAnalysis:
    estimated_cost: str | None
    actual_time_ms: float | None
    actual_time_range: str | None
    rows: int | None
    rows_removed: int | None
    loops: int | None
    scan_type: str | None
    index_name_used: str | None
    buffers_hit: int | None
    buffers_read: int | None
    cache_state: str
    cache_reason: str | None
    warnings: list[str]
    infos: list[str]
    recommendation: str


def _build_queries() -> dict[str, str]:
    explain_prefix = "EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)"
    return {
        "CHECKPOINT QUERY PLAN": (
            f"{explain_prefix} "
            "SELECT * FROM checkpoints WHERE stream_id = :stream_id"
        ),
        "ROUTES QUERY PLAN": (
            f"{explain_prefix} "
            "SELECT * FROM routes "
            "WHERE stream_id = :stream_id AND enabled = true"
        ),
        "DELIVERY_LOGS BY STREAM QUERY PLAN": (
            f"{explain_prefix} "
            "SELECT * FROM delivery_logs "
            "WHERE stream_id = :stream_id "
            "ORDER BY created_at DESC "
            "LIMIT :limit"
        ),
        "DELIVERY_LOGS BY ROUTE QUERY PLAN": (
            f"{explain_prefix} "
            "SELECT * FROM delivery_logs "
            "WHERE route_id = :route_id "
            "ORDER BY created_at DESC "
            "LIMIT :limit"
        ),
        "DELIVERY_LOGS BY DESTINATION QUERY PLAN": (
            f"{explain_prefix} "
            "SELECT * FROM delivery_logs "
            "WHERE destination_id = :destination_id "
            "ORDER BY created_at DESC "
            "LIMIT :limit"
        ),
    }


def _extract_plan_text(rows: list[object]) -> str:
    lines: list[str] = []
    for row in rows:
        if isinstance(row, tuple) and row:
            lines.append(str(row[0]))
        else:
            lines.append(str(row))
    return "\n".join(lines)


def _parse_scan_info(plan_text: str) -> tuple[str | None, str | None]:
    scan_pattern = re.compile(
        r"(Seq Scan|Index Scan(?: Backward)?|Index Only Scan|Bitmap Heap Scan|Bitmap Index Scan)"
        r"(?: using ([a-zA-Z0-9_]+))?",
        re.IGNORECASE,
    )
    match = scan_pattern.search(plan_text)
    if not match:
        return None, None
    scan_type = match.group(1)
    index_name = match.group(2) if match.group(2) else None
    return scan_type, index_name


def _analyze_plan(
    plan_text: str,
    expected_index: str,
    slow_ms_threshold: float,
    high_rows_removed_threshold: int,
    high_buffers_read_threshold: int,
) -> PlanAnalysis:
    warnings: list[str] = []
    infos: list[str] = []
    estimated_cost: str | None = None
    actual_time_ms: float | None = None
    actual_time_range: str | None = None
    rows: int | None = None
    rows_removed: int | None = None
    loops: int | None = None
    scan_type: str | None = None
    index_name_used: str | None = None
    buffers_hit: int | None = None
    buffers_read: int | None = None
    cache_state = "warm"
    cache_reason: str | None = None
    high_actual_time = False

    cost_match = re.search(r"cost=([0-9.]+)\.\.([0-9.]+)", plan_text)
    if cost_match:
        estimated_cost = f"{cost_match.group(1)}..{cost_match.group(2)}"

    actual_match = re.search(
        r"actual time=([0-9.]+)\.\.([0-9.]+)\s+rows=([0-9]+)\s+loops=([0-9]+)",
        plan_text,
    )
    if actual_match:
        actual_time_ms = float(actual_match.group(2))
        actual_time_range = f"{actual_match.group(1)}..{actual_match.group(2)}"
        rows = int(actual_match.group(3))
        loops = int(actual_match.group(4))
        high_actual_time = actual_time_ms > slow_ms_threshold

    scan_type, index_name_used = _parse_scan_info(plan_text)
    if scan_type and scan_type.lower().startswith("seq scan"):
        warnings.append("Seq Scan detected")

    buffers_match = re.search(r"Buffers:\s*([^\n]+)", plan_text)
    if buffers_match:
        details = buffers_match.group(1)
        hit_match = re.search(r"hit=([0-9]+)", details)
        read_match = re.search(r"read=([0-9]+)", details)
        if hit_match or read_match:
            buffers_hit = int(hit_match.group(1)) if hit_match else 0
            buffers_read = int(read_match.group(1)) if read_match else 0
            if buffers_read > 0 and buffers_hit <= buffers_read:
                cache_state = "cold"
                cache_reason = (
                    "High latency due to disk read (cold cache), not index inefficiency"
                )
            if buffers_read > high_buffers_read_threshold:
                warnings.append(
                    (
                        "High shared buffers read: "
                        f"{buffers_read} exceeds threshold {high_buffers_read_threshold}"
                    )
                )

    if high_actual_time and actual_time_ms is not None:
        if buffers_read is not None and buffers_read > 0:
            cache_state = "cold"
            if cache_reason is None:
                cache_reason = (
                    "High latency due to disk read (cold cache), not index inefficiency"
                )
            infos.append(
                (
                    "Cold cache detected: high actual time "
                    f"{actual_time_ms:.3f} ms with buffers read={buffers_read}"
                )
            )
        else:
            warnings.append(
                (
                    "High actual time: "
                    f"{actual_time_ms:.3f} ms exceeds threshold {slow_ms_threshold:.3f} ms"
                )
            )

    removed_match = re.search(r"Rows Removed by Filter:\s*([0-9]+)", plan_text)
    if removed_match:
        rows_removed = int(removed_match.group(1))
        if rows_removed > high_rows_removed_threshold:
            warnings.append(
                (
                    "High rows removed by filter: "
                    f"{rows_removed} exceeds threshold {high_rows_removed_threshold}"
                )
            )

    if expected_index not in plan_text:
        warnings.append(f"Expected index not used: {expected_index}")

    if high_actual_time and buffers_read is not None and buffers_read > 0:
        recommendation = (
            "No additional index recommended; cold cache read observed in this run"
        )
    elif warnings:
        recommendation = "Potential index candidate: " + " | ".join(warnings[:3])
    else:
        recommendation = "No additional index recommended"
    return PlanAnalysis(
        estimated_cost=estimated_cost,
        actual_time_ms=actual_time_ms,
        actual_time_range=actual_time_range,
        rows=rows,
        rows_removed=rows_removed,
        loops=loops,
        scan_type=scan_type,
        index_name_used=index_name_used,
        buffers_hit=buffers_hit,
        buffers_read=buffers_read,
        cache_state=cache_state,
        cache_reason=cache_reason,
        warnings=warnings,
        infos=infos,
        recommendation=recommendation,
    )


def _print_plan(
    title: str,
    sql: str,
    params: dict[str, int],
    rows: list[object],
    *,
    expected_index: str | None,
    slow_ms_threshold: float,
    high_rows_removed_threshold: int,
    high_buffers_read_threshold: int,
    recommendations: list[str],
) -> None:
    print(f"===== {title} =====")
    print(f"QUERY NAME: {title}")
    print("SQL:")
    print(sql)
    print("PARAMETERS:")
    print(params)
    print("RAW EXPLAIN ANALYZE OUTPUT:")
    if not rows:
        print("(no rows)")
    else:
        for row in rows:
            print(row)
    plan_text = _extract_plan_text(rows)

    if expected_index is not None:
        analysis = _analyze_plan(
            plan_text=plan_text,
            expected_index=expected_index,
            slow_ms_threshold=slow_ms_threshold,
            high_rows_removed_threshold=high_rows_removed_threshold,
            high_buffers_read_threshold=high_buffers_read_threshold,
        )
        preferred_index_used = expected_index in plan_text
        warning_lines: list[str] = []
        recommendation_line = analysis.recommendation
        route_reason: str | None = None
        fallback_index_accepted: bool | None = None

        if title == "ROUTES QUERY PLAN":
            has_stream_index_cond = bool(
                re.search(r"Index Cond:\s*\(routes\.stream_id\s*=", plan_text)
            )
            is_index_scan = (analysis.scan_type or "").lower() == "index scan"
            actual_time_low = (
                analysis.actual_time_ms is None
                or analysis.actual_time_ms <= slow_ms_threshold
            )
            buffers_read_low = (
                analysis.buffers_read is None
                or analysis.buffers_read <= high_buffers_read_threshold
            )
            rows_removed_low = (
                analysis.rows_removed is None
                or analysis.rows_removed <= high_rows_removed_threshold
            )
            is_expected_fallback_index = (
                analysis.index_name_used == "uq_routes_stream_destination"
            )
            fallback_index_accepted = (
                (not preferred_index_used)
                and is_index_scan
                and has_stream_index_cond
                and actual_time_low
                and buffers_read_low
                and rows_removed_low
                and is_expected_fallback_index
            )
            route_reason = (
                "PostgreSQL planner selected `uq_routes_stream_destination` because it can "
                "satisfy stream_id lookup and current plan is cheap. enabled is applied as "
                "a filter. no immediate index change is recommended unless rows removed / "
                "buffers read / actual time grows."
            )

            # Keep preferred-index mismatch visible with severity.
            if not preferred_index_used:
                if fallback_index_accepted:
                    warning_lines.append(
                        "INFO: preferred index not used but healthy fallback used "
                        "(uq_routes_stream_destination)"
                    )
                    recommendation_line = (
                        "No additional index recommended; planner used acceptable fallback index"
                    )
                else:
                    warning_lines.append(
                        "WARNING: preferred index not used and fallback plan is unhealthy"
                    )
                    if any(
                        [
                            not actual_time_low,
                            not buffers_read_low,
                            not rows_removed_low,
                            not has_stream_index_cond,
                            not is_index_scan,
                        ]
                    ):
                        recommendation_line = (
                            "Potential index candidate: preferred index not used and query "
                            "evidence shows high rows removed / high buffers read / high actual time"
                        )
                    for warning in analysis.warnings:
                        if warning != f"Expected index not used: {expected_index}":
                            warning_lines.append(f"WARNING: {warning}")
            else:
                recommendation_line = "No additional index recommended"
                for warning in analysis.warnings:
                    warning_lines.append(f"WARNING: {warning}")
        else:
            recommendation_line = analysis.recommendation
            for warning in analysis.warnings:
                warning_lines.append(f"WARNING: {warning}")

        print("SUMMARY:")
        print(f"- expected index: {expected_index}")
        print(
            "- expected index used: "
            + ("yes" if preferred_index_used else "no")
        )
        print(f"- estimated cost: {analysis.estimated_cost or 'n/a'}")
        print(
            "- actual time: "
            + (f"{analysis.actual_time_range} ms" if analysis.actual_time_range else "n/a")
        )
        print(f"- rows: {analysis.rows if analysis.rows is not None else 'n/a'}")
        print(
            "- rows removed by filter: "
            + (str(analysis.rows_removed) if analysis.rows_removed is not None else "n/a")
        )
        print(f"- loops: {analysis.loops if analysis.loops is not None else 'n/a'}")
        print(f"- scan type: {analysis.scan_type or 'n/a'}")
        print(f"- index name used: {analysis.index_name_used or 'n/a'}")
        print(f"- cache state: {analysis.cache_state}")
        print(f"- reason: {analysis.cache_reason or 'n/a'}")
        if title == "ROUTES QUERY PLAN":
            print("- preferred index: idx_routes_stream_enabled")
            print(f"- actual index used: {analysis.index_name_used or 'n/a'}")
            print(
                "- fallback index accepted: "
                + (
                    "yes"
                    if fallback_index_accepted is True
                    else "no"
                )
            )
            print(f"- reason: {route_reason}")
        print(
            "- buffers hit/read: "
            + (
                f"{analysis.buffers_hit}/{analysis.buffers_read}"
                if analysis.buffers_hit is not None and analysis.buffers_read is not None
                else "n/a"
            )
        )
        print("WARNING SUMMARY:")
        for info in analysis.infos:
            warning_lines.append(f"INFO: {info}")
        if warning_lines:
            for warning in warning_lines:
                print(f"- {warning}")
                if warning.startswith("WARNING:"):
                    recommendations.append(f"{title}: {warning}")
        else:
            print("- none")
        print("RECOMMENDATION SUMMARY:")
        print(f"- {recommendation_line}")
    print("")


def main() -> int:
    parser = argparse.ArgumentParser(description="Profile query plans for key runtime queries.")
    parser.add_argument("--stream-id", type=int, default=1)
    parser.add_argument("--route-id", type=int, default=1)
    parser.add_argument("--destination-id", type=int, default=1)
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--slow-ms-threshold", type=float, default=50.0)
    parser.add_argument("--high-rows-removed-threshold", type=int, default=1000)
    parser.add_argument("--high-buffers-read-threshold", type=int, default=100)
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL", "postgresql://gdc:gdc@127.0.0.1:55432/gdc_test")
    engine = create_engine(database_url)

    try:
        with engine.connect() as conn:
            dialect_name = conn.dialect.name
            if dialect_name != "postgresql":
                print(
                    f"[ERROR] PostgreSQL DATABASE_URL is required, current dialect: {dialect_name}",
                    file=sys.stderr,
                )
                return 1
            queries = _build_queries()
            params = {
                "stream_id": args.stream_id,
                "route_id": args.route_id,
                "destination_id": args.destination_id,
                "limit": args.limit,
            }
            expected_indexes = {
                "CHECKPOINT QUERY PLAN": "uq_checkpoints_stream_id",
                "ROUTES QUERY PLAN": "idx_routes_stream_enabled",
                "DELIVERY_LOGS BY STREAM QUERY PLAN": "idx_logs_stream_id_created_at",
                "DELIVERY_LOGS BY ROUTE QUERY PLAN": "idx_logs_route_id_created_at",
                "DELIVERY_LOGS BY DESTINATION QUERY PLAN": "idx_logs_destination_id_created_at",
            }
            recommendations: list[str] = []

            print("===== DB DIALECT =====")
            print(dialect_name)
            print("")
            print("===== EXECUTION PROCEDURE =====")
            print("1) docker compose -f docker-compose.test.yml --profile test up -d postgres-test")
            print("2) export DATABASE_URL=postgresql://gdc:gdc@127.0.0.1:55432/gdc_test")
            print("3) venv/bin/alembic upgrade head")
            print("4) venv/bin/python -m app.db.seed")
            print(
                "5) venv/bin/python scripts/profile_query_plan.py "
                "--stream-id 1 --route-id 1 --destination-id 1 --limit 50"
            )
            print("")

            for title, sql in queries.items():
                query_params = {
                    "stream_id": params["stream_id"],
                    "route_id": params["route_id"],
                    "destination_id": params["destination_id"],
                    "limit": params["limit"],
                }
                rows = conn.execute(text(sql), query_params).fetchall()
                _print_plan(
                    title,
                    sql,
                    query_params,
                    rows,
                    expected_index=expected_indexes.get(title),
                    slow_ms_threshold=args.slow_ms_threshold,
                    high_rows_removed_threshold=args.high_rows_removed_threshold,
                    high_buffers_read_threshold=args.high_buffers_read_threshold,
                    recommendations=recommendations,
                )

            print("===== RECOMMENDATION =====")
            if recommendations:
                print(
                    "Potential index candidate: "
                    + "; ".join(recommendations[:3])
                )
            else:
                print("No additional index recommended")
        return 0
    except SQLAlchemyError as exc:
        print(f"[ERROR] Query plan profiling failed: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # pragma: no cover
        print(f"[ERROR] Unexpected failure: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
