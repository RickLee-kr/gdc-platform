#!/usr/bin/env python3
"""Parallel resume coordinator for Cross-Product recovery attempts.

Normal shards: up to N workers in parallel.
Fault shards: sequential (1 worker), never concurrent with Normal.
Only the coordinator mutates replacement-map / active pointers / attempt-status finalize.
Workers write only their own generation side-run artifacts.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))
from recovery_lib import (  # noqa: E402
    assert_finalize_allowed,
    build_generation_authority_baseline,
    build_parallel_dry_run_report,
    build_parallel_resume_plan,
    claim_next_shard_for_worker,
    coordinator_publish_and_activate,
    detect_cross_worker_contamination,
    evaluate_cleanup_preflight_gate,
    evaluate_parallel_load_gates,
    finalize_post_full_resume_success,
    finalize_side_run_generation,
    get_snapshot_shard,
    init_parallel_coordinator_state,
    load_parallel_coordinator_state,
    load_shard_plan_snapshot,
    quarantine_failed_replacement,
    read_json,
    reconcile_attempt_plan_for_pending_merge,
    record_worker_result,
    sample_cpu_percent,
    sample_existing_worker_process_count,
    sample_running_worker_streams,
    sample_load_average,
    sample_standalone_scheduler_healthy,
    update_attempt_status,
    utc_now,
    validate_replacement_artifact,
    write_json,
)


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--root", required=True, help="Repo root (worktree)")
    p.add_argument("--reports-root", required=True)
    p.add_argument("--run-id", required=True)
    p.add_argument("--attempt-dir", required=True)
    p.add_argument("--commit", required=True)
    p.add_argument("--harness", required=True)
    p.add_argument("--shards", required=True, help="Comma-separated shard ids")
    p.add_argument("--normal-workers", type=int, default=1)  # safe shared-Lab default; 4 needs isolated Lab
    p.add_argument("--fault-workers", type=int, default=1)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--skip-finalize", action="store_true",
                   help="Do not run full-resume finalize even if all shards pass")
    p.add_argument("--preflight-json", default="/tmp/xp-resume-preflight.json")
    return p.parse_args()


def _shard_meta(preflight: dict[str, Any], shard_id: str) -> dict[str, Any]:
    for s in preflight.get("shards") or []:
        if s.get("shard_id") == shard_id:
            return s
    raise KeyError(f"shard meta missing in preflight: {shard_id}")


def _run_worker_shard(
    *,
    root: Path,
    e2e: Path,
    reports_root: Path,
    run_id: str,
    attempt: str,
    attempt_dir: Path,
    shard_id: str,
    worker_id: str,
    commit: str,
    harness: str,
    ids_file: str,
    shard_plan_path: str,
    expected_count: int,
    valid_combos: str,
) -> dict[str, Any]:
    """Allocate + execute one shard. Does NOT publish or switch pointers."""
    worker_script = e2e / "cross-product" / "run-resume-shard-worker.sh"
    env = os.environ.copy()
    env.update(
        {
            "GDC_E2E_REPORTS_ROOT": str(reports_root),
            "GDC_XP_ROUTE_RUNTIME": "ROUTE_ON",
            "GDC_ROUTE_PROCESSING_ENABLED": "true",
            "GDC_XP_EXPECTED_HARNESS": harness,
            "GDC_XP_COMMIT": commit,
            "GDC_XP_VALID_COMBINATIONS_PATH": valid_combos,
            "GDC_XP_WORKER_ID": worker_id,
            "ROOT": str(root),
            "E2E": str(e2e),
            "REPORTS_ROOT": str(reports_root),
            "RUN_ID": run_id,
            "ATTEMPT": attempt,
            "ATTEMPT_DIR": str(attempt_dir),
            "SHARD": shard_id,
            "WORKER_ID": worker_id,
            "EXP_COMMIT": commit,
            "EXP_HV": harness,
            "IDS_FILE": ids_file,
            "SHARD_PLAN_RUNTIME": shard_plan_path,
            "EXP_COUNT": str(expected_count),
        }
    )
    # Clear residual filters
    env.pop("GDC_XP_COMBINATION_IDS", None)
    env.pop("GDC_XP_LIMIT", None)
    env.pop("GDC_XP_CONTINUE", None)

    result_path = attempt_dir / "workers" / worker_id / f"{shard_id}.result.json"
    result_path.parent.mkdir(parents=True, exist_ok=True)
    env["WORKER_RESULT_PATH"] = str(result_path)

    proc = subprocess.run(
        ["bash", str(worker_script)],
        cwd=str(root),
        env=env,
        capture_output=True,
        text=True,
    )
    out = {
        "ok": proc.returncode == 0,
        "rc": proc.returncode,
        "worker_id": worker_id,
        "shard": shard_id,
        "stdout_tail": (proc.stdout or "")[-4000:],
        "stderr_tail": (proc.stderr or "")[-4000:],
    }
    if result_path.is_file():
        try:
            out.update(json.loads(result_path.read_text()))
        except Exception as exc:
            out["result_parse_error"] = str(exc)
    return out


def _publish_worker_result(
    *,
    attempt_dir: Path,
    run_dir: Path,
    worker_out: dict[str, Any],
    commit: str,
    harness: str,
    attempt: str,
) -> dict[str, Any]:
    shard_id = worker_out["shard"]
    generation_id = worker_out.get("generation_id")
    src = Path(worker_out.get("art_dir") or "")
    side_dir = Path(worker_out.get("side_run_dir") or "")
    if not worker_out.get("ok"):
        if src.is_dir():
            quarantine_failed_replacement(
                src_dir=src,
                attempt_dir=attempt_dir,
                shard_id=shard_id,
                reason=f"worker_rc_{worker_out.get('rc')}",
            )
        if side_dir.is_dir() and generation_id:
            finalize_side_run_generation(
                side_run_dir=side_dir,
                attempt_dir=attempt_dir,
                shard_id=shard_id,
                generation_id=generation_id,
                status="FAILED",
                reason=f"worker_rc_{worker_out.get('rc')}",
            )
        return {"ok": False, "reason": "WORKER_EXEC_FAILED", "worker": worker_out}

    snapshot = load_shard_plan_snapshot(attempt_dir)
    snap_shard = get_snapshot_shard(snapshot, shard_id)
    expected = int(snap_shard["expected_count"])
    ids = list(snap_shard["combination_ids"])
    validation = validate_replacement_artifact(
        art_dir=src,
        shard_id=shard_id,
        expected_count=expected,
        expected_harness=harness,
        expected_commit=commit,
        expected_ids=ids,
        expected_generation_id=generation_id,
        expected_attempt=attempt,
        side_run_dir=side_dir,
    )
    write_json(attempt_dir / f"validate-{shard_id}.json", validation)
    if not validation.get("ok"):
        if src.is_dir():
            quarantine_failed_replacement(
                src_dir=src,
                attempt_dir=attempt_dir,
                shard_id=shard_id,
                reason=validation.get("reason") or "FAILED_REPLACEMENT_VALIDATION",
            )
        finalize_side_run_generation(
            side_run_dir=side_dir,
            attempt_dir=attempt_dir,
            shard_id=shard_id,
            generation_id=generation_id,
            status="FAILED",
            reason=validation.get("reason"),
        )
        return {"ok": False, "reason": validation.get("reason"), "validation": validation}

    pub = coordinator_publish_and_activate(
        src_dir=src,
        attempt_dir=attempt_dir,
        shard_id=shard_id,
        generation_id=generation_id,
        commit=commit,
        harness_version=harness,
        validation=validation,
        merge_eligible=False,
        original_path=str(run_dir / f"{shard_id}-ROUTE_ON"),
    )
    write_json(attempt_dir / f"publish-{shard_id}.json", pub)
    if not pub.get("ok"):
        finalize_side_run_generation(
            side_run_dir=side_dir,
            attempt_dir=attempt_dir,
            shard_id=shard_id,
            generation_id=generation_id,
            status="FAILED",
            reason=pub.get("reason"),
        )
        return {"ok": False, "reason": pub.get("reason"), "publish": pub}

    # Annotate side_run / worker on map entry (coordinator holds lock inside publish).
    rep_path = attempt_dir / "replacement-map.json"
    rep_map = read_json(rep_path, {}) or {}
    entry = dict(rep_map.get(shard_id) or {})
    entry["side_run_id"] = worker_out.get("side_run_id")
    entry["generation_id"] = generation_id
    entry["worker_id"] = worker_out.get("worker_id")
    entry["merge_eligible"] = False
    rep_map[shard_id] = entry
    write_json(rep_path, rep_map)

    # Pending-merge replacements must leave reuse/rerun so later shard resumes
    # are not blocked by PLAN_INCONSISTENT (merge_eligible=false + reuse).
    reconcile_attempt_plan_for_pending_merge(attempt_dir)

    build_generation_authority_baseline(side_run_dir=side_dir, art_dir=src)
    finalize_side_run_generation(
        side_run_dir=side_dir,
        attempt_dir=attempt_dir,
        shard_id=shard_id,
        generation_id=generation_id,
        status="COMPLETE",
        validation=validation,
        publish=pub,
    )
    return {
        "ok": True,
        "shard": shard_id,
        "validation": validation,
        "publish": pub,
        "generation_id": generation_id,
        "worker_id": worker_out.get("worker_id"),
        "executed": validation.get("executed"),
        "unique": validation.get("unique"),
        "PASS": validation.get("PASS") or validation.get("pass_count"),
        "FAIL": validation.get("FAIL") or validation.get("fail_count"),
        "duplicate": validation.get("duplicate"),
    }


def _drain_queue(
    *,
    queue: str,
    max_workers: int,
    args: argparse.Namespace,
    root: Path,
    e2e: Path,
    attempt_dir: Path,
    run_dir: Path,
    preflight: dict[str, Any],
    worker_results: list[dict[str, Any]],
) -> bool:
    """Run one queue to completion. Returns False on failure (stops new assignment)."""
    attempt = Path(args.attempt_dir).name
    pending_key = "pending_normal" if queue == "normal" else "pending_fault"
    prefix = "worker" if queue == "normal" else "fault-worker"

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {}
        worker_slots = [f"{prefix}-{i}" for i in range(1, max_workers + 1)]
        # Prefer short numeric ids in side-run paths: worker-1 → keep as-is for claim map,
        # but allocate with worker_id=str(i) via env rewrite in worker script.
        free = list(worker_slots)

        def _try_schedule() -> bool:
            nonlocal free
            state = load_parallel_coordinator_state(attempt_dir)
            if state.get("assignment_stopped"):
                return False
            if not (state.get(pending_key) or []):
                return False
            if not free:
                return False
            cpu = sample_cpu_percent()
            load_average = sample_load_average()
            gate = evaluate_parallel_load_gates(
                cpu_percent=cpu,
                load_average=load_average,
                load_average_threshold=float(
                    os.environ.get("GDC_XP_LOAD_AVERAGE_THRESHOLD", str(max(1, (os.cpu_count() or 1) * 2)))
                ),
                db_pool_exhausted=os.environ.get("GDC_XP_DB_POOL_EXHAUSTED", "false").lower()
                in {"1", "true", "yes"},
                connectors_p95_sec=float(os.environ["GDC_XP_CONNECTORS_P95_SEC"])
                if os.environ.get("GDC_XP_CONNECTORS_P95_SEC")
                else None,
                api_timeout=os.environ.get("GDC_XP_API_TIMEOUT", "false").lower() in {"1", "true", "yes"},
                api_5xx_count=int(os.environ.get("GDC_XP_API_5XX_COUNT", "0")),
                api_5xx_rate=float(os.environ.get("GDC_XP_API_5XX_RATE", "0")),
                collector_backlog_rising=os.environ.get("GDC_XP_COLLECTOR_BACKLOG_RISING", "false").lower()
                in {"1", "true", "yes"},
            )
            if gate.get("pause_new_workers"):
                print(json.dumps({"event": "LOAD_GATE_PAUSE", "gate": gate}))
                return True  # keep waiting; do not fail yet

            # Stagger new worker starts to avoid Lab stampede (attempt-015).
            stagger_sec = float(os.environ.get("GDC_XP_PARALLEL_STAGGER_SEC", "45"))
            running_now = load_parallel_coordinator_state(attempt_dir).get("running") or {}
            if running_now and stagger_sec > 0:
                latest = max(
                    (str(v.get("started_at") or "") for v in running_now.values()),
                    default="",
                )
                if latest:
                    try:
                        from datetime import datetime, timezone
                        started = datetime.strptime(latest, "%Y-%m-%dT%H:%M:%SZ").replace(
                            tzinfo=timezone.utc
                        )
                        elapsed = (datetime.now(timezone.utc) - started).total_seconds()
                        if elapsed < stagger_sec:
                            print(json.dumps({
                                "event": "STAGGER_WAIT",
                                "elapsed": elapsed,
                                "stagger_sec": stagger_sec,
                                "running": list(running_now.keys()),
                            }))
                            return True
                    except Exception:
                        pass

            wid = free.pop(0)
            claim = claim_next_shard_for_worker(
                attempt_dir=attempt_dir,
                worker_id=wid,
                queue=queue,
                pid=os.getpid(),
                load_gate=gate,
            )
            if not claim.get("ok"):
                free.append(wid)
                reason = claim.get("reason")
                if reason in {
                    "QUEUE_EMPTY",
                    "LOAD_GATE_PAUSE",
                    "FAULT_BLOCKED_WHILE_NORMAL_RUNNING",
                    "FAULT_BLOCKED_WHILE_NORMAL_ACTIVE",
                    "NORMAL_BLOCKED_WHILE_FAULT_RUNNING",
                    "NORMAL_BLOCKED_WHILE_FAULT_ACTIVE",
                    "ASSIGNMENT_STOPPED",
                }:
                    return reason not in {"ASSIGNMENT_STOPPED"}
                print(json.dumps({"event": "CLAIM_FAIL", "claim": claim}))
                return False

            shard_id = claim["shard"]
            meta = _shard_meta(preflight, shard_id)
            print(json.dumps({
                "event": "WORKER_START",
                "worker_id": wid,
                "shard": shard_id,
                "queue": queue,
            }))
            fut = pool.submit(
                _run_worker_shard,
                root=root,
                e2e=e2e,
                reports_root=Path(args.reports_root),
                run_id=args.run_id,
                attempt=attempt,
                attempt_dir=attempt_dir,
                shard_id=shard_id,
                worker_id=wid,
                commit=args.commit,
                harness=args.harness,
                ids_file=meta["ids_file"],
                shard_plan_path=meta["shard_plan_path"],
                expected_count=int(meta["expected_count"]),
                valid_combos=str(preflight.get("valid_combinations_path") or ""),
            )
            futures[fut] = {"worker_id": wid, "shard": shard_id}
            return True

        # Prime workers
        for _ in range(max_workers):
            if not _try_schedule():
                break

        success = True
        idle_rounds = 0
        while futures or (
            success
            and not (load_parallel_coordinator_state(attempt_dir).get("assignment_stopped"))
            and (load_parallel_coordinator_state(attempt_dir).get(pending_key) or [])
        ):
            if not futures:
                # Pending work remains but no in-flight workers (load gate / transient).
                scheduled = _try_schedule()
                if not scheduled:
                    idle_rounds += 1
                    time.sleep(min(5.0, 0.5 * idle_rounds))
                    if idle_rounds > 120:
                        print(json.dumps({
                            "event": "SCHEDULE_STALL",
                            "queue": queue,
                            "pending": load_parallel_coordinator_state(attempt_dir).get(pending_key),
                        }))
                        success = False
                        break
                    continue
                idle_rounds = 0
                continue
            idle_rounds = 0
            done, _ = wait(futures.keys(), return_when=FIRST_COMPLETED, timeout=30)
            if not done:
                # timeout: try scheduling more if slots free
                _try_schedule()
                continue
            for fut in done:
                meta = futures.pop(fut)
                wid = meta["worker_id"]
                shard_id = meta["shard"]
                try:
                    worker_out = fut.result()
                except Exception as exc:
                    worker_out = {
                        "ok": False,
                        "worker_id": wid,
                        "shard": shard_id,
                        "error": str(exc),
                    }
                worker_results.append(worker_out)
                # Coordinator serial publish
                pub = _publish_worker_result(
                    attempt_dir=attempt_dir,
                    run_dir=run_dir,
                    worker_out=worker_out,
                    commit=args.commit,
                    harness=args.harness,
                    attempt=attempt,
                )
                status = "COMPLETE" if pub.get("ok") else "FAILED"
                record_worker_result(
                    attempt_dir=attempt_dir,
                    worker_id=wid,
                    shard_id=shard_id,
                    status=status,
                    generation_id=worker_out.get("generation_id"),
                    detail={"publish": pub, "worker_ok": worker_out.get("ok")},
                    stop_assignment_on_failure=True,
                )
                print(json.dumps({
                    "event": "WORKER_DONE",
                    "worker_id": wid,
                    "shard": shard_id,
                    "status": status,
                    "ok": pub.get("ok"),
                    "reason": pub.get("reason"),
                    "executed": (pub.get("validation") or {}).get("executed") or pub.get("executed"),
                }))
                free.append(wid)
                if not pub.get("ok"):
                    success = False
                    # Stop scheduling new workers; wait for in-flight to finish.
                    continue
                update_attempt_status(
                    attempt_dir,
                    status="RESUME_RUNNING",
                    phase="RESUME_RUNNING",
                    current_shard=shard_id,
                    completed_shards=len((load_parallel_coordinator_state(attempt_dir).get("completed") or {})),
                    resumable=True,
                )
            if success:
                _try_schedule()
            # else: do not schedule new; drain in-flight

        return success


def main() -> int:
    args = _parse_args()
    root = Path(args.root)
    e2e = root / "e2e"
    attempt_dir = Path(args.attempt_dir)
    run_dir = attempt_dir.parent
    shards = [s.strip() for s in args.shards.split(",") if s.strip()]
    preflight = read_json(Path(args.preflight_json), {}) or {}

    parallel_plan = build_parallel_resume_plan(
        shards,
        normal_workers=args.normal_workers,
        fault_workers=args.fault_workers,
        allow_fault_with_normal=False,
    )
    if not parallel_plan.get("ok"):
        print(json.dumps({"ok": False, "reason": "PARALLEL_PLAN_INVALID", "plan": parallel_plan}))
        return 2

    plan_doc = read_json(attempt_dir / "recovery-plan.json", {}) or {}
    if args.dry_run:
        report = build_parallel_dry_run_report(
            plan=plan_doc,
            parallel_plan=parallel_plan,
            selected_combinations=int(preflight.get("selected_combinations") or 0),
        )
        write_json(attempt_dir / "parallel-dry-run.json", report)
        print(json.dumps(report, indent=2))
        return 0 if report.get("ok") else 2

    running_streams = sample_running_worker_streams()
    standalone_env = os.environ.get("GDC_XP_STANDALONE_SCHEDULER_HEALTHY")
    if standalone_env is None:
        standalone_healthy = sample_standalone_scheduler_healthy()
    else:
        standalone_healthy = standalone_env.lower() in {"1", "true", "yes"}
    cleanup_gate = evaluate_cleanup_preflight_gate(
        existing_worker_process_count=sample_existing_worker_process_count(),
        running_worker_streams=running_streams,
        stale_lock_count=int(os.environ.get("GDC_XP_STALE_LOCK_COUNT", "0")),
        orphan_task_count=int(os.environ.get("GDC_XP_ORPHAN_TASK_COUNT", "0")),
        collector_backlog=int(os.environ.get("GDC_XP_COLLECTOR_BACKLOG", "0")),
        collector_backlog_rising=os.environ.get("GDC_XP_COLLECTOR_BACKLOG_RISING", "false").lower()
        in {"1", "true", "yes"},
        api_health_pass=os.environ.get("GDC_XP_API_HEALTH_PASS", "true").lower() in {"1", "true", "yes"},
        db_pool_ok=os.environ.get("GDC_XP_DB_POOL_OK", "true").lower() in {"1", "true", "yes"},
        connectors_post_latency_sec=float(os.environ.get("GDC_XP_CONNECTORS_POST_LATENCY_SEC", "0")),
        delivery_logs_connector_id_index_exists=os.environ.get(
            "GDC_XP_DELIVERY_LOGS_CONNECTOR_ID_INDEX_EXISTS", "true"
        ).lower()
        in {"1", "true", "yes"},
        standalone_scheduler_healthy=standalone_healthy,
    )
    if not cleanup_gate.get("ok"):
        print(json.dumps({"ok": False, "reason": "CLEANUP_PREFLIGHT_FAILED", "gate": cleanup_gate}, indent=2))
        return 2

    state = init_parallel_coordinator_state(
        attempt_dir=attempt_dir,
        shards=shards,
        normal_workers=args.normal_workers,
        fault_workers=args.fault_workers,
    )
    update_attempt_status(
        attempt_dir,
        status="PARALLEL_RESUME_RUNNING",
        phase="PARALLEL_RESUME_RUNNING",
        expected_shards=len(shards),
        started_at=utc_now(),
        parallel_normal_workers=args.normal_workers,
        parallel_fault_workers=args.fault_workers,
    )

    worker_results: list[dict[str, Any]] = []
    ok = True
    if state.get("pending_normal"):
        ok = _drain_queue(
            queue="normal",
            max_workers=args.normal_workers,
            args=args,
            root=root,
            e2e=e2e,
            attempt_dir=attempt_dir,
            run_dir=run_dir,
            preflight=preflight,
            worker_results=worker_results,
        ) and ok
    if ok and state.get("pending_fault") is not None:
        # Reload — pending_fault still in state file
        st = load_parallel_coordinator_state(attempt_dir)
        if st.get("pending_fault"):
            ok = _drain_queue(
                queue="fault",
                max_workers=args.fault_workers,
                args=args,
                root=root,
                e2e=e2e,
                attempt_dir=attempt_dir,
                run_dir=run_dir,
                preflight=preflight,
                worker_results=worker_results,
            ) and ok

    contamination = detect_cross_worker_contamination(worker_results=worker_results)
    write_json(attempt_dir / "parallel-contamination-report.json", contamination)
    if not contamination.get("ok"):
        ok = False

    final_state = load_parallel_coordinator_state(attempt_dir)
    summary = {
        "ok": ok and contamination.get("ok"),
        "completed": list((final_state.get("completed") or {}).keys()),
        "failed": list((final_state.get("failed") or {}).keys()),
        "cross_worker_contamination": contamination.get("cross_worker_contamination"),
        "shards_executed": final_state.get("shards_executed"),
        "pointer_changed": final_state.get("pointer_changed"),
        "normal_workers": args.normal_workers,
        "fault_workers": args.fault_workers,
    }
    write_json(attempt_dir / "parallel-resume-summary.json", summary)
    print(json.dumps(summary, indent=2))

    if not ok:
        update_attempt_status(
            attempt_dir,
            status="PARALLEL_RESUME_FAILED",
            phase="PARALLEL_RESUME_FAILED",
            ended_at=utc_now(),
            resumable=True,
            final_verdict="PARALLEL_RESUME_FAILED",
        )
        return 1

    if args.skip_finalize:
        fin_gate = assert_finalize_allowed(attempt_dir)
        write_json(attempt_dir / "parallel-finalize-gate.json", fin_gate)
        update_attempt_status(
            attempt_dir,
            status="PARALLEL_SHARDS_COMPLETE",
            phase="PARALLEL_SHARDS_COMPLETE",
            ended_at=utc_now(),
            resumable=True,
            final_verdict="PARALLEL_SHARDS_COMPLETE",
            finalize_skipped=True,
        )
        return 0

    fin_gate = assert_finalize_allowed(attempt_dir)
    if not fin_gate.get("ok"):
        print(json.dumps({"ok": False, "reason": "FINALIZE_BLOCKED", "gate": fin_gate}))
        return 1

    fin = finalize_post_full_resume_success(
        attempt_dir=attempt_dir,
        expected_harness=args.harness,
        expected_commit=args.commit,
        shard_ids=None,
    )
    write_json(attempt_dir / "finalize-full-resume.json", fin)
    if not fin.get("ok"):
        update_attempt_status(
            attempt_dir,
            status="FAILED_POST_FULL_RESUME_FINALIZE",
            phase="FAILED_POST_FULL_RESUME_FINALIZE",
            abort_reason=fin.get("reason"),
            ended_at=utc_now(),
            resumable=True,
            final_verdict="FAILED_POST_FULL_RESUME_FINALIZE",
        )
        return 1
    print("final_verdict=FULL_RESUME_PASS — READY_FOR_FINAL_MERGE_VALIDATION")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
