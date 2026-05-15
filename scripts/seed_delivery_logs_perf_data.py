from __future__ import annotations

import argparse
import os
import random
import sys
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from psycopg2.extras import Json, execute_values


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Seed bulk delivery_logs profiling data (PostgreSQL only)."
    )
    parser.add_argument("--stream-id", type=int, default=1)
    parser.add_argument("--route-id", type=int, default=1)
    parser.add_argument("--destination-id", type=int, default=1)
    parser.add_argument("--connector-id", type=int, default=1)
    parser.add_argument("--rows", type=int, default=100000)
    parser.add_argument("--batch-size", type=int, default=5000)
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--delete-existing", action="store_true")
    return parser


def _build_row_tuple(
    *,
    idx: int,
    now_utc: datetime,
    days: int,
    stream_id: int,
    route_id: int,
    destination_id: int,
    connector_id: int,
    rng: random.Random,
) -> tuple[object, ...]:
    stages = [
        "source_fetch",
        "mapping",
        "enrichment",
        "format",
        "route",
        "syslog_send",
        "webhook_send",
        "checkpoint_update",
    ]
    levels = ["INFO", "WARNING", "ERROR"]
    statuses = ["SUCCESS", "FAILED", "RETRYING", "SKIPPED"]
    error_codes = [
        None,
        None,
        "DESTINATION_CONNECTION_FAILED",
        "DESTINATION_TIMEOUT",
        "WEBHOOK_HTTP_500",
        "SOURCE_RATE_LIMITED",
    ]
    http_statuses = [None, None, 200, 202, 429, 500, 503]

    max_seconds = max(days, 1) * 24 * 60 * 60
    age_seconds = rng.randint(0, max_seconds - 1)
    created_at = now_utc - timedelta(seconds=age_seconds)

    stage = stages[idx % len(stages)]
    level = levels[idx % len(levels)]
    status = statuses[idx % len(statuses)]
    latency_ms = rng.randint(2, 2000)
    http_status = http_statuses[idx % len(http_statuses)]
    error_code = error_codes[idx % len(error_codes)]

    return (
        connector_id,
        stream_id,
        route_id,
        destination_id,
        stage,
        level,
        status,
        (
            f"[perf-seed] {stage} {status.lower()} "
            f"for stream={stream_id}, route={route_id}, destination={destination_id}"
        ),
        Json(
            {
                "event_id": f"perf-{idx}",
                "source": "seed_delivery_logs_perf_data",
                "stream_id": stream_id,
                "route_id": route_id,
                "destination_id": destination_id,
            }
        ),
        rng.randint(0, 3),
        http_status,
        latency_ms,
        error_code,
        created_at,
    )


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()

    if args.rows < 0:
        print("[ERROR] --rows must be >= 0", file=sys.stderr)
        return 1
    if args.batch_size <= 0:
        print("[ERROR] --batch-size must be > 0", file=sys.stderr)
        return 1
    if args.days <= 0:
        print("[ERROR] --days must be > 0", file=sys.stderr)
        return 1

    database_url = os.getenv("DATABASE_URL", "postgresql://gdc:gdc@127.0.0.1:55432/gdc_test")
    engine = create_engine(database_url)

    insert_sql = """
        INSERT INTO delivery_logs (
            connector_id,
            stream_id,
            route_id,
            destination_id,
            stage,
            level,
            status,
            message,
            payload_sample,
            retry_count,
            http_status,
            latency_ms,
            error_code,
            created_at
        ) VALUES %s
    """
    delete_stmt = text(
        """
        DELETE FROM delivery_logs
        WHERE stream_id = :stream_id
          AND route_id = :route_id
          AND destination_id = :destination_id
        """
    )

    started = time.perf_counter()
    inserted_total = 0
    rng = random.Random(42)
    now_utc = datetime.now(timezone.utc)

    try:
        with engine.begin() as conn:
            dialect_name = conn.dialect.name
            print("===== DB DIALECT =====")
            print(dialect_name)
            print("")
            if dialect_name != "postgresql":
                print(
                    f"[ERROR] PostgreSQL DATABASE_URL is required, current dialect: {dialect_name}",
                    file=sys.stderr,
                )
                return 1

            print("===== TARGET =====")
            print(
                f"stream_id={args.stream_id}, route_id={args.route_id}, "
                f"destination_id={args.destination_id}, connector_id={args.connector_id}"
            )
            print(f"rows requested={args.rows}, batch_size={args.batch_size}, days={args.days}")
            print(f"delete_existing={args.delete_existing}")
            print("")

            if args.delete_existing:
                deleted = conn.execute(
                    delete_stmt,
                    {
                        "stream_id": args.stream_id,
                        "route_id": args.route_id,
                        "destination_id": args.destination_id,
                    },
                ).rowcount
                print(f"deleted rows (target only): {deleted}")

            for start_idx in range(0, args.rows, args.batch_size):
                end_idx = min(start_idx + args.batch_size, args.rows)
                batch_rows = [
                    _build_row_tuple(
                        idx=i,
                        now_utc=now_utc,
                        days=args.days,
                        stream_id=args.stream_id,
                        route_id=args.route_id,
                        destination_id=args.destination_id,
                        connector_id=args.connector_id,
                        rng=rng,
                    )
                    for i in range(start_idx, end_idx)
                ]
                if batch_rows:
                    raw_conn = conn.connection.driver_connection
                    with raw_conn.cursor() as cur:
                        execute_values(
                            cur,
                            insert_sql,
                            batch_rows,
                            page_size=args.batch_size,
                        )
                    inserted_total += len(batch_rows)
                    elapsed_now = time.perf_counter() - started
                    rows_per_sec = inserted_total / elapsed_now if elapsed_now > 0 else 0.0
                    print(
                        "[progress] "
                        f"inserted={inserted_total}/{args.rows} "
                        f"elapsed={elapsed_now:.3f}s "
                        f"rows/sec={rows_per_sec:.1f}"
                    )

        elapsed = time.perf_counter() - started
        rows_per_sec = inserted_total / elapsed if elapsed > 0 else 0.0
        print(f"inserted rows={inserted_total}")
        print(f"elapsed seconds={elapsed:.3f}")
        print(f"rows/sec={rows_per_sec:.1f}")
        print("")
        print("===== VALIDATION PROCEDURE =====")
        print("1) docker compose -f docker-compose.test.yml --profile test up -d postgres-test")
        print("2) export DATABASE_URL=postgresql://gdc:gdc@127.0.0.1:55432/gdc_test")
        print("3) venv/bin/alembic upgrade head")
        print("4) venv/bin/python -m app.db.seed")
        print("5) venv/bin/python scripts/seed_delivery_logs_perf_data.py --rows 100000 --delete-existing")
        print("6) venv/bin/python scripts/profile_query_plan.py --stream-id 1 --route-id 1 --destination-id 1 --limit 50")
        print("")
        print("NEXT COMMAND:")
        print(
            "venv/bin/python scripts/profile_query_plan.py "
            "--stream-id 1 --route-id 1 --destination-id 1 --limit 50"
        )
        return 0
    except SQLAlchemyError as exc:
        print(f"[ERROR] Bulk seed failed: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # pragma: no cover
        print(f"[ERROR] Unexpected failure: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
