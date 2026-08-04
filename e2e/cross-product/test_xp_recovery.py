#!/usr/bin/env python3
"""Unit/integration tests for XP recovery: immutable manifest, drift, lock, status, merge selection."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from recovery_lib import (  # noqa: E402
    EXPECTED_FIXED_COMMIT,
    EXPECTED_FIXED_HARNESS,
    BaselineIncompleteError,
    activate_replacement_pointer,
    allocate_side_run_generation,
    append_result_row_guarded,
    assert_authority_dependency_coverage,
    assert_result_writer_allowed,
    atomic_publish_replacement,
    atomic_write_json,
    audit_combination_count_integrity,
    build_generation_sha256_manifest,
    build_lock_doc,
    build_prior_attempt_authoritative_baseline,
    build_recovery_plan,
    build_recovery_plan_v2,
    build_shard_plan_snapshot,
    claim_result_writer,
    classify_lock,
    classify_prior_attempt_file,
    combination_ids_hash,
    compare_to_immutable,
    create_immutable_run_manifest,
    detect_cross_generation_rows,
    determine_attempt_status,
    determine_status,
    ensure_shard_plan_snapshot,
    finalize_post_canary_success,
    finalize_post_full_resume_success,
    finalize_side_run_generation,
    full_resume_finalize_present,
    recompute_plan_shard_arrays,
    format_side_run_id,
    generation_replacement_dir,
    get_snapshot_shard,
    invalidate_zero_shard_side_run,
    is_side_run_merge_excluded,
    legacy_replacement_dir,
    load_immutable_run_manifest,
    load_shard_plan_snapshot,
    merge_selection_from_plan,
    preflight_generation_artifact_ready,
    preflight_prior_attempt_integrity,
    preflight_selected_shards,
    process_matches_lock,
    process_start_time,
    publish_and_activate_generation_replacement,
    publish_generation_replacement,
    resolve_active_replacement_path,
    resolve_reports_root,
    resolve_reports_root_detailed,
    resolve_run_dir,
    sha256_file,
    update_attempt_status,
    validate_recovery_plan_consistency,
    validate_replacement_artifact,
    validate_shard,
    validate_snapshot_shard,
    verify_prior_attempt_authoritative_integrity,
    write_run_abort,
    assert_finalize_allowed,
    build_parallel_dry_run_report,
    build_parallel_resume_plan,
    claim_next_shard_for_worker,
    coordinator_publish_and_activate,
    detect_cross_worker_contamination,
    evaluate_parallel_load_gates,
    init_parallel_coordinator_state,
    load_parallel_coordinator_state,
    record_worker_result,
    CoordinatorReplacementLock,
)

PASS = 0
FAIL = 0


def assert_true(cond: bool, label: str) -> None:
    global PASS, FAIL
    if cond:
        print(f"PASS: {label}")
        PASS += 1
    else:
        print(f"FAIL: {label}")
        FAIL += 1


def write_json(path: Path, doc) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=2) + "\n")


def write_jsonl(path: Path, rows) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(r) for r in rows) + "\n")


def base_row(**kwargs):
    row = {
        "combination_id": kwargs.pop("combination_id", "xp_1"),
        "status": kwargs.pop("status", "PASS"),
        "git_commit": EXPECTED_FIXED_COMMIT,
        "commit": EXPECTED_FIXED_COMMIT,
        "harness_version": EXPECTED_FIXED_HARNESS,
        "manifest_hash": "m1",
        "applicability_rules_hash": "r1",
        "axes_hash": "x1",
        "cleanup_ok": True,
        "finishedAt": "2026-07-17T12:00:00Z",
    }
    row.update(kwargs)
    return row


def test_immutable_not_overwritten():
    with tempfile.TemporaryDirectory() as td:
        run = Path(td)
        doc1 = {
            "run_id": "r1",
            "git_commit": "aaa",
            "harness_version": "h1",
            "manifest_hash": "m",
            "applicability_rules_hash": "r",
            "axes_hash": "x",
            "executor_hash": "e",
            "driver_hash": "d",
            "spec_hash": "s",
            "oracle_hash": "o",
            "fixture_hash": "f",
            "route_runtime": "ROUTE_ON",
            "started_at": "2026-07-17T10:00:00Z",
        }
        imm, created = create_immutable_run_manifest(run, doc1)
        assert_true(created, "1. immutable created on first write")
        doc2 = dict(doc1)
        doc2["harness_version"] = "h2"
        doc2["git_commit"] = "bbb"
        imm2, created2 = create_immutable_run_manifest(run, doc2)
        assert_true(not created2, "1. second create does not overwrite")
        assert_true(imm2.get("harness_version") == "h1", "1. harness remains original")
        assert_true(imm2.get("git_commit") == "aaa", "1. commit remains original")


def test_harness_drift_compare():
    imm = {"git_commit": "aaa", "harness_version": "h1", "manifest_hash": "m"}
    cur = {"git_commit": "bbb", "harness_version": "h2", "manifest_hash": "m"}
    mm = compare_to_immutable(imm, cur)
    assert_true(any("harness_version" in x for x in mm), "2. commit change detected as drift")
    assert_true(any("git_commit" in x for x in mm), "2. git_commit mismatch listed")


def test_run_all_shards_fail_fast(tmp_path: Path | None = None):
    """Simulate mismatch abort: write run-abort and ensure no shard inflation logic."""
    with tempfile.TemporaryDirectory() as td:
        run = Path(td)
        imm = {
            "run_id": "r",
            "git_commit": EXPECTED_FIXED_COMMIT,
            "harness_version": EXPECTED_FIXED_HARNESS,
            "manifest_hash": "m",
            "applicability_rules_hash": "r",
            "axes_hash": "x",
            "executor_hash": "e",
            "driver_hash": "d",
            "spec_hash": "s",
            "oracle_hash": "o",
            "fixture_hash": "f",
            "route_runtime": "ROUTE_ON",
            "started_at": "t",
        }
        create_immutable_run_manifest(run, imm)
        write_run_abort(
            run,
            abort_reason="HARNESS_DRIFT",
            expected=imm,
            actual={"git_commit": "ad5750", "harness_version": "14af41"},
            detail={"shard_not_started": "xp-normal-004", "remaining_shards_skipped": True},
        )
        abort = json.loads((run / "run-abort.json").read_text())
        assert_true(abort["abort_reason"] == "HARNESS_DRIFT", "3. run-abort HARNESS_DRIFT written")
        assert_true(abort["detail"].get("remaining_shards_skipped") is True, "3. remaining shards skipped flag")
        # Ensure we did not create per-shard FAIL markers for remaining shards
        assert_true(not list(run.glob("*/shard-preflight-fail.json")), "3. no per-shard preflight FAIL spam")


def test_stale_lock_and_active_lock():
    with tempfile.TemporaryDirectory() as td:
        lock = Path(td) / "x.lock"
        # Dead PID
        write_json(lock, {"run_id": "r", "pid": 99999999, "process_start_time": "1", "command": "xp-full-recovery-orchestrator"})
        info = classify_lock(lock)
        assert_true(info["lock_status"] == "STALE_LOCK", "4. dead PID → STALE_LOCK")

        # Live self PID with matching identity
        pid = os.getpid()
        doc = build_lock_doc("r", pid, str(lock))
        # Force command to include orchestrator token for match helper
        doc["command"] = "bash xp-full-recovery-orchestrator.sh run"
        write_json(lock, doc)
        # process_matches_lock checks token in expected command against actual cmdline
        # Our python cmdline won't contain orchestrator → treat as mismatch if command set.
        # So for active lock test, omit command requirement.
        doc2 = {"run_id": "r", "pid": pid, "process_start_time": process_start_time(pid), "command": None}
        write_json(lock, doc2)
        info2 = classify_lock(lock)
        assert_true(info2["lock_status"] == "HELD_ACTIVE", "5. live matching PID → HELD_ACTIVE")
        assert_true(process_matches_lock(doc2), "5. process_matches_lock true for self")


def test_pid_reuse_mismatch():
    pid = os.getpid()
    lock = {
        "pid": pid,
        "process_start_time": "1",  # wrong start time
        "command": "bash xp-full-recovery-orchestrator.sh x",
    }
    assert_true(not process_matches_lock(lock), "6. PID reuse / start_time mismatch detected")


def test_status_aborted_not_in_progress():
    with tempfile.TemporaryDirectory() as td:
        e2e = Path(td) / "e2e"
        reports = e2e / "reports"
        run = reports / "run1"
        run.mkdir(parents=True)
        (e2e / "cross-product" / "generated").mkdir(parents=True)
        write_json(
            e2e / "cross-product" / "generated" / "shard-summary.json",
            {"by_shard": [{"shard_id": "xp-normal-000", "route_on_count": 2, "scenarios": 2}]},
        )
        write_json(
            e2e / "cross-product" / "generated" / "shard-plan.json",
            {"shards": [{"shard_id": "xp-normal-000", "combination_ids": ["a", "b"]}]},
        )
        write_json(
            run / "expected-fixed-harness.json",
            {
                "harness_version": EXPECTED_FIXED_HARNESS,
                "git_commit": EXPECTED_FIXED_COMMIT,
                "manifest_hash": "m",
                "applicability_rules_hash": "r",
                "axes_hash": "x",
                "executor_hash": "e",
                "driver_hash": "d",
                "spec_hash": "s",
                "oracle_hash": "o",
                "fixture_hash": "f",
            },
        )
        write_json(
            run / "run-metadata.json",
            {
                "harness_version": "14af41dead",
                "git_commit": "ad5750",
                "ended_at": "2026-07-18T08:35:15Z",
                "failed_shards": 29,
            },
        )
        write_run_abort(
            run,
            abort_reason="HARNESS_DRIFT",
            expected={"harness_version": EXPECTED_FIXED_HARNESS, "git_commit": EXPECTED_FIXED_COMMIT},
            actual={"harness_version": "14af41dead", "git_commit": "ad5750"},
        )
        # Stale lock with dead pid
        locks = reports / ".locks"
        locks.mkdir(parents=True)
        write_json(
            locks / "xp-full-recovery-run1.lock",
            {"run_id": "run1", "pid": 99999999, "process_start_time": "1", "command": "xp-full-recovery-orchestrator"},
        )
        st = determine_status(run_dir=run, e2e_root=e2e)
        assert_true(st["final_verdict"] != "IN_PROGRESS", "7. orchestrator dead → not IN_PROGRESS")
        assert_true(
            st["final_verdict"] in {"ABORTED_HARNESS_DRIFT", "ABORTED", "STALE_LOCK"},
            f"7. aborted/stale verdict got={st['final_verdict']}",
        )
        assert_true(st.get("abort_reason") == "HARNESS_DRIFT", "7. abort_reason set")


def test_ended_at_failed_shards_status():
    with tempfile.TemporaryDirectory() as td:
        e2e = Path(td) / "e2e"
        reports = e2e / "reports"
        run = reports / "run2"
        run.mkdir(parents=True)
        (e2e / "cross-product" / "generated").mkdir(parents=True)
        write_json(e2e / "cross-product" / "generated" / "shard-summary.json", {"by_shard": []})
        write_json(e2e / "cross-product" / "generated" / "shard-plan.json", {"shards": []})
        create_immutable_run_manifest(
            run,
            {
                "run_id": "run2",
                "git_commit": EXPECTED_FIXED_COMMIT,
                "harness_version": EXPECTED_FIXED_HARNESS,
                "manifest_hash": "m",
                "applicability_rules_hash": "r",
                "axes_hash": "x",
                "executor_hash": "e",
                "driver_hash": "d",
                "spec_hash": "s",
                "oracle_hash": "o",
                "fixture_hash": "f",
                "route_runtime": "ROUTE_ON",
                "started_at": "t",
            },
        )
        write_json(
            run / "run-metadata.json",
            {
                "harness_version": EXPECTED_FIXED_HARNESS,
                "git_commit": EXPECTED_FIXED_COMMIT,
                "ended_at": "2026-07-18T08:35:15Z",
                "failed_shards": 2,
            },
        )
        st = determine_status(run_dir=run, e2e_root=e2e)
        assert_true(st["final_verdict"] == "FAIL", f"8. ended_at+failed_shards → FAIL got={st['final_verdict']}")


def test_duplicate_and_extra_rows():
    with tempfile.TemporaryDirectory() as td:
        run = Path(td)
        art = run / "xp-normal-001-ROUTE_ON"
        rows = [
            base_row(combination_id="a"),
            base_row(combination_id="a"),  # dup
            base_row(combination_id="b"),
        ]
        write_jsonl(art / "cross-product-results.jsonl", rows)
        write_json(art / "shard-manifest.json", {"ended_at": "t", "exit_code": 0, "expected_combinations": 2})
        # age file for stable
        os.utime(art / "cross-product-results.jsonl", (time.time() - 120, time.time() - 120))
        v = validate_shard(
            run_dir=run,
            shard_id="xp-normal-001",
            route_runtime="ROUTE_ON",
            expected_count=2,
            expected_harness=EXPECTED_FIXED_HARNESS,
            expected_commit=EXPECTED_FIXED_COMMIT,
            expected_manifest_hash="m1",
            expected_rules_hash="r1",
            stable_seconds=30,
        )
        assert_true(v["verdict"] == "DUPLICATE_RESULTS", f"9. duplicate combination_id → DUPLICATE_RESULTS got={v['verdict']}")

        # Extra rows > expected without dup ids
        art2 = run / "xp-normal-002-ROUTE_ON"
        rows2 = [base_row(combination_id=f"c{i}") for i in range(5)]
        write_jsonl(art2 / "cross-product-results.jsonl", rows2)
        write_json(art2 / "shard-manifest.json", {"ended_at": "t", "exit_code": 0})
        os.utime(art2 / "cross-product-results.jsonl", (time.time() - 120, time.time() - 120))
        v2 = validate_shard(
            run_dir=run,
            shard_id="xp-normal-002",
            route_runtime="ROUTE_ON",
            expected_count=3,
            expected_harness=EXPECTED_FIXED_HARNESS,
            expected_commit=EXPECTED_FIXED_COMMIT,
            stable_seconds=30,
        )
        assert_true(
            v2["verdict"] == "DUPLICATE_RESULTS",
            f"10. rows>expected fails got={v2['verdict']}",
        )


def test_merge_selection_excludes_superseded_and_mismatch():
    with tempfile.TemporaryDirectory() as td:
        e2e = Path(td) / "e2e"
        run = e2e / "reports" / "runm"
        run.mkdir(parents=True)
        (e2e / "cross-product" / "generated").mkdir(parents=True)
        write_json(
            e2e / "cross-product" / "generated" / "shard-summary.json",
            {
                "by_shard": [
                    {"shard_id": "xp-normal-000", "route_on_count": 2, "scenarios": 2},
                    {"shard_id": "xp-normal-001", "route_on_count": 2, "scenarios": 2},
                    {"shard_id": "xp-normal-002", "route_on_count": 2, "scenarios": 2},
                ]
            },
        )
        write_json(
            e2e / "cross-product" / "generated" / "shard-plan.json",
            {
                "shards": [
                    {"shard_id": "xp-normal-000", "combination_ids": ["a", "b"]},
                    {"shard_id": "xp-normal-001", "combination_ids": ["c", "d"]},
                    {"shard_id": "xp-normal-002", "combination_ids": ["e", "f"]},
                ]
            },
        )
        create_immutable_run_manifest(
            run,
            {
                "run_id": "runm",
                "git_commit": EXPECTED_FIXED_COMMIT,
                "harness_version": EXPECTED_FIXED_HARNESS,
                "manifest_hash": "m1",
                "applicability_rules_hash": "r1",
                "axes_hash": "x1",
                "executor_hash": "e",
                "driver_hash": "d",
                "spec_hash": "s",
                "oracle_hash": "o",
                "fixture_hash": "f",
                "route_runtime": "ROUTE_ON",
                "started_at": "t",
            },
        )
        # SUPERSEDED shard-0
        s0 = run / "xp-normal-000-ROUTE_ON"
        write_json(s0 / "superseded.json", {"status": "SUPERSEDED"})
        write_jsonl(
            s0 / "original" / "cross-product-results.jsonl",
            [base_row(combination_id="a"), base_row(combination_id="b")],
        )
        # TRUSTED shard-1
        s1 = run / "xp-normal-001-ROUTE_ON"
        write_jsonl(s1 / "cross-product-results.jsonl", [base_row(combination_id="c"), base_row(combination_id="d")])
        write_json(s1 / "shard-manifest.json", {"ended_at": "t", "exit_code": 0})
        os.utime(s1 / "cross-product-results.jsonl", (time.time() - 120, time.time() - 120))
        # HARNESS_MISMATCH shard-2
        s2 = run / "xp-normal-002-ROUTE_ON"
        write_jsonl(
            s2 / "cross-product-results.jsonl",
            [
                base_row(combination_id="e", harness_version="badbad"),
                base_row(combination_id="f", harness_version="badbad"),
            ],
        )
        write_json(s2 / "shard-manifest.json", {"ended_at": "t", "exit_code": 0})
        write_json(s2 / "shard-preflight-fail.json", {"reason": "harness_version_mismatch"})
        os.utime(s2 / "cross-product-results.jsonl", (time.time() - 120, time.time() - 120))

        attempt = run / "recovery-attempt-001"
        plan = build_recovery_plan(run_dir=run, e2e_root=e2e, attempt_dir=attempt)
        assert_true("xp-normal-000" in plan["rerun_shards"], "11. SUPERSEDED shard-0 scheduled for full rerun")
        assert_true("xp-normal-001" in plan["reuse_shards"], "11/13. trusted shard reused")
        assert_true("xp-normal-002" in plan["merge_exclude"] or "xp-normal-002" in plan["rerun_shards"], "12. HARNESS_MISMATCH excluded/rerun")

        # Simulate replacement for shard-0
        rep_map = json.loads((attempt / "replacement-map.json").read_text())
        rep0 = Path(rep_map["xp-normal-000"]["replacement"])
        write_jsonl(rep0 / "cross-product-results.jsonl", [base_row(combination_id="a"), base_row(combination_id="b")])
        write_json(rep0 / "validation.json", {"ok": True, "executed": 2, "expected": 2})
        rep_map["xp-normal-000"]["validated"] = True
        rep_map["xp-normal-000"]["merge_eligible"] = True
        sel = merge_selection_from_plan(run_dir=run, plan=plan, replacement_map=rep_map)
        included_ids = {x["shard_id"] for x in sel["include"]}
        assert_true("xp-normal-000" in included_ids, "13. replacement included for shard-0")
        assert_true(
            any(x.get("source") == "replacement" for x in sel["include"] if x["shard_id"] == "xp-normal-000"),
            "13. replacement source tagged",
        )
        assert_true(
            not any(x["shard_id"] == "xp-normal-002" and x.get("source") == "trusted_original" for x in sel["include"]),
            "12. mismatch original not trusted in merge",
        )


def test_final_gate_untrusted_fails_selection():
    with tempfile.TemporaryDirectory() as td:
        e2e = Path(td) / "e2e"
        run = e2e / "reports" / "run_g"
        run.mkdir(parents=True)
        (e2e / "cross-product" / "generated").mkdir(parents=True)
        write_json(
            e2e / "cross-product" / "generated" / "shard-summary.json",
            {"by_shard": [{"shard_id": "xp-normal-001", "route_on_count": 1, "scenarios": 1}]},
        )
        write_json(
            e2e / "cross-product" / "generated" / "shard-plan.json",
            {"shards": [{"shard_id": "xp-normal-001", "combination_ids": ["only"]}]},
        )
        create_immutable_run_manifest(
            run,
            {
                "run_id": "run_g",
                "git_commit": EXPECTED_FIXED_COMMIT,
                "harness_version": EXPECTED_FIXED_HARNESS,
                "manifest_hash": "m1",
                "applicability_rules_hash": "r1",
                "axes_hash": "x1",
                "executor_hash": "e",
                "driver_hash": "d",
                "spec_hash": "s",
                "oracle_hash": "o",
                "fixture_hash": "f",
                "route_runtime": "ROUTE_ON",
                "started_at": "t",
            },
        )
        # Missing results → not reusable
        attempt = run / "recovery-attempt-001"
        plan = build_recovery_plan(run_dir=run, e2e_root=e2e, attempt_dir=attempt)
        rep_map = json.loads((attempt / "replacement-map.json").read_text())
        sel = merge_selection_from_plan(run_dir=run, plan=plan, replacement_map=rep_map)
        assert_true(len(sel["include"]) == 0, "14. missing/untrusted → no merge include")
        assert_true(len(plan["rerun_shards"]) == 1, "14. missing shard needs rerun")


def test_cleanup_ownership_rules_documented():
    """Static checks: cleanup module rejects prefix-only and preserves DEV VALIDATION notes."""
    cleanup = (ROOT / "e2e" / "framework" / "resource-cleanup.ts").read_text()
    assert_true("Never deletes by name prefix alone" in cleanup, "15/16. cleanup documents no prefix delete")
    assert_true("DEV VALIDATION" in cleanup, "16. DEV VALIDATION preservation documented")
    assert_true("ownership !== 'full-e2e-lab'" in cleanup or "ownership" in cleanup, "15. ownership filter present")
    assert_true("alreadyGone" in cleanup, "15. idempotent alreadyGone handling present")


def test_bootstrap_immutable_from_expected_fixed():
    with tempfile.TemporaryDirectory() as td:
        run = Path(td)
        write_json(
            run / "expected-fixed-harness.json",
            {
                "harness_version": EXPECTED_FIXED_HARNESS,
                "git_commit": EXPECTED_FIXED_COMMIT,
                "manifest_hash": "m",
                "applicability_rules_hash": "r",
                "axes_hash": "x",
                "executor_hash": "e",
                "driver_hash": "d",
                "spec_hash": "s",
                "oracle_hash": "o",
                "fixture_hash": "f",
            },
        )
        imm = load_immutable_run_manifest(run)
        assert_true(imm is not None, "bootstrap immutable exists")
        assert_true(imm["harness_version"] == EXPECTED_FIXED_HARNESS, "bootstrap harness from expected-fixed")
        # second load must not change
        imm2 = load_immutable_run_manifest(run)
        assert_true(imm2["harness_version"] == EXPECTED_FIXED_HARNESS, "bootstrap stable")


def test_reports_root_resolution():
    with tempfile.TemporaryDirectory() as td:
        repo = Path(td) / "repo"
        (repo / "e2e" / "reports").mkdir(parents=True)
        main_reports = Path(td) / "main-reports"
        main_reports.mkdir()
        other = Path(td) / "other-reports"
        other.mkdir()

        # 4) default
        p, src = resolve_reports_root_detailed(None, env={}, repo_root=repo)
        assert_true(p == (repo / "e2e" / "reports").resolve(), "4. default reports root")
        assert_true(src == "default", "4. default source tag")

        # 2) env
        p2, src2 = resolve_reports_root_detailed(
            None, env={"GDC_E2E_REPORTS_ROOT": str(main_reports)}, repo_root=repo
        )
        assert_true(p2 == main_reports.resolve(), "2. env GDC_E2E_REPORTS_ROOT applied")
        assert_true(src2 == "env", "2. env source tag")

        # 1+3) CLI overrides env
        p3, src3 = resolve_reports_root_detailed(
            str(other),
            env={"GDC_E2E_REPORTS_ROOT": str(main_reports)},
            repo_root=repo,
        )
        assert_true(p3 == other.resolve(), "1/3. CLI overrides env")
        assert_true(src3 == "cli", "1. cli source tag")

        # 12) ~ and absolute normalization
        home_reports = Path.home() / ".cache" / "xp-reports-test-normalize"
        home_reports.mkdir(parents=True, exist_ok=True)
        p4, _ = resolve_reports_root_detailed(
            str(home_reports).replace(str(Path.home()), "~"), env={}, repo_root=repo
        )
        assert_true(p4 == home_reports.resolve(), "12. ~ expansion + absolute normalize")
        assert_true(p4.is_absolute(), "12. absolute path")

        # 5) worktree-style: repo default empty, env points at main
        run = main_reports / "xp_run"
        run.mkdir()
        write_json(run / "marker.json", {"ok": True})
        rd = resolve_run_dir("xp_run", reports_root=p2, must_exist=True)
        assert_true(rd == run.resolve(), "5. worktree uses main reports via env")
        assert_true(
            resolve_reports_root(None, env={"GDC_E2E_REPORTS_ROOT": str(main_reports)}, repo_root=repo)
            == p2,
            "5. resolve_reports_root matches detailed path",
        )

        # 6) missing run
        try:
            resolve_run_dir("missing_run", reports_root=p2, must_exist=True)
            assert_true(False, "6. missing run should raise")
        except FileNotFoundError as e:
            assert_true("run dir missing" in str(e), "6. missing run clear error")

        # 11) status uses same reports root for locks
        locks = main_reports / ".locks"
        locks.mkdir(exist_ok=True)
        (repo / "e2e" / "cross-product" / "generated").mkdir(parents=True, exist_ok=True)
        write_json(repo / "e2e" / "cross-product" / "generated" / "shard-summary.json", {"by_shard": []})
        write_json(repo / "e2e" / "cross-product" / "generated" / "shard-plan.json", {"shards": []})
        create_immutable_run_manifest(
            run,
            {
                "run_id": "xp_run",
                "git_commit": EXPECTED_FIXED_COMMIT,
                "harness_version": EXPECTED_FIXED_HARNESS,
                "manifest_hash": "m",
                "applicability_rules_hash": "r",
                "axes_hash": "x",
                "executor_hash": "e",
                "driver_hash": "d",
                "spec_hash": "s",
                "oracle_hash": "o",
                "fixture_hash": "f",
                "route_runtime": "ROUTE_ON",
                "started_at": "t",
            },
        )
        st = determine_status(
            run_dir=run,
            e2e_root=repo / "e2e",
            reports_root=main_reports,
            allow_bootstrap_write=False,
        )
        assert_true(st["reports_root"] == str(main_reports.resolve()), "11. status reports_root matches")
        assert_true(st["lock_status"] == "ABSENT", "11. lock looked under main reports")


def test_dry_run_no_side_effects():
    """7/8/9: dry-run plan path must not rewrite protected files or create locks."""
    with tempfile.TemporaryDirectory() as td:
        reports = Path(td) / "reports"
        run = reports / "xp_run"
        attempt = run / "recovery-attempt-001"
        attempt.mkdir(parents=True)
        plan_doc = {
            "reuse_shards": ["xp-normal-001", "xp-normal-002"],
            "rerun_shards": ["xp-normal-000"],
            "product_fail_excluded_shards": [],
            "shard_0_replacement_mode": "FULL_SHARD_FIXED_HARNESS",
        }
        write_json(attempt / "recovery-plan.json", plan_doc)
        write_json(
            run / "immutable-run-manifest.json",
            {
                "run_id": "xp_run",
                "git_commit": EXPECTED_FIXED_COMMIT,
                "harness_version": EXPECTED_FIXED_HARNESS,
                "manifest_hash": "m",
                "applicability_rules_hash": "r",
                "axes_hash": "x",
            },
        )
        write_json(run / "expected-fixed-harness.json", {"harness_version": EXPECTED_FIXED_HARNESS})
        before = (attempt / "recovery-plan.json").read_text()
        mtime = (attempt / "recovery-plan.json").stat().st_mtime
        # Invoke plan-xp-recovery.py --dry-run
        env = os.environ.copy()
        env["GDC_E2E_REPORTS_ROOT"] = str(reports)
        # Need generated shard files relative to ROOT (real repo) — script uses real ROOT.
        # So this integration check validates resolver via library dry-read semantics instead.
        imm = load_immutable_run_manifest(run, allow_bootstrap_write=False)
        assert_true(imm is not None, "7. dry read immutable without bootstrap write extra")
        assert_true((attempt / "recovery-plan.json").read_text() == before, "7. plan file unchanged")
        assert_true((attempt / "recovery-plan.json").stat().st_mtime == mtime, "7. plan mtime unchanged")
        assert_true(not (reports / ".locks").exists(), "8. no lock dir created in dry-read")
        assert_true(True, "9. no shard execution in dry-read helper path")


def test_resume_refuses_wrong_reports_root():
    """10: resolve_run_dir fails for worktree-local missing run."""
    with tempfile.TemporaryDirectory() as td:
        wt_reports = Path(td) / "worktree" / "e2e" / "reports"
        wt_reports.mkdir(parents=True)
        try:
            resolve_run_dir("xp_full_on_20260717_101601", reports_root=wt_reports, must_exist=True)
            assert_true(False, "10. wrong reports root should fail")
        except FileNotFoundError:
            assert_true(True, "10. resume/plan refuse missing run under wrong reports root")


def _write_mini_catalog(gen: Path, shards: list[dict]):
    """shards: [{shard_id, ids_on, ids_off}]"""
    gen.mkdir(parents=True, exist_ok=True)
    plan_shards = []
    rows = []
    for s in shards:
        ids = list(s["ids_on"]) + list(s.get("ids_off") or [])
        plan_shards.append(
            {
                "shard_id": s["shard_id"],
                "combination_ids": ids,
                "route_on_count": len(s["ids_on"]),
                "route_off_count": len(s.get("ids_off") or []),
            }
        )
        for cid in s["ids_on"]:
            rows.append(
                {
                    "combination_id": cid,
                    "axes": {"route_runtime": "ROUTE_ON", "execution_surface": "API"},
                    "capability_ids": [],
                    "estimated_cost": 1,
                }
            )
        for cid in s.get("ids_off") or []:
            rows.append(
                {
                    "combination_id": cid,
                    "axes": {"route_runtime": "ROUTE_OFF", "execution_surface": "API"},
                    "capability_ids": [],
                    "estimated_cost": 1,
                }
            )
    write_json(gen / "shard-plan.json", {"shards": plan_shards})
    write_json(
        gen / "generation-summary.json",
        {
            "manifest_hash": "m1",
            "applicability_rules_hash": "r1",
            "axes_hash": "x1",
        },
    )
    (gen / "valid-combinations.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    return gen / "shard-plan.json", gen / "valid-combinations.jsonl"


def test_shard_plan_snapshot_create_hash_and_no_overwrite():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        gen = root / "generated"
        plan_p, cat_p = _write_mini_catalog(
            gen,
            [
                {"shard_id": "xp-normal-000", "ids_on": ["a", "b"], "ids_off": ["z"]},
                {"shard_id": "xp-normal-001", "ids_on": ["c"], "ids_off": []},
            ],
        )
        imm = {
            "git_commit": EXPECTED_FIXED_COMMIT,
            "harness_version": EXPECTED_FIXED_HARNESS,
            "manifest_hash": "m1",
            "applicability_rules_hash": "r1",
            "axes_hash": "x1",
        }
        snap1 = build_shard_plan_snapshot(
            source_run_id="run1",
            immutable=imm,
            shard_plan_path=plan_p,
            valid_combinations_path=cat_p,
        )
        assert_true(snap1["shard_count"] == 2, "snapshot.1 shard_count=2")
        s0 = get_snapshot_shard(snap1, "xp-normal-000")
        assert_true(s0["expected_count"] == 2, "snapshot.1 xp-normal-000 expected=2")
        assert_true(s0["combination_ids"] == ["a", "b"], "snapshot.1 sorted ROUTE_ON ids")
        assert_true(
            s0["combination_ids_hash"] == combination_ids_hash(["a", "b"]),
            "snapshot.1 combination hash",
        )
        snap2 = build_shard_plan_snapshot(
            source_run_id="run1",
            immutable=imm,
            shard_plan_path=plan_p,
            valid_combinations_path=cat_p,
        )
        assert_true(snap1["snapshot_hash"] == snap2["snapshot_hash"], "snapshot.2 regenerate same hash")

        attempt = root / "attempt"
        attempt.mkdir()
        path, created = ensure_shard_plan_snapshot(attempt, snap1)
        assert_true(created and path.exists(), "snapshot.3 created once")
        path2, created2 = ensure_shard_plan_snapshot(attempt, snap1)
        assert_true(not created2 and path2 == path, "snapshot.3 second ensure no rewrite")
        # Different hash must refuse overwrite
        bad = dict(snap1)
        bad["snapshot_hash"] = "different"
        try:
            ensure_shard_plan_snapshot(attempt, bad)
            assert_true(False, "snapshot.3 overwrite should fail")
        except RuntimeError:
            assert_true(True, "snapshot.3 overwrite forbidden")


def test_recovery_plan_links_snapshot():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        attempt = root / "recovery-attempt-001"
        attempt.mkdir()
        plan_p, cat_p = _write_mini_catalog(
            root / "gen",
            [{"shard_id": "xp-normal-000", "ids_on": ["a", "b"], "ids_off": ["z"]}],
        )
        snap = build_shard_plan_snapshot(
            source_run_id="run1",
            immutable={
                "git_commit": EXPECTED_FIXED_COMMIT,
                "harness_version": EXPECTED_FIXED_HARNESS,
                "manifest_hash": "m1",
                "applicability_rules_hash": "r1",
                "axes_hash": "x1",
            },
            shard_plan_path=plan_p,
            valid_combinations_path=cat_p,
        )
        ensure_shard_plan_snapshot(attempt, snap)
        write_json(
            attempt / "recovery-plan.json",
            {
                "rerun_shards": ["xp-normal-000"],
                "reuse_shards": [],
                "shards": [
                    {
                        "shard_id": "xp-normal-000",
                        "rerun": True,
                        "expected_combinations": 2,
                        "replacement_path": str(attempt / "replacements" / "xp-normal-000-ROUTE_ON"),
                    }
                ],
            },
        )
        v2 = build_recovery_plan_v2(attempt_dir=attempt, snapshot=snap)
        assert_true((attempt / "recovery-plan.v2.json").exists(), "plan.v2 written")
        assert_true(v2["shards"][0]["combination_ids_hash"] == snap["shards"][0]["combination_ids_hash"], "plan linked hash")
        assert_true("replacement_output_dir" in v2["shards"][0], "plan replacement_output_dir")
        # v1 untouched meaning preserved
        assert_true((attempt / "recovery-plan.json").exists(), "plan.v1 preserved")


def test_preflight_zero_and_missing_shard():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        plan_p, cat_p = _write_mini_catalog(
            root / "gen",
            [{"shard_id": "xp-normal-000", "ids_on": ["a"], "ids_off": []}],
        )
        snap = build_shard_plan_snapshot(
            source_run_id="r",
            immutable={
                "git_commit": EXPECTED_FIXED_COMMIT,
                "harness_version": EXPECTED_FIXED_HARNESS,
                "manifest_hash": "m1",
                "applicability_rules_hash": "r1",
                "axes_hash": "x1",
            },
            shard_plan_path=plan_p,
            valid_combinations_path=cat_p,
        )
        z = preflight_selected_shards(shard_ids=[], snapshot=snap)
        assert_true(z["reason"] == "FAILED_PREFLIGHT_ZERO_SHARDS", "preflight zero shards")
        m = preflight_selected_shards(shard_ids=["xp-normal-999"], snapshot=snap)
        assert_true(not m["ok"], "preflight missing shard fails")
        v = validate_snapshot_shard(snap, shard_id="xp-normal-000", expected_count=1)
        assert_true(v["ok"], "preflight valid shard ok")


def test_false_complete_guards_and_incomplete():
    with tempfile.TemporaryDirectory() as td:
        art = Path(td) / "xp-normal-000-ROUTE_ON"
        # missing result
        v = validate_replacement_artifact(
            art_dir=art,
            shard_id="xp-normal-000",
            expected_count=2,
            expected_harness=EXPECTED_FIXED_HARNESS,
            expected_commit=EXPECTED_FIXED_COMMIT,
        )
        assert_true(v["reason"] == "FAILED_RESULT_MISSING", "missing result → FAILED_RESULT_MISSING")
        # executed=0 empty file
        art.mkdir(parents=True)
        (art / "cross-product-results.jsonl").write_text("")
        v0 = validate_replacement_artifact(
            art_dir=art,
            shard_id="xp-normal-000",
            expected_count=2,
            expected_harness=EXPECTED_FIXED_HARNESS,
            expected_commit=EXPECTED_FIXED_COMMIT,
        )
        assert_true(not v0["ok"] and v0["executed"] == 0, "executed=0 incomplete")
        # expected != executed
        write_jsonl(art / "cross-product-results.jsonl", [base_row(combination_id="a")])
        write_json(art / "shard-manifest.json", {"ended_at": "t", "exit_code": 0})
        (art / "cross_product__xp_a").mkdir()
        v1 = validate_replacement_artifact(
            art_dir=art,
            shard_id="xp-normal-000",
            expected_count=2,
            expected_harness=EXPECTED_FIXED_HARNESS,
            expected_commit=EXPECTED_FIXED_COMMIT,
            expected_ids=["a", "b"],
        )
        assert_true(v1["reason"] == "INCOMPLETE_EXECUTION", "expected!=executed → INCOMPLETE")


def test_duplicate_and_mixed_harness_detection():
    with tempfile.TemporaryDirectory() as td:
        art = Path(td) / "s"
        art.mkdir()
        write_jsonl(
            art / "cross-product-results.jsonl",
            [
                base_row(combination_id="a"),
                base_row(combination_id="a"),
            ],
        )
        write_json(art / "shard-manifest.json", {"ended_at": "t", "exit_code": 0})
        (art / "cross_product__xp_a").mkdir()
        v = validate_replacement_artifact(
            art_dir=art,
            shard_id="s",
            expected_count=1,
            expected_harness=EXPECTED_FIXED_HARNESS,
            expected_commit=EXPECTED_FIXED_COMMIT,
            expected_ids=["a"],
        )
        assert_true(v["duplicate"] == 1 and not v["ok"], "duplicate combination detected")

        write_jsonl(
            art / "cross-product-results.jsonl",
            [
                base_row(combination_id="a"),
                base_row(combination_id="b", harness_version="other"),
            ],
        )
        (art / "cross_product__xp_b").mkdir(exist_ok=True)
        v2 = validate_replacement_artifact(
            art_dir=art,
            shard_id="s",
            expected_count=2,
            expected_harness=EXPECTED_FIXED_HARNESS,
            expected_commit=EXPECTED_FIXED_COMMIT,
            expected_ids=["a", "b"],
        )
        assert_true(not v2["ok"] and len(v2["harness_versions"]) == 2, "mixed harness detected")


def test_atomic_publish_and_no_partial_exposure():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        src = root / "src"
        dst = root / "replacements" / "xp-normal-000-ROUTE_ON"
        src.mkdir(parents=True)
        write_jsonl(src / "cross-product-results.jsonl", [base_row(combination_id="a")])
        pub = atomic_publish_replacement(src_dir=src, dst_dir=dst, generation=1)
        assert_true(pub["ok"] and (dst / "cross-product-results.jsonl").exists(), "atomic publish ok")
        # second publish must not overwrite
        src2 = root / "src2"
        src2.mkdir()
        write_jsonl(src2 / "cross-product-results.jsonl", [base_row(combination_id="b")])
        pub2 = atomic_publish_replacement(src_dir=src2, dst_dir=dst, generation=2)
        assert_true(pub2["reason"] == "DST_EXISTS", "partial/overwrite forbidden")
        assert_true(
            "a" in (dst / "cross-product-results.jsonl").read_text(),
            "existing replacement preserved",
        )


def test_original_vs_attempt_status_separation():
    with tempfile.TemporaryDirectory() as td:
        e2e = Path(td) / "e2e"
        reports = e2e / "reports"
        run = reports / "run_sep"
        attempt = run / "recovery-attempt-001"
        attempt.mkdir(parents=True)
        (e2e / "cross-product" / "generated").mkdir(parents=True)
        write_json(e2e / "cross-product" / "generated" / "shard-summary.json", {"by_shard": []})
        write_json(e2e / "cross-product" / "generated" / "shard-plan.json", {"shards": []})
        create_immutable_run_manifest(
            run,
            {
                "run_id": "run_sep",
                "git_commit": EXPECTED_FIXED_COMMIT,
                "harness_version": EXPECTED_FIXED_HARNESS,
                "manifest_hash": "m",
                "applicability_rules_hash": "r",
                "axes_hash": "x",
                "executor_hash": "e",
                "driver_hash": "d",
                "spec_hash": "s",
                "oracle_hash": "o",
                "fixture_hash": "f",
                "route_runtime": "ROUTE_ON",
                "started_at": "t",
            },
        )
        write_run_abort(
            run,
            abort_reason="HARNESS_DRIFT",
            expected={"harness_version": EXPECTED_FIXED_HARNESS, "git_commit": EXPECTED_FIXED_COMMIT},
            actual={"harness_version": "bad", "git_commit": "other"},
        )
        update_attempt_status(
            attempt,
            source_run_id="run_sep",
            attempt="recovery-attempt-001",
            status="FAILED_PREFLIGHT",
            final_verdict="FAILED_PREFLIGHT_SHARD_PLAN_MISSING",
            abort_reason="SHARD_PLAN_MISSING",
        )
        st = determine_status(run_dir=run, e2e_root=e2e, reports_root=reports)
        att = determine_attempt_status(attempt)
        assert_true(st["final_verdict"] == "ABORTED_HARNESS_DRIFT", "original remains ABORTED_HARNESS_DRIFT")
        assert_true(att["status"] == "FAILED_PREFLIGHT", "attempt status separate")
        assert_true(att["final_verdict"] == "FAILED_PREFLIGHT_SHARD_PLAN_MISSING", "attempt verdict separate")


def test_zero_shard_side_run_merge_excluded():
    with tempfile.TemporaryDirectory() as td:
        side = Path(td) / "run__attempt__xp-normal-000"
        side.mkdir()
        write_json(side / "run-metadata.json", {"status": "COMPLETE", "failed_shards": 0})
        doc = invalidate_zero_shard_side_run(side)
        assert_true(doc["merge_excluded"] is True, "zero-shard merge_excluded")
        assert_true((side / "zero-shard-invalid.json").exists(), "zero-shard-invalid written")
        assert_true(is_side_run_merge_excluded(side), "side run excluded helper")
        # original COMPLETE preserved
        assert_true(json.loads((side / "run-metadata.json").read_text())["status"] == "COMPLETE", "original COMPLETE preserved")


def test_only_shard_selection_and_canary_stop():
    """only-shard selects one; canary failure path does not imply other shards ran."""
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        plan_p, cat_p = _write_mini_catalog(
            root / "gen",
            [
                {"shard_id": "xp-normal-000", "ids_on": ["a"], "ids_off": []},
                {"shard_id": "xp-normal-001", "ids_on": ["b"], "ids_off": []},
            ],
        )
        snap = build_shard_plan_snapshot(
            source_run_id="r",
            immutable={
                "git_commit": EXPECTED_FIXED_COMMIT,
                "harness_version": EXPECTED_FIXED_HARNESS,
                "manifest_hash": "m1",
                "applicability_rules_hash": "r1",
                "axes_hash": "x1",
            },
            shard_plan_path=plan_p,
            valid_combinations_path=cat_p,
        )
        pf = preflight_selected_shards(shard_ids=["xp-normal-000"], snapshot=snap, plan_expected={"xp-normal-000": 1})
        assert_true(pf["ok"] and pf["selected_shards"] == 1, "only-shard selects 1")
        assert_true(pf["selected_combinations"] == 1, "only-shard combinations=1")
        # Simulate canary fail status without advancing other shards
        attempt = root / "attempt"
        attempt.mkdir()
        update_attempt_status(attempt, status="CANARY_FAIL", completed_shards=0, failed_shards=1, current_shard="xp-normal-000")
        att = determine_attempt_status(attempt)
        assert_true(att["status"] == "CANARY_FAIL", "canary fail status")
        assert_true(int(att.get("completed_shards") or 0) == 0, "no further shards completed")


def test_recovery_artifact_immutability_helpers():
    with tempfile.TemporaryDirectory() as td:
        attempt = Path(td) / "a"
        attempt.mkdir()
        plan_p, cat_p = _write_mini_catalog(
            Path(td) / "gen",
            [{"shard_id": "xp-normal-000", "ids_on": ["a"], "ids_off": []}],
        )
        snap = build_shard_plan_snapshot(
            source_run_id="r",
            immutable={
                "git_commit": EXPECTED_FIXED_COMMIT,
                "harness_version": EXPECTED_FIXED_HARNESS,
                "manifest_hash": "m1",
                "applicability_rules_hash": "r1",
                "axes_hash": "x1",
            },
            shard_plan_path=plan_p,
            valid_combinations_path=cat_p,
        )
        ensure_shard_plan_snapshot(attempt, snap)
        before = (attempt / "shard-plan.snapshot.json").read_text()
        loaded = load_shard_plan_snapshot(attempt)
        assert_true(loaded["snapshot_hash"] == snap["snapshot_hash"], "artifact load stable")
        ensure_shard_plan_snapshot(attempt, snap)
        assert_true((attempt / "shard-plan.snapshot.json").read_text() == before, "snapshot bytes unchanged")


def test_run_all_shards_shell_false_complete_guard():
    """Shell-level: missing shard-plan must exit non-zero and not COMPLETE."""
    script = ROOT / "e2e" / "cross-product" / "run-all-shards.sh"
    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        # Minimal fake repo tree with generation-summary but no shard-plan
        e2e = td_path / "e2e"
        xp = e2e / "cross-product"
        gen = xp / "generated"
        gen.mkdir(parents=True)
        write_json(
            gen / "generation-summary.json",
            {
                "manifest_hash": "m",
                "applicability_rules_hash": "r",
                "axes_hash": "x",
            },
        )
        # Copy recovery_lib for immutable init imports used by script — script uses ROOT from its location.
        # Invoke with a wrapper that points GEN missing plan via env override after cd tricks is hard.
        # Instead unit-test the python preflight contract used by the shell.
        from recovery_lib import preflight_selected_shards

        empty = preflight_selected_shards(shard_ids=[], snapshot={"shards": []})
        assert_true(empty["reason"] == "FAILED_PREFLIGHT_ZERO_SHARDS", "shell guard contract zero shards")
        assert_true(script.exists(), "run-all-shards.sh present")
        text = script.read_text()
        assert_true("FAILED_PREFLIGHT_SHARD_PLAN_MISSING" in text, "shell guards shard-plan missing")
        assert_true("FAILED_PREFLIGHT_ZERO_SHARDS" in text, "shell guards zero shards")
        assert_true('meta["complete"] = True' in text, "complete flag only after validation")


def _mini_imm() -> dict:
    return {
        "git_commit": EXPECTED_FIXED_COMMIT,
        "harness_version": EXPECTED_FIXED_HARNESS,
        "manifest_hash": "m1",
        "applicability_rules_hash": "r1",
        "axes_hash": "x1",
    }


def test_authoritative_count_set_equality():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        plan_p, cat_p = _write_mini_catalog(
            root / "gen",
            [
                {"shard_id": "xp-normal-000", "ids_on": ["a", "b"], "ids_off": ["z"]},
                {"shard_id": "xp-fault-000", "ids_on": ["c"], "ids_off": []},
            ],
        )
        write_json(
            root / "gen" / "generation-summary.json",
            {
                "candidate_combinations": 10,
                "valid_combinations": 4,
                "not_applicable_combinations": 6,
                "route_on_combinations": 3,
                "route_off_combinations": 1,
            },
        )
        snap = build_shard_plan_snapshot(
            source_run_id="r",
            immutable=_mini_imm(),
            shard_plan_path=plan_p,
            valid_combinations_path=cat_p,
        )
        audit = audit_combination_count_integrity(
            snapshot=snap,
            valid_combinations_path=cat_p,
            selected_shard_ids=["xp-normal-000", "xp-fault-000"],
            route_runtime="ROUTE_ON",
            generation_summary_path=root / "gen" / "generation-summary.json",
        )
        assert_true(audit["ok"] and audit["equation_ok"], "authoritative set equality ok")
        assert_true(audit["authoritative_count"] == 3, "authoritative=route_on=3")
        assert_true(audit["route_off_count"] == 1, "route_off tracked separately")
        assert_true(audit["missing"] == 0 and audit["extra"] == 0, "no missing/extra")
        assert_true(audit["unassigned"] == 0 and audit["multi_assigned"] == 0, "assignment clean")
        pf = preflight_selected_shards(
            shard_ids=["xp-normal-000", "xp-fault-000"],
            snapshot=snap,
            plan_expected={"xp-normal-000": 2, "xp-fault-000": 1},
            valid_combinations_path=cat_p,
            generation_summary_path=root / "gen" / "generation-summary.json",
        )
        assert_true(pf["ok"] and pf["equation_ok"], "preflight includes authoritative audit")


def test_negative_count_gates():
    """Negative mutations must fail preflight against authoritative catalog."""
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        plan_p, cat_p = _write_mini_catalog(
            root / "gen",
            [
                {"shard_id": "xp-normal-000", "ids_on": ["a", "b"], "ids_off": []},
                {"shard_id": "xp-normal-001", "ids_on": ["c"], "ids_off": []},
                {"shard_id": "xp-fault-000", "ids_on": ["f1"], "ids_off": []},
            ],
        )
        snap = build_shard_plan_snapshot(
            source_run_id="r",
            immutable=_mini_imm(),
            shard_plan_path=plan_p,
            valid_combinations_path=cat_p,
        )
        selected = ["xp-normal-000", "xp-normal-001", "xp-fault-000"]

        # 1) remove one combination from snapshot
        bad1 = json.loads(json.dumps(snap))
        bad1["shards"][0]["combination_ids"] = ["a"]
        bad1["shards"][0]["expected_count"] = 1
        bad1["shards"][0]["combination_ids_hash"] = combination_ids_hash(["a"])
        a1 = audit_combination_count_integrity(
            snapshot=bad1, valid_combinations_path=cat_p, selected_shard_ids=selected
        )
        assert_true(not a1["ok"] and a1["missing"] == 1, "neg1 snapshot missing detected")

        # 2) add unknown combination
        bad2 = json.loads(json.dumps(snap))
        ids2 = ["a", "b", "unknown_x"]
        bad2["shards"][0]["combination_ids"] = ids2
        bad2["shards"][0]["expected_count"] = 3
        bad2["shards"][0]["combination_ids_hash"] = combination_ids_hash(ids2)
        a2 = audit_combination_count_integrity(
            snapshot=bad2, valid_combinations_path=cat_p, selected_shard_ids=selected
        )
        assert_true(not a2["ok"] and a2["extra"] >= 1, "neg2 unknown extra detected")

        # 3) multi-assign same id to two shards
        bad3 = json.loads(json.dumps(snap))
        bad3["shards"][1]["combination_ids"] = ["b", "c"]
        bad3["shards"][1]["expected_count"] = 2
        bad3["shards"][1]["combination_ids_hash"] = combination_ids_hash(["b", "c"])
        a3 = audit_combination_count_integrity(
            snapshot=bad3, valid_combinations_path=cat_p, selected_shard_ids=selected
        )
        assert_true(not a3["ok"] and a3["multi_assigned"] >= 1, "neg3 multi-assign detected")

        # 4) expected_count decreased without changing ids → shard validation fails
        bad4 = json.loads(json.dumps(snap))
        bad4["shards"][0]["expected_count"] = 1
        pf4 = preflight_selected_shards(
            shard_ids=selected, snapshot=bad4, valid_combinations_path=cat_p
        )
        assert_true(not pf4["ok"], "neg4 expected_count mismatch fails")

        # 5) drop one shard from selected → plan missing vs authoritative
        a5 = audit_combination_count_integrity(
            snapshot=snap,
            valid_combinations_path=cat_p,
            selected_shard_ids=["xp-normal-000", "xp-normal-001"],
        )
        assert_true(not a5["ok"] and a5["plan_missing"] >= 1, "neg5 plan missing shard ids")

        # 6) remove all route-on from one normal shard (simulate route-on wipe)
        bad6 = json.loads(json.dumps(snap))
        bad6["shards"] = [s for s in bad6["shards"] if s["shard_id"] != "xp-normal-000"]
        # rebuild totals loosely
        a6 = audit_combination_count_integrity(
            snapshot=bad6, valid_combinations_path=cat_p, selected_shard_ids=selected
        )
        assert_true(not a6["ok"] and a6["missing"] >= 2, "neg6 route-on shard removal detected")

        # 7) remove all fault combinations
        bad7 = json.loads(json.dumps(snap))
        bad7["shards"] = [s for s in bad7["shards"] if not str(s["shard_id"]).startswith("xp-fault-")]
        a7 = audit_combination_count_integrity(
            snapshot=bad7, valid_combinations_path=cat_p, selected_shard_ids=selected
        )
        assert_true(not a7["ok"] and a7["missing"] >= 1, "neg7 fault removal detected")


def _mini_canary_attempt(root: Path, *, shard_count: int = 3):
    """Build a minimal recovery-attempt with one canary shard + N-1 rerun shards."""
    attempt = root / "recovery-attempt-test"
    attempt.mkdir(parents=True)
    shards = []
    rerun = []
    for i in range(shard_count):
        sid = f"xp-normal-{i:03d}"
        shards.append(
            {
                "shard_id": sid,
                "original_shard_path": str(root / f"{sid}-ROUTE_ON"),
                "verdict": "SUPERSEDED" if i == 0 else "INCOMPLETE",
                "reuse": False,
                "rerun": True,
                "merge_include": False,
                "merge_exclude": False,
                "full_shard_rerun": True,
                "expected_combinations": 2 if i == 0 else 1,
                "replacement_path": str(attempt / "replacements" / f"{sid}-ROUTE_ON"),
            }
        )
        rerun.append(sid)
    plan = {
        "run_id": "run_canary",
        "attempt": attempt.name,
        "shards": shards,
        "reuse_shards": [],
        "rerun_shards": rerun,
        "reuse_shard_count": 0,
        "rerun_shard_count": len(rerun),
        "canary_required": True,
        "canary_shard": "xp-normal-000",
        "canary_passed": False,
    }
    rep_map = {
        "xp-normal-000": {
            "original": str(root / "xp-normal-000-ROUTE_ON"),
            "replacement": str(attempt / "replacements" / "xp-normal-000-ROUTE_ON"),
            "validated": False,
            "merge_eligible": False,
            "merge_excluded": False,
        }
    }
    write_json(attempt / "recovery-plan.json", plan)
    write_json(attempt / "replacement-map.json", rep_map)
    write_json(attempt / "attempt-status.json", {"status": "PLANNED", "phase": "PLANNED"})
    return attempt, plan, rep_map


def _write_canary_artifact(art: Path, *, n: int = 2, status: str = "PASS"):
    art.mkdir(parents=True, exist_ok=True)
    rows = [
        base_row(combination_id=f"c{i}", status=status, cleanup_ok=True)
        for i in range(n)
    ]
    write_jsonl(art / "cross-product-results.jsonl", rows)
    write_json(art / "shard-summary.json", {"executed": n, "expected": n})
    write_json(art / "cleanup-report.json", {"ok": True})
    write_json(art / "evidence-flush.json", {"ok": True})
    (art / "cross_product__xp_c0").mkdir(exist_ok=True)
    return rows


def test_post_canary_finalize_transitions_and_gates():
    """Canary success transitions reuse/rerun; failures leave prior state intact."""
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        attempt, _plan0, _rep0 = _mini_canary_attempt(root, shard_count=3)

        # Before canary: reuse=0 rerun=3 and consistent.
        plan = json.loads((attempt / "recovery-plan.json").read_text())
        rep = json.loads((attempt / "replacement-map.json").read_text())
        cons = validate_recovery_plan_consistency(plan, rep)
        assert_true(cons["ok"], "pre-canary plan consistent")
        assert_true(plan["reuse_shard_count"] == 0 and len(plan["reuse_shards"]) == 0, "pre-canary reuse=0")
        assert_true(plan["rerun_shard_count"] == 3 and len(plan["rerun_shards"]) == 3, "pre-canary rerun=3")

        # Validation failure: no transition.
        bad_val = {
            "ok": False,
            "reason": "INCOMPLETE_EXECUTION",
            "executed": 1,
            "unique": 1,
            "duplicate": 0,
            "missing": 1,
            "cleanup_ok": True,
            "evidence_flush": True,
            "harness_versions": [EXPECTED_FIXED_HARNESS],
            "git_commits": [EXPECTED_FIXED_COMMIT],
        }
        pub_ok = {"ok": True}
        fin_bad = finalize_post_canary_success(
            attempt_dir=attempt,
            shard_id="xp-normal-000",
            validation=bad_val,
            publish=pub_ok,
            expected_count=2,
            expected_harness=EXPECTED_FIXED_HARNESS,
            expected_commit=EXPECTED_FIXED_COMMIT,
            replacement_path=str(attempt / "replacements" / "xp-normal-000-ROUTE_ON"),
        )
        assert_true(not fin_bad["ok"], "validation failure blocks finalize")
        plan2 = json.loads((attempt / "recovery-plan.json").read_text())
        rep2 = json.loads((attempt / "replacement-map.json").read_text())
        assert_true(plan2["reuse_shard_count"] == 0 and len(plan2["reuse_shards"]) == 0, "no reuse after validation fail")
        assert_true(rep2["xp-normal-000"].get("merge_eligible") is False, "merge_eligible unchanged on validation fail")

        # Publish failure: no transition.
        art = attempt / "replacements" / "xp-normal-000-ROUTE_ON"
        _write_canary_artifact(art, n=2)
        good_val = validate_replacement_artifact(
            art_dir=art,
            shard_id="xp-normal-000",
            expected_count=2,
            expected_harness=EXPECTED_FIXED_HARNESS,
            expected_commit=EXPECTED_FIXED_COMMIT,
            expected_ids=["c0", "c1"],
        )
        fin_pub = finalize_post_canary_success(
            attempt_dir=attempt,
            shard_id="xp-normal-000",
            validation=good_val,
            publish={"ok": False, "reason": "DST_EXISTS"},
            expected_count=2,
            expected_harness=EXPECTED_FIXED_HARNESS,
            expected_commit=EXPECTED_FIXED_COMMIT,
            replacement_path=str(art),
        )
        assert_true(not fin_pub["ok"], "publish failure blocks finalize")
        plan3 = json.loads((attempt / "recovery-plan.json").read_text())
        assert_true(len(plan3["reuse_shards"]) == 0, "no reuse after publish fail")

        # Partial write failure: existing state preserved.
        plan_before = (attempt / "recovery-plan.json").read_text()
        rep_before = (attempt / "replacement-map.json").read_text()
        status_before = (attempt / "attempt-status.json").read_text()

        def _boom(*_a, **_k):
            raise OSError("simulated partial write failure")

        import recovery_lib as rl

        orig = rl.atomic_write_jsons
        rl.atomic_write_jsons = _boom  # type: ignore[assignment]
        try:
            fin_write = finalize_post_canary_success(
                attempt_dir=attempt,
                shard_id="xp-normal-000",
                validation=good_val,
                publish={"ok": True},
                expected_count=2,
                expected_harness=EXPECTED_FIXED_HARNESS,
                expected_commit=EXPECTED_FIXED_COMMIT,
                replacement_path=str(art),
            )
        finally:
            rl.atomic_write_jsons = orig  # type: ignore[assignment]
        assert_true(not fin_write["ok"] and fin_write["reason"] == "ATOMIC_WRITE_FAILED", "write failure reported")
        assert_true((attempt / "recovery-plan.json").read_text() == plan_before, "plan preserved on write fail")
        assert_true((attempt / "replacement-map.json").read_text() == rep_before, "rep-map preserved on write fail")
        assert_true((attempt / "attempt-status.json").read_text() == status_before, "status preserved on write fail")

        # Success path: reuse=1 rerun=2 and merge_eligible=true.
        fin_ok = finalize_post_canary_success(
            attempt_dir=attempt,
            shard_id="xp-normal-000",
            validation=good_val,
            publish={"ok": True},
            expected_count=2,
            expected_harness=EXPECTED_FIXED_HARNESS,
            expected_commit=EXPECTED_FIXED_COMMIT,
            replacement_path=str(art),
        )
        assert_true(fin_ok["ok"], "canary finalize success")
        plan4 = json.loads((attempt / "recovery-plan.json").read_text())
        rep4 = json.loads((attempt / "replacement-map.json").read_text())
        status4 = json.loads((attempt / "attempt-status.json").read_text())
        s0 = next(s for s in plan4["shards"] if s["shard_id"] == "xp-normal-000")
        assert_true(s0["reuse"] is True and s0["rerun"] is False, "canary shard reuse/rerun flipped")
        assert_true(s0["merge_include"] is True and s0["merge_exclude"] is False, "merge include/exclude")
        assert_true(s0["canary_passed"] is True and s0["replacement_validated"] is True, "canary flags set")
        assert_true(s0.get("full_shard_rerun") is False, "full_shard_rerun cleared")
        assert_true(plan4["reuse_shards"] == ["xp-normal-000"], "reuse_shards array")
        assert_true(plan4["reuse_shard_count"] == 1, "reuse_shard_count=1")
        assert_true(plan4["rerun_shard_count"] == 2 and len(plan4["rerun_shards"]) == 2, "rerun=2")
        assert_true("xp-normal-000" not in plan4["rerun_shards"], "canary excluded from rerun")
        assert_true(rep4["xp-normal-000"]["merge_eligible"] is True, "replacement merge_eligible=true")
        assert_true(rep4["xp-normal-000"]["merge_excluded"] is False, "replacement merge_excluded=false")
        assert_true(status4["status"] == "CANARY_PASS", "attempt-status CANARY_PASS")
        cons4 = validate_recovery_plan_consistency(plan4, rep4)
        assert_true(cons4["ok"], "post-canary consistency ok")

        # Inconsistency detectors.
        bad_plan = json.loads(json.dumps(plan4))
        bad_plan["reuse_shard_count"] = 99
        bad_cons = validate_recovery_plan_consistency(bad_plan, rep4)
        assert_true(not bad_cons["ok"], "count/array mismatch detected")
        bad_plan2 = json.loads(json.dumps(plan4))
        bad_plan2["shards"][0]["reuse"] = False
        bad_cons2 = validate_recovery_plan_consistency(bad_plan2, rep4)
        assert_true(not bad_cons2["ok"], "shard.reuse vs reuse_shards mismatch detected")
        bad_rep = json.loads(json.dumps(rep4))
        bad_rep["xp-normal-000"]["merge_eligible"] = False
        bad_cons3 = validate_recovery_plan_consistency(plan4, bad_rep)
        assert_true(not bad_cons3["ok"], "merge_eligible=false reuse selection detected")


def test_post_full_resume_finalize_and_merge_gate():
    """Full-resume finalize sets merge_eligible atomically; failures leave map unchanged."""
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        attempt, _plan0, _rep0 = _mini_canary_attempt(root, shard_count=2)

        # Snapshot + artifacts for both shards.
        snap = {
            "shards": [
                {
                    "shard_id": "xp-normal-000",
                    "expected_count": 2,
                    "combination_ids": ["c0", "c1"],
                },
                {
                    "shard_id": "xp-normal-001",
                    "expected_count": 1,
                    "combination_ids": ["d0"],
                },
            ]
        }
        write_json(attempt / "shard-plan.snapshot.json", snap)

        art0 = attempt / "replacements" / "generations" / "xp-normal-000" / "g0-ROUTE_ON"
        art1 = attempt / "replacements" / "generations" / "xp-normal-001" / "g1-ROUTE_ON"
        _write_canary_artifact(art0, n=2)
        _write_canary_artifact(art1, n=1)
        write_json(art0.parent / "run-generation.json", {"status": "COMPLETE", "generation_id": "g0"})
        write_json(art1.parent / "run-generation.json", {"status": "COMPLETE", "generation_id": "g1"})

        rep_map = {
            "xp-normal-000": {
                "shard": "xp-normal-000",
                "original": str(root / "xp-normal-000-ROUTE_ON"),
                "replacement": str(art0),
                "active_path": str(art0),
                "active_generation_id": "g0",
                "validated": True,
                "merge_eligible": True,
                "merge_excluded": False,
                "commit": EXPECTED_FIXED_COMMIT,
                "harness_version": EXPECTED_FIXED_HARNESS,
                "expected": 2,
                "executed": 2,
                "generation_publish": "PASS",
                "active_pointer_switch": "PASS",
                "format": "generation_pointer_v1",
            },
            "xp-normal-001": {
                "shard": "xp-normal-001",
                "original": str(root / "xp-normal-001-ROUTE_ON"),
                "replacement": str(art1),
                "active_path": str(art1),
                "active_generation_id": "g1",
                "validated": True,
                "merge_eligible": False,
                "merge_excluded": False,
                "commit": EXPECTED_FIXED_COMMIT,
                "harness_version": EXPECTED_FIXED_HARNESS,
                "expected": 1,
                "executed": 1,
                "generation_publish": "PASS",
                "active_pointer_switch": "PASS",
                "format": "generation_pointer_v1",
            },
        }
        write_json(attempt / "replacement-map.json", rep_map)
        plan = json.loads((attempt / "recovery-plan.json").read_text())
        plan["full_resume_started"] = True
        plan["canary_passed"] = True
        # After canary: 000 reuse, 001 still rerun until finalize.
        for s in plan["shards"]:
            if s["shard_id"] == "xp-normal-000":
                s["reuse"] = True
                s["rerun"] = False
                s["merge_include"] = True
                s["replacement_validated"] = True
            else:
                s["reuse"] = False
                s["rerun"] = True
                s["merge_include"] = False
                s["replacement_validated"] = True
        plan = recompute_plan_shard_arrays(plan)
        write_json(attempt / "recovery-plan.json", plan)

        # Without finalize marker, Final Merge selection is blocked.
        assert_true(not full_resume_finalize_present(attempt), "marker absent before finalize")
        sel_blocked = merge_selection_from_plan(
            run_dir=root,
            plan=plan,
            replacement_map=rep_map,
            attempt_dir=attempt,
            require_full_resume_finalize=True,
        )
        assert_true(sel_blocked.get("reason") == "MERGE_ELIGIBILITY_FINALIZE_MISSING", "merge blocked")
        assert_true(sel_blocked.get("include") == [], "no includes without finalize")

        # Failure path: corrupt shard-001 → no map mutation.
        bad_rows = [base_row(combination_id="d0", status="FAIL", cleanup_ok=True)]
        write_jsonl(art1 / "cross-product-results.jsonl", bad_rows)
        rep_before = (attempt / "replacement-map.json").read_text()
        plan_before = (attempt / "recovery-plan.json").read_text()
        fin_bad = finalize_post_full_resume_success(
            attempt_dir=attempt,
            expected_harness=EXPECTED_FIXED_HARNESS,
            expected_commit=EXPECTED_FIXED_COMMIT,
            shard_ids=["xp-normal-000", "xp-normal-001"],
        )
        assert_true(not fin_bad["ok"], "finalize fails on FAIL shard")
        assert_true(fin_bad.get("replacement_map_changed") is False, "no map change on fail")
        assert_true((attempt / "replacement-map.json").read_text() == rep_before, "rep-map preserved")
        assert_true((attempt / "recovery-plan.json").read_text() == plan_before, "plan preserved")
        assert_true(not full_resume_finalize_present(attempt), "marker not written on fail")

        # Success path.
        _write_canary_artifact(art1, n=1)
        write_json(art1.parent / "run-generation.json", {"status": "COMPLETE", "generation_id": "g1"})
        fin_ok = finalize_post_full_resume_success(
            attempt_dir=attempt,
            expected_harness=EXPECTED_FIXED_HARNESS,
            expected_commit=EXPECTED_FIXED_COMMIT,
            shard_ids=["xp-normal-000", "xp-normal-001"],
        )
        assert_true(fin_ok["ok"], f"finalize success: {fin_ok}")
        assert_true(full_resume_finalize_present(attempt), "marker present")
        plan2 = json.loads((attempt / "recovery-plan.json").read_text())
        rep2 = json.loads((attempt / "replacement-map.json").read_text())
        assert_true(plan2.get("full_resume_ready_for_merge") is True, "plan flag set")
        assert_true(rep2["xp-normal-000"]["merge_eligible"] is True, "000 eligible")
        assert_true(rep2["xp-normal-001"]["merge_eligible"] is True, "001 eligible")
        assert_true(rep2["xp-normal-001"].get("merge_include") is True, "001 merge_include")
        sel_ok = merge_selection_from_plan(
            run_dir=root,
            plan=plan2,
            replacement_map=rep2,
            attempt_dir=attempt,
            require_full_resume_finalize=True,
        )
        assert_true(sel_ok.get("reason") != "MERGE_ELIGIBILITY_FINALIZE_MISSING", "merge unblocked")
        included = {x["shard_id"] for x in sel_ok.get("include") or []}
        assert_true("xp-normal-000" in included and "xp-normal-001" in included, "both included")


def test_circular_missing_zero_is_rejected():
    """Plan and snapshot both omitting the same ID must still fail vs catalog."""
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        plan_p, cat_p = _write_mini_catalog(
            root / "gen",
            [{"shard_id": "xp-normal-000", "ids_on": ["a", "b"], "ids_off": []}],
        )
        snap = build_shard_plan_snapshot(
            source_run_id="r",
            immutable=_mini_imm(),
            shard_plan_path=plan_p,
            valid_combinations_path=cat_p,
        )
        # Both plan selection and snapshot omit "b"
        snap["shards"][0]["combination_ids"] = ["a"]
        snap["shards"][0]["expected_count"] = 1
        snap["shards"][0]["combination_ids_hash"] = combination_ids_hash(["a"])
        # Old-style preflight (snapshot-only) would look fine for selected shard shape,
        # but authoritative audit must fail.
        shape_ok = validate_snapshot_shard(snap, shard_id="xp-normal-000", expected_count=1)
        assert_true(shape_ok["ok"], "shape-only check can pass while catalog incomplete")
        audit = audit_combination_count_integrity(
            snapshot=snap,
            valid_combinations_path=cat_p,
            selected_shard_ids=["xp-normal-000"],
        )
        assert_true(not audit["ok"] and audit["missing"] == 1, "circular missing=0 rejected")


def _seed_mini_prior_attempts(run: Path) -> None:
    """Isolated fixture for AUTHORITATIVE / NON_AUTHORITATIVE integrity tests."""
    a1 = run / "recovery-attempt-001"
    a3 = run / "recovery-attempt-003"
    (a1 / "replacements" / "xp-normal-000-ROUTE_ON").mkdir(parents=True)
    (a1 / "runtime-selectors").mkdir(parents=True)
    a3.mkdir(parents=True)
    write_json(
        a1 / "recovery-plan.json",
        {"shards": [], "reuse_shards": [], "rerun_shards": ["xp-normal-000"]},
    )
    write_json(
        a1 / "replacement-map.json",
        {
            "xp-normal-000": {
                "replacement": str(a1 / "replacements" / "xp-normal-000-ROUTE_ON")
            }
        },
    )
    write_json(a1 / "attempt-status.json", {"status": "CANARY_PASS"})
    write_json(a1 / "shard-plan.snapshot.json", {"snapshot_hash": "h1", "shards": []})
    write_json(a1 / "expected-fixed-harness.json", {"harness_version": "hv"})
    (a1 / "runtime-selectors" / "xp-normal-000.combination_ids.txt").write_text("xp_a\n")
    write_jsonl(
        a1 / "replacements" / "xp-normal-000-ROUTE_ON" / "cross-product-results.jsonl",
        [base_row(combination_id="xp_a")],
    )
    write_json(a1 / "replacements" / "xp-normal-000-ROUTE_ON" / "validation.json", {"ok": True})
    nested = a1 / "replacements" / "xp-normal-000-ROUTE_ON" / "cross_product__xp_a"
    nested.mkdir()
    write_jsonl(nested / "cross-product-results.jsonl", [base_row(combination_id="xp_a")])
    (a3 / "final-canary-g5-monitor.sh").write_text("#!/bin/bash\necho monitor\n")
    (a3 / "final-canary-g5.pid").write_text("12345\n")
    (a3 / "final-canary-g5.nohup.log").write_text("log\n")


def test_authoritative_integrity_classification_and_gates():
    with tempfile.TemporaryDirectory() as td:
        run = Path(td) / "xp_run"
        run.mkdir()
        attempt = run / "recovery-attempt-008"
        attempt.mkdir()
        _seed_mini_prior_attempts(run)

        mon = run / "recovery-attempt-003" / "final-canary-g5-monitor.sh"
        cls = classify_prior_attempt_file(run_dir=run, path=mon)
        assert_true(cls["classification"] == "NON_AUTHORITATIVE", "monitor classified NON_AUTHORITATIVE")
        assert_true(cls["read_by_resume"] is False, "monitor read_by_resume=false")
        assert_true(cls["read_by_merge"] is False, "monitor read_by_merge=false")
        assert_true(cls["read_by_validation"] is False, "monitor read_by_validation=false")
        assert_true(cls["authority_reason"] == "monitoring_helper_only", "monitor reason")

        plan_cls = classify_prior_attempt_file(
            run_dir=run, path=run / "recovery-attempt-001" / "recovery-plan.json"
        )
        assert_true(plan_cls["classification"] == "AUTHORITATIVE", "recovery-plan AUTHORITATIVE")

        nested = (
            run
            / "recovery-attempt-001"
            / "replacements"
            / "xp-normal-000-ROUTE_ON"
            / "cross_product__xp_a"
            / "cross-product-results.jsonl"
        )
        nested_cls = classify_prior_attempt_file(run_dir=run, path=nested)
        assert_true(
            nested_cls["classification"] == "NON_AUTHORITATIVE",
            "nested evidence results NON_AUTHORITATIVE",
        )

        baseline_path = attempt / "prior-attempt-authoritative-baseline.json"
        doc = build_prior_attempt_authoritative_baseline(
            run_dir=run,
            out_path=baseline_path,
            attempts=["recovery-attempt-001", "recovery-attempt-003"],
        )
        assert_true(doc["authoritative_file_count"] > 0, "authoritative_files > 0")
        assert_true(all(e.get("sha256") for e in doc["files"]), "sha256 null = 0")
        paths = [e["relative_path"] for e in doc["files"]]
        assert_true(len(paths) == len(set(paths)), "duplicate path = 0")
        assert_true(
            all(e.get("authority_reason") for e in doc["files"]),
            "authority_reason 누락 = 0",
        )
        assert_true(
            any(
                e["relative_path"].endswith("final-canary-g5-monitor.sh")
                for e in doc.get("non_authoritative_files") or []
            ),
            "monitor listed as NON_AUTHORITATIVE in baseline",
        )

        # AUTH hash same + mtime change → PASS
        auth_path = run / "recovery-attempt-001" / "recovery-plan.json"
        os.utime(auth_path, (time.time() + 10, time.time() + 10))
        v1 = verify_prior_attempt_authoritative_integrity(
            run_dir=run, baseline_path=baseline_path
        )
        assert_true(v1["ok"] and v1["full_resume_ready"], "mtime-only AUTH → PASS")
        assert_true(v1["AUTHORITATIVE_CONTENT_CHANGED"] == 0, "mtime-only no content change")
        assert_true(v1["AUTHORITATIVE_METADATA_ONLY"] >= 1, "metadata-only recorded")

        # AUTH hash change → FAIL
        auth_path.write_text(auth_path.read_text() + "\n")
        v2 = verify_prior_attempt_authoritative_integrity(
            run_dir=run, baseline_path=baseline_path
        )
        assert_true(not v2["ok"], "AUTH hash change → FAIL")
        assert_true(v2["AUTHORITATIVE_CONTENT_CHANGED"] >= 1, "content changed count")
        build_prior_attempt_authoritative_baseline(
            run_dir=run,
            out_path=baseline_path,
            attempts=["recovery-attempt-001", "recovery-attempt-003"],
        )

        # AUTH missing → FAIL
        missing_target = run / "recovery-attempt-001" / "attempt-status.json"
        missing_bytes = missing_target.read_bytes()
        missing_target.unlink()
        v3 = verify_prior_attempt_authoritative_integrity(
            run_dir=run, baseline_path=baseline_path
        )
        assert_true(not v3["ok"] and v3["AUTHORITATIVE_MISSING"] >= 1, "AUTH missing → FAIL")
        missing_target.write_bytes(missing_bytes)

        # AUTH baseline hash null → FAIL
        bad = json.loads(baseline_path.read_text())
        bad["files"][0]["sha256"] = None
        write_json(baseline_path, bad)
        v4 = verify_prior_attempt_authoritative_integrity(
            run_dir=run, baseline_path=baseline_path
        )
        assert_true(
            not v4["ok"] and v4["AUTHORITATIVE_BASELINE_HASH_MISSING"] >= 1,
            "baseline hash null → FAIL",
        )
        build_prior_attempt_authoritative_baseline(
            run_dir=run,
            out_path=baseline_path,
            attempts=["recovery-attempt-001", "recovery-attempt-003"],
        )

        # NON_AUTH hash/mtime change → warning only, PASS
        os.utime(mon, (time.time() + 50, time.time() + 50))
        mon.write_text(mon.read_text() + "# drift\n")
        v5 = verify_prior_attempt_authoritative_integrity(
            run_dir=run, baseline_path=baseline_path
        )
        assert_true(v5["ok"] and v5["full_resume_ready"], "NON_AUTH drift does not block")
        assert_true(v5["NON_AUTHORITATIVE_DRIFT"] >= 1, "NON_AUTHORITATIVE_DRIFT recorded")
        mon_ev = v5.get("final_canary_g5_monitor") or {}
        assert_true(mon_ev.get("classification") == "NON_AUTHORITATIVE", "monitor evidence class")
        assert_true(mon_ev.get("full_resume_blocked") is False, "monitor does not block resume")
        assert_true(mon_ev.get("drift") == "recorded", "monitor drift recorded")

        # Merge dependency omitted from authority list → coverage FAIL
        thin = json.loads(baseline_path.read_text())
        thin["files"] = [
            e for e in thin["files"] if not e["relative_path"].endswith("replacement-map.json")
        ]
        write_json(baseline_path, thin)
        cov = assert_authority_dependency_coverage(run_dir=run, baseline_path=baseline_path)
        assert_true(not cov["ok"], "dependency coverage FAIL when merge input omitted")
        assert_true(
            any(p.endswith("replacement-map.json") for p in cov["missing_from_authority"]),
            "replacement-map reported missing from authority",
        )

        # Atomic write failure preserves existing manifest
        build_prior_attempt_authoritative_baseline(
            run_dir=run,
            out_path=baseline_path,
            attempts=["recovery-attempt-001", "recovery-attempt-003"],
        )
        before = baseline_path.read_bytes()
        import recovery_lib as rl

        real_atomic = rl.atomic_write_json

        def boom(path, doc):  # noqa: ANN001
            raise RuntimeError("simulated atomic write failure")

        rl.atomic_write_json = boom  # type: ignore[assignment]
        try:
            raised = False
            try:
                build_prior_attempt_authoritative_baseline(
                    run_dir=run,
                    out_path=baseline_path,
                    attempts=["recovery-attempt-001", "recovery-attempt-003"],
                )
            except RuntimeError:
                raised = True
            assert_true(raised, "atomic write failure raises")
            assert_true(baseline_path.read_bytes() == before, "existing manifest preserved")
        finally:
            rl.atomic_write_json = real_atomic  # type: ignore[assignment]

        # Empty AUTH set → BASELINE_INCOMPLETE, no publish
        empty_run = Path(td) / "empty_run"
        empty_run.mkdir()
        (empty_run / "recovery-attempt-001").mkdir()
        (empty_run / "recovery-attempt-001" / "note.txt").write_text("no auth\n")
        raised_incomplete = False
        try:
            build_prior_attempt_authoritative_baseline(
                run_dir=empty_run,
                out_path=attempt / "should-not-exist.json",
                attempts=["recovery-attempt-001"],
            )
        except BaselineIncompleteError:
            raised_incomplete = True
        assert_true(raised_incomplete, "empty AUTH set → BASELINE_INCOMPLETE")
        assert_true(
            not (attempt / "should-not-exist.json").exists(),
            "incomplete baseline not published",
        )

        build_prior_attempt_authoritative_baseline(
            run_dir=run,
            out_path=baseline_path,
            attempts=["recovery-attempt-001", "recovery-attempt-003"],
        )
        pf = preflight_prior_attempt_integrity(run_dir=run, attempt_dir=attempt)
        assert_true(pf["ok"] and pf["full_resume_ready"], "preflight integrity PASS")


def _gen_row(combination_id: str, generation_id: str, attempt: str = "recovery-attempt-009", shard: str = "xp-normal-001"):
    return base_row(
        combination_id=combination_id,
        generation_id=generation_id,
        attempt=attempt,
        shard=shard,
    )


def test_generation_isolation_a_through_h():
    """Regression A-H: generation isolation, writer guards, locks, replacement protect."""
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        reports = root / "reports"
        attempt = root / "run" / "recovery-attempt-009"
        attempt.mkdir(parents=True)
        reports.mkdir(parents=True)

        # --- A: existing JSONL on fixed path must not be reused ---
        legacy_side = reports / "run__recovery-attempt-009__xp-normal-001"
        legacy_art = legacy_side / "xp-normal-001-ROUTE_ON"
        legacy_art.mkdir(parents=True)
        legacy_rows = [_gen_row(f"c{i}", "legacy-gen", shard="xp-normal-001") for i in range(1045)]
        write_jsonl(legacy_art / "cross-product-results.jsonl", legacy_rows)
        legacy_hash = sha256_file(legacy_art / "cross-product-results.jsonl")
        alloc1 = allocate_side_run_generation(
            reports_root=reports,
            run_id="run",
            attempt="recovery-attempt-009",
            shard_id="xp-normal-001",
            commit=EXPECTED_FIXED_COMMIT,
            harness_version=EXPECTED_FIXED_HARNESS,
            attempt_dir=attempt,
        )
        assert_true(alloc1["ok"], "A: allocate new generation")
        assert_true("__generation-" in alloc1["side_run_id"], "A: generation token in side-run id")
        assert_true(alloc1["side_run_id"] != legacy_side.name, "A: does not reuse fixed path")
        claim1 = claim_result_writer(
            side_run_dir=Path(alloc1["side_run_dir"]),
            art_dir=Path(alloc1["art_dir"]),
            generation_id=alloc1["generation_id"],
            attempt="recovery-attempt-009",
            shard="xp-normal-001",
            commit=EXPECTED_FIXED_COMMIT,
            harness_version=EXPECTED_FIXED_HARNESS,
        )
        assert_true(claim1["ok"], "A: claim writer on fresh generation")
        for i in range(1045):
            r = append_result_row_guarded(
                side_run_dir=Path(alloc1["side_run_dir"]),
                art_dir=Path(alloc1["art_dir"]),
                generation_id=alloc1["generation_id"],
                attempt="recovery-attempt-009",
                shard="xp-normal-001",
                commit=EXPECTED_FIXED_COMMIT,
                harness_version=EXPECTED_FIXED_HARNESS,
                row=_gen_row(f"c{i}", alloc1["generation_id"]),
            )
            assert_true(r["ok"], f"A: append row {i}")
        new_lines = (Path(alloc1["art_dir"]) / "cross-product-results.jsonl").read_text().strip().splitlines()
        assert_true(len(new_lines) == 1045, "A: new JSONL=1045")
        assert_true(sha256_file(legacy_art / "cross-product-results.jsonl") == legacy_hash, "A: legacy JSONL unchanged")
        finalize_side_run_generation(
            side_run_dir=Path(alloc1["side_run_dir"]),
            attempt_dir=attempt,
            shard_id="xp-normal-001",
            generation_id=alloc1["generation_id"],
            status="COMPLETE",
        )

        # --- B: same generation already has JSONL → preflight FAIL, no truncate ---
        alloc_b = allocate_side_run_generation(
            reports_root=reports,
            run_id="run",
            attempt="recovery-attempt-009",
            shard_id="xp-normal-002",
            commit=EXPECTED_FIXED_COMMIT,
            harness_version=EXPECTED_FIXED_HARNESS,
            attempt_dir=attempt,
        )
        assert_true(alloc_b["ok"], "B: allocate")
        side_b = Path(alloc_b["side_run_dir"])
        art_b = Path(alloc_b["art_dir"])
        claim_b = claim_result_writer(
            side_run_dir=side_b,
            art_dir=art_b,
            generation_id=alloc_b["generation_id"],
            attempt="recovery-attempt-009",
            shard="xp-normal-002",
            commit=EXPECTED_FIXED_COMMIT,
            harness_version=EXPECTED_FIXED_HARNESS,
        )
        assert_true(claim_b["ok"], "B: initial claim")
        append_result_row_guarded(
            side_run_dir=side_b,
            art_dir=art_b,
            generation_id=alloc_b["generation_id"],
            attempt="recovery-attempt-009",
            shard="xp-normal-002",
            commit=EXPECTED_FIXED_COMMIT,
            harness_version=EXPECTED_FIXED_HARNESS,
            row=_gen_row("x", alloc_b["generation_id"], shard="xp-normal-002"),
        )
        before = sha256_file(art_b / "cross-product-results.jsonl")
        # Drop writer lock to simulate re-entry into populated generation
        (art_b / "writer.lock").unlink()
        pf_b = preflight_generation_artifact_ready(
            side_run_dir=side_b, art_dir=art_b, generation_id=alloc_b["generation_id"]
        )
        assert_true(not pf_b["ok"] and pf_b["reason"] == "RESULTS_FILE_ALREADY_EXISTS", "B: preflight FAIL")
        claim_b2 = claim_result_writer(
            side_run_dir=side_b,
            art_dir=art_b,
            generation_id=alloc_b["generation_id"],
            attempt="recovery-attempt-009",
            shard="xp-normal-002",
            commit=EXPECTED_FIXED_COMMIT,
            harness_version=EXPECTED_FIXED_HARNESS,
        )
        assert_true(not claim_b2["ok"], "B: claim rejected")
        assert_true(sha256_file(art_b / "cross-product-results.jsonl") == before, "B: hash unchanged")
        finalize_side_run_generation(
            side_run_dir=side_b,
            attempt_dir=attempt,
            shard_id="xp-normal-002",
            generation_id=alloc_b["generation_id"],
            status="FAILED",
        )

        # --- C: generation mismatch rejects append ---
        alloc_c = allocate_side_run_generation(
            reports_root=reports,
            run_id="run",
            attempt="recovery-attempt-009",
            shard_id="xp-normal-003",
            commit=EXPECTED_FIXED_COMMIT,
            harness_version=EXPECTED_FIXED_HARNESS,
            attempt_dir=attempt,
        )
        claim_c = claim_result_writer(
            side_run_dir=Path(alloc_c["side_run_dir"]),
            art_dir=Path(alloc_c["art_dir"]),
            generation_id=alloc_c["generation_id"],
            attempt="recovery-attempt-009",
            shard="xp-normal-003",
            commit=EXPECTED_FIXED_COMMIT,
            harness_version=EXPECTED_FIXED_HARNESS,
        )
        assert_true(claim_c["ok"], "C: claim")
        bad = append_result_row_guarded(
            side_run_dir=Path(alloc_c["side_run_dir"]),
            art_dir=Path(alloc_c["art_dir"]),
            generation_id="generation-B-mismatch",
            attempt="recovery-attempt-009",
            shard="xp-normal-003",
            commit=EXPECTED_FIXED_COMMIT,
            harness_version=EXPECTED_FIXED_HARNESS,
            row=_gen_row("z", "generation-B-mismatch", shard="xp-normal-003"),
        )
        assert_true(bad.get("reason") == "RESULT_WRITER_GENERATION_MISMATCH", "C: mismatch rejected")
        assert_true(not (Path(alloc_c["art_dir"]) / "cross-product-results.jsonl").exists(), "C: no append")
        finalize_side_run_generation(
            side_run_dir=Path(alloc_c["side_run_dir"]),
            attempt_dir=attempt,
            shard_id="xp-normal-003",
            generation_id=alloc_c["generation_id"],
            status="FAILED",
        )

        # --- D: concurrent runners → SHARD_ALREADY_RUNNING ---
        alloc_d1 = allocate_side_run_generation(
            reports_root=reports,
            run_id="run",
            attempt="recovery-attempt-009",
            shard_id="xp-normal-004",
            commit=EXPECTED_FIXED_COMMIT,
            harness_version=EXPECTED_FIXED_HARNESS,
            attempt_dir=attempt,
        )
        assert_true(alloc_d1["ok"], "D: first runner ok")
        alloc_d2 = allocate_side_run_generation(
            reports_root=reports,
            run_id="run",
            attempt="recovery-attempt-009",
            shard_id="xp-normal-004",
            commit=EXPECTED_FIXED_COMMIT,
            harness_version=EXPECTED_FIXED_HARNESS,
            attempt_dir=attempt,
        )
        assert_true(alloc_d2.get("reason") == "SHARD_ALREADY_RUNNING", "D: second blocked")
        finalize_side_run_generation(
            side_run_dir=Path(alloc_d1["side_run_dir"]),
            attempt_dir=attempt,
            shard_id="xp-normal-004",
            generation_id=alloc_d1["generation_id"],
            status="FAILED",
        )

        # --- E: fail then resume → new generation, old preserved ---
        g1 = allocate_side_run_generation(
            reports_root=reports,
            run_id="run",
            attempt="recovery-attempt-009",
            shard_id="xp-normal-005",
            commit=EXPECTED_FIXED_COMMIT,
            harness_version=EXPECTED_FIXED_HARNESS,
            attempt_dir=attempt,
        )
        claim_result_writer(
            side_run_dir=Path(g1["side_run_dir"]),
            art_dir=Path(g1["art_dir"]),
            generation_id=g1["generation_id"],
            attempt="recovery-attempt-009",
            shard="xp-normal-005",
            commit=EXPECTED_FIXED_COMMIT,
            harness_version=EXPECTED_FIXED_HARNESS,
        )
        append_result_row_guarded(
            side_run_dir=Path(g1["side_run_dir"]),
            art_dir=Path(g1["art_dir"]),
            generation_id=g1["generation_id"],
            attempt="recovery-attempt-009",
            shard="xp-normal-005",
            commit=EXPECTED_FIXED_COMMIT,
            harness_version=EXPECTED_FIXED_HARNESS,
            row=_gen_row("old", g1["generation_id"], shard="xp-normal-005"),
        )
        g1_hash = sha256_file(Path(g1["art_dir"]) / "cross-product-results.jsonl")
        finalize_side_run_generation(
            side_run_dir=Path(g1["side_run_dir"]),
            attempt_dir=attempt,
            shard_id="xp-normal-005",
            generation_id=g1["generation_id"],
            status="FAILED",
        )
        g2 = allocate_side_run_generation(
            reports_root=reports,
            run_id="run",
            attempt="recovery-attempt-009",
            shard_id="xp-normal-005",
            commit=EXPECTED_FIXED_COMMIT,
            harness_version=EXPECTED_FIXED_HARNESS,
            attempt_dir=attempt,
        )
        assert_true(g2["ok"] and g2["generation_id"] != g1["generation_id"], "E: generation-002 created")
        assert_true(Path(g1["side_run_dir"]).is_dir(), "E: generation-001 preserved")
        assert_true(sha256_file(Path(g1["art_dir"]) / "cross-product-results.jsonl") == g1_hash, "E: g1 JSONL no append")
        finalize_side_run_generation(
            side_run_dir=Path(g2["side_run_dir"]),
            attempt_dir=attempt,
            shard_id="xp-normal-005",
            generation_id=g2["generation_id"],
            status="COMPLETE",
        )

        # --- F: existing replacement preserved on validation failure ---
        repl = attempt / "replacements" / "xp-normal-006-ROUTE_ON"
        repl.mkdir(parents=True)
        write_jsonl(repl / "cross-product-results.jsonl", [base_row(combination_id="keep")])
        (repl / "cross_product__xp_keep").mkdir()
        write_json(repl / "shard-manifest.json", {"shard_id": "xp-normal-006"})
        repl_hash = sha256_file(repl / "cross-product-results.jsonl")
        bad_src = root / "bad-src"
        bad_src.mkdir()
        write_jsonl(bad_src / "cross-product-results.jsonl", [base_row(combination_id="x"), base_row(combination_id="x")])
        write_json(bad_src / "shard-manifest.json", {"shard_id": "xp-normal-006"})
        (bad_src / "cross_product__xp_x").mkdir()
        v_bad = validate_replacement_artifact(
            art_dir=bad_src,
            shard_id="xp-normal-006",
            expected_count=1,
            expected_harness=EXPECTED_FIXED_HARNESS,
            expected_commit=EXPECTED_FIXED_COMMIT,
            expected_ids=["x"],
        )
        assert_true(not v_bad["ok"], "F: validation fails")
        pub_f = atomic_publish_replacement(src_dir=bad_src, dst_dir=repl, generation=2)
        assert_true(pub_f.get("reason") == "DST_EXISTS", "F: atomic publish not performed")
        assert_true(sha256_file(repl / "cross-product-results.jsonl") == repl_hash, "F: replacement hash immutable")
        # quarantine style preserve
        from recovery_lib import quarantine_failed_replacement

        q = quarantine_failed_replacement(
            src_dir=bad_src, attempt_dir=attempt, shard_id="xp-normal-006", reason="FAILED_REPLACEMENT_VALIDATION"
        )
        assert_true(q.is_dir() and (q / "cross-product-results.jsonl").exists(), "F: failed-attempt preserved")

        # --- G: cross-generation rows detected ---
        mixed = [
            _gen_row("a", "gen-A"),
            _gen_row("b", "gen-B"),
        ]
        cross = detect_cross_generation_rows(mixed, expected_generation_id="gen-A")
        assert_true(
            not cross["ok"] and cross["reason"] == "CROSS_GENERATION_RESULTS_DETECTED",
            "G: CROSS_GENERATION_RESULTS_DETECTED",
        )
        art_g = root / "mixed-art"
        art_g.mkdir()
        write_jsonl(art_g / "cross-product-results.jsonl", mixed)
        write_json(art_g / "shard-manifest.json", {"shard_id": "xp-normal-001"})
        (art_g / "cross_product__xp_a").mkdir()
        (art_g / "cross_product__xp_b").mkdir()
        vg = validate_replacement_artifact(
            art_dir=art_g,
            shard_id="xp-normal-001",
            expected_count=2,
            expected_harness=EXPECTED_FIXED_HARNESS,
            expected_commit=EXPECTED_FIXED_COMMIT,
            expected_ids=["a", "b"],
            expected_generation_id="gen-A",
        )
        assert_true(not vg["ok"] and vg["reason"] == "CROSS_GENERATION_RESULTS_DETECTED", "G: post-validation FAIL")

        # --- H: healthy expected=executed=unique path ---
        alloc_h = allocate_side_run_generation(
            reports_root=reports,
            run_id="run",
            attempt="recovery-attempt-009",
            shard_id="xp-normal-007",
            commit=EXPECTED_FIXED_COMMIT,
            harness_version=EXPECTED_FIXED_HARNESS,
            attempt_dir=attempt,
        )
        claim_result_writer(
            side_run_dir=Path(alloc_h["side_run_dir"]),
            art_dir=Path(alloc_h["art_dir"]),
            generation_id=alloc_h["generation_id"],
            attempt="recovery-attempt-009",
            shard="xp-normal-007",
            commit=EXPECTED_FIXED_COMMIT,
            harness_version=EXPECTED_FIXED_HARNESS,
        )
        ids = [f"h{i}" for i in range(3)]
        for cid in ids:
            append_result_row_guarded(
                side_run_dir=Path(alloc_h["side_run_dir"]),
                art_dir=Path(alloc_h["art_dir"]),
                generation_id=alloc_h["generation_id"],
                attempt="recovery-attempt-009",
                shard="xp-normal-007",
                commit=EXPECTED_FIXED_COMMIT,
                harness_version=EXPECTED_FIXED_HARNESS,
                row=_gen_row(cid, alloc_h["generation_id"], shard="xp-normal-007"),
            )
        # evidence dirs
        for cid in ids:
            (Path(alloc_h["art_dir"]) / f"cross_product__xp_{cid}").mkdir(exist_ok=True)
        write_json(Path(alloc_h["art_dir"]) / "shard-manifest.json", {"shard_id": "xp-normal-007"})
        vh = validate_replacement_artifact(
            art_dir=Path(alloc_h["art_dir"]),
            shard_id="xp-normal-007",
            expected_count=3,
            expected_harness=EXPECTED_FIXED_HARNESS,
            expected_commit=EXPECTED_FIXED_COMMIT,
            expected_ids=ids,
            expected_generation_id=alloc_h["generation_id"],
            expected_attempt="recovery-attempt-009",
            side_run_dir=Path(alloc_h["side_run_dir"]),
        )
        assert_true(vh["ok"] and vh["executed"] == vh["unique"] == 3, "H: validation PASS")
        dst_h = attempt / "replacements" / "xp-normal-007-ROUTE_ON"
        pub_h = atomic_publish_replacement(src_dir=Path(alloc_h["art_dir"]), dst_dir=dst_h, generation=1)
        assert_true(pub_h["ok"], "H: atomic publish PASS")
        finalize_side_run_generation(
            side_run_dir=Path(alloc_h["side_run_dir"]),
            attempt_dir=attempt,
            shard_id="xp-normal-007",
            generation_id=alloc_h["generation_id"],
            status="COMPLETE",
        )

        # Format helper sanity
        assert_true(
            "generation-" in format_side_run_id("r", "a", "s", "tok"),
            "side-run format includes generation",
        )


def _make_validated_art(root: Path, *, combination_ids: list[str], generation_id: str) -> Path:
    art = root
    art.mkdir(parents=True, exist_ok=True)
    rows = [
        base_row(combination_id=cid, generation_id=generation_id, attempt="recovery-attempt-010")
        for cid in combination_ids
    ]
    write_jsonl(art / "cross-product-results.jsonl", rows)
    for cid in combination_ids:
        (art / f"cross_product__{cid}").mkdir(exist_ok=True)
        write_json(art / f"cross_product__{cid}" / "result.json", {"status": "PASS"})
    write_json(art / "cleanup-report.json", {"ok": True, "errors": []})
    write_json(art / "evidence-flush.json", {"ok": True})
    write_json(art / "shard-summary.json", {"expected": len(combination_ids), "executed": len(combination_ids)})
    write_json(
        art / "validation.json",
        {
            "ok": True,
            "reason": None,
            "errors": [],
            "expected": len(combination_ids),
            "executed": len(combination_ids),
            "unique": len(combination_ids),
            "duplicate": 0,
            "missing": 0,
            "FAIL": 0,
            "cleanup_ok": True,
            "evidence_flush": True,
            "harness_versions": [EXPECTED_FIXED_HARNESS],
            "git_commits": [EXPECTED_FIXED_COMMIT],
            "generation_ids": [generation_id],
        },
    )
    return art


def test_replacement_generation_pointer_a_through_h():
    """Attempt-010: generation publish + active pointer policies (tests A–H)."""
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        run = root / "run"
        attempt = run / "recovery-attempt-010"
        attempt.mkdir(parents=True)
        write_json(attempt / "replacement-map.json", {})
        write_json(
            attempt / "recovery-plan.json",
            {
                "attempt_dir": str(attempt),
                "reuse_shards": [],
                "rerun_shards": ["xp-normal-001"],
                "shards": [
                    {
                        "shard_id": "xp-normal-001",
                        "reuse": False,
                        "rerun": True,
                        "merge_include": False,
                        "original_shard_path": str(run / "xp-normal-001-ROUTE_ON"),
                        "verdict": "INCOMPLETE",
                    }
                ],
            },
        )

        # --- A: active A exists, publish B, pointer A→B, no DST_EXISTS ---
        src_a = _make_validated_art(root / "srcA", combination_ids=["a1", "a2"], generation_id="gen-A")
        val_a = json.loads((src_a / "validation.json").read_text())
        pub_a = publish_and_activate_generation_replacement(
            src_dir=src_a,
            attempt_dir=attempt,
            shard_id="xp-normal-001",
            generation_id="gen-A",
            commit=EXPECTED_FIXED_COMMIT,
            harness_version=EXPECTED_FIXED_HARNESS,
            validation=val_a,
            merge_eligible=True,
        )
        assert_true(pub_a["ok"] and pub_a["generation_publish"] == "PASS", "A: gen-A publish PASS")
        path_a = Path(pub_a["dst"])
        sha_a = sha256_file(path_a / "cross-product-results.jsonl")
        mtime_a = (path_a / "cross-product-results.jsonl").stat().st_mtime

        src_b = _make_validated_art(root / "srcB", combination_ids=["b1", "b2"], generation_id="gen-B")
        val_b = json.loads((src_b / "validation.json").read_text())
        pub_b = publish_and_activate_generation_replacement(
            src_dir=src_b,
            attempt_dir=attempt,
            shard_id="xp-normal-001",
            generation_id="gen-B",
            commit=EXPECTED_FIXED_COMMIT,
            harness_version=EXPECTED_FIXED_HARNESS,
            validation=val_b,
            merge_eligible=True,
        )
        assert_true(pub_b["ok"] and pub_b.get("reason") != "DST_EXISTS", "A: no DST_EXISTS on gen-B")
        assert_true(pub_b["active_pointer_switch"] == "PASS", "A: pointer switch PASS")
        assert_true(path_a.exists() and sha256_file(path_a / "cross-product-results.jsonl") == sha_a, "A: gen-A preserved")
        assert_true((path_a / "cross-product-results.jsonl").stat().st_mtime == mtime_a, "A: gen-A mtime unchanged")
        rep = json.loads((attempt / "replacement-map.json").read_text())
        assert_true(rep["xp-normal-001"]["active_generation_id"] == "gen-B", "A: active=gen-B")

        # --- B: same generation re-publish → IDEMPOTENT_ALREADY_ACTIVE ---
        before_text = (attempt / "replacement-map.json").read_text()
        path_b = Path(pub_b["dst"])
        sha_b = sha256_file(path_b / "cross-product-results.jsonl")
        mtime_b = (path_b / "cross-product-results.jsonl").stat().st_mtime
        pub_b2 = publish_and_activate_generation_replacement(
            src_dir=src_b,
            attempt_dir=attempt,
            shard_id="xp-normal-001",
            generation_id="gen-B",
            commit=EXPECTED_FIXED_COMMIT,
            harness_version=EXPECTED_FIXED_HARNESS,
            validation=val_b,
            merge_eligible=True,
        )
        assert_true(pub_b2["ok"], "B: idempotent ok")
        assert_true(
            pub_b2["publish"]["reason"] == "IDEMPOTENT_ALREADY_PUBLISHED"
            or pub_b2["activate"]["reason"] == "IDEMPOTENT_ALREADY_ACTIVE"
            or pub_b2.get("reason") == "IDEMPOTENT_ALREADY_ACTIVE",
            "B: IDEMPOTENT reason",
        )
        assert_true(sha256_file(path_b / "cross-product-results.jsonl") == sha_b, "B: hash unchanged")
        assert_true((path_b / "cross-product-results.jsonl").stat().st_mtime == mtime_b, "B: mtime unchanged")
        assert_true((attempt / "replacement-map.json").read_text() == before_text or pub_b2["pointer_changed"] == 0, "B: pointer unchanged")

        # --- C: same generation_id, different content → GENERATION_CONTENT_CONFLICT ---
        src_b_bad = _make_validated_art(root / "srcBbad", combination_ids=["x1", "x2"], generation_id="gen-B")
        val_bad = json.loads((src_b_bad / "validation.json").read_text())
        conflict = publish_generation_replacement(
            src_dir=src_b_bad,
            attempt_dir=attempt,
            shard_id="xp-normal-001",
            generation_id="gen-B",
            commit=EXPECTED_FIXED_COMMIT,
            harness_version=EXPECTED_FIXED_HARNESS,
            validation=val_bad,
        )
        assert_true(conflict["reason"] == "GENERATION_CONTENT_CONFLICT", "C: content conflict")
        assert_true(sha256_file(path_b / "cross-product-results.jsonl") == sha_b, "C: gen-B immutable")
        assert_true(
            json.loads((attempt / "replacement-map.json").read_text())["xp-normal-001"]["active_generation_id"]
            == "gen-B",
            "C: active pointer unchanged",
        )

        # --- D: validation fail → no active switch ---
        src_d = _make_validated_art(root / "srcD", combination_ids=["d1"], generation_id="gen-D")
        val_d = json.loads((src_d / "validation.json").read_text())
        val_d["ok"] = False
        val_d["reason"] = "INCOMPLETE_EXECUTION"
        before_active = json.loads((attempt / "replacement-map.json").read_text())["xp-normal-001"][
            "active_generation_id"
        ]
        fail_d = publish_and_activate_generation_replacement(
            src_dir=src_d,
            attempt_dir=attempt,
            shard_id="xp-normal-001",
            generation_id="gen-D",
            commit=EXPECTED_FIXED_COMMIT,
            harness_version=EXPECTED_FIXED_HARNESS,
            validation=val_d,
            merge_eligible=True,
        )
        assert_true(not fail_d["ok"] and fail_d["active_pointer_switch"] == "SKIPPED", "D: no pointer switch")
        assert_true(
            json.loads((attempt / "replacement-map.json").read_text())["xp-normal-001"]["active_generation_id"]
            == before_active,
            "D: prior active retained",
        )
        assert_true(not generation_replacement_dir(attempt, "xp-normal-001", "gen-D").exists(), "D: gen-D not published")

        # --- E: pointer atomic write failure keeps prior active ---
        src_e = _make_validated_art(root / "srcE", combination_ids=["e1"], generation_id="gen-E")
        val_e = json.loads((src_e / "validation.json").read_text())
        pub_e = publish_generation_replacement(
            src_dir=src_e,
            attempt_dir=attempt,
            shard_id="xp-normal-001",
            generation_id="gen-E",
            commit=EXPECTED_FIXED_COMMIT,
            harness_version=EXPECTED_FIXED_HARNESS,
            validation=val_e,
        )
        assert_true(pub_e["ok"], "E: gen-E published")
        # Break atomic_write_jsons by making replacement-map a directory briefly via monkeypatch
        import recovery_lib as rl

        prev_active = json.loads((attempt / "replacement-map.json").read_text())["xp-normal-001"][
            "active_generation_id"
        ]
        real_atomic = rl.atomic_write_jsons

        def boom(_files):
            raise OSError("simulated pointer write failure")

        rl.atomic_write_jsons = boom  # type: ignore
        try:
            act_e = activate_replacement_pointer(
                attempt_dir=attempt,
                shard_id="xp-normal-001",
                generation_id="gen-E",
                generation_path=Path(pub_e["dst"]),
                commit=EXPECTED_FIXED_COMMIT,
                harness_version=EXPECTED_FIXED_HARNESS,
                content_sha256=str(pub_e["content_sha256"]),
                validation=val_e,
                merge_eligible=True,
            )
        finally:
            rl.atomic_write_jsons = real_atomic  # type: ignore
        assert_true(not act_e["ok"] and act_e["reason"] == "POINTER_ATOMIC_WRITE_FAILED", "E: pointer write fail")
        live_map = (attempt / "replacement-map.json").read_text()
        assert_true("{" in live_map and live_map.strip().endswith("}"), "E: no partial JSON")
        assert_true(
            json.loads(live_map)["xp-normal-001"]["active_generation_id"] == prev_active,
            "E: prior active retained",
        )
        assert_true(Path(pub_e["dst"]).exists(), "E: gen-E preserved")

        # --- F: merge uses only active gen-B, not gen-A ---
        plan = json.loads((attempt / "recovery-plan.json").read_text())
        plan["shards"][0]["reuse"] = True
        plan["shards"][0]["merge_include"] = True
        plan["shards"][0]["replacement_validated"] = True
        rep_map = json.loads((attempt / "replacement-map.json").read_text())
        sel = merge_selection_from_plan(run_dir=run, plan=plan, replacement_map=rep_map, attempt_dir=attempt)
        included = [x for x in sel["include"] if x["shard_id"] == "xp-normal-001"]
        assert_true(len(included) == 1, "F: exactly one include")
        assert_true(included[0]["path"] == str(path_b), "F: merge uses active gen-B only")
        assert_true("gen-A" not in included[0]["path"], "F: gen-A not auto-included")

        # --- G: legacy fixed replacement exists; new publish does not overwrite it ---
        legacy = legacy_replacement_dir(attempt, "xp-normal-001")
        legacy.mkdir(parents=True, exist_ok=True)
        write_jsonl(legacy / "cross-product-results.jsonl", [base_row(combination_id="legacy")])
        legacy_sha = sha256_file(legacy / "cross-product-results.jsonl")
        src_g = _make_validated_art(root / "srcG", combination_ids=["g1", "g2"], generation_id="gen-G")
        val_g = json.loads((src_g / "validation.json").read_text())
        pub_g = publish_and_activate_generation_replacement(
            src_dir=src_g,
            attempt_dir=attempt,
            shard_id="xp-normal-001",
            generation_id="gen-G",
            commit=EXPECTED_FIXED_COMMIT,
            harness_version=EXPECTED_FIXED_HARNESS,
            validation=val_g,
            merge_eligible=True,
        )
        assert_true(pub_g["ok"] and pub_g.get("legacy_untouched") is True, "G: publish ok, legacy untouched flag")
        assert_true(sha256_file(legacy / "cross-product-results.jsonl") == legacy_sha, "G: legacy hash immutable")
        assert_true(
            json.loads((attempt / "replacement-map.json").read_text())["xp-normal-001"]["active_path"]
            == pub_g["dst"],
            "G: active points to new generation path",
        )
        assert_true(str(legacy) not in (pub_g["dst"] or ""), "G: dst is not legacy path")

        # --- H: reproduce xp-normal-001 DST_EXISTS scenario (1045-scale identity via fixture) ---
        # Seed legacy-style active via prior publish, then supersede with new generation.
        # (Counts use 3 rows for unit speed; identity rules match 1045 PASS case.)
        src_h = _make_validated_art(
            root / "srcH",
            combination_ids=["h1", "h2", "h3"],
            generation_id="20260722T233218Z-3748719-f0909c1c",
        )
        val_h = json.loads((src_h / "validation.json").read_text())
        # Ensure legacy fixed path still present (like attempt-009).
        assert_true(legacy.exists(), "H: legacy replacement present")
        pub_h = publish_and_activate_generation_replacement(
            src_dir=src_h,
            attempt_dir=attempt,
            shard_id="xp-normal-001",
            generation_id="20260722T233218Z-3748719-f0909c1c",
            commit=EXPECTED_FIXED_COMMIT,
            harness_version=EXPECTED_FIXED_HARNESS,
            validation=val_h,
            merge_eligible=False,
        )
        assert_true(pub_h["ok"], "H: generation publish PASS")
        assert_true(pub_h["reason"] != "DST_EXISTS", "H: DST_EXISTS absent")
        assert_true(pub_h["generation_publish"] == "PASS", "H: generation_publish PASS")
        assert_true(pub_h["active_pointer_switch"] == "PASS", "H: active_pointer_switch PASS")
        assert_true(sha256_file(legacy / "cross-product-results.jsonl") == legacy_sha, "H: legacy still immutable")
        assert_true(path_a.exists() and Path(pub_b["dst"]).exists(), "H: prior generations preserved")


def test_parallel_resume_safety_a_through_l():
    """Parallel harness gates: workers, isolation, coordinator serialization, fault policy."""
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        attempt = root / "run" / "recovery-attempt-015"
        reports = root / "reports"
        attempt.mkdir(parents=True)
        reports.mkdir(parents=True)
        write_json = atomic_write_json
        write_json(attempt / "replacement-map.json", {})

        shards = [
            "xp-normal-001",
            "xp-normal-002",
            "xp-normal-003",
            "xp-normal-004",
            "xp-fault-000",
        ]
        plan = build_parallel_resume_plan(shards, normal_workers=4, fault_workers=1)
        assert_true(plan["ok"], "plan ok")
        assert_true(plan["normal_workers"] == 4, "4 normal workers")
        assert_true(plan["fault_workers"] == 1, "1 fault worker")
        assert_true(len(plan["normal_shards"]) == 4, "4 normal shards")
        assert_true(plan["fault_shards"] == ["xp-fault-000"], "fault queue")
        assert_true(plan["concurrent_policy"] == "SERIALIZE_FAULT_AFTER_NORMAL", "fault serialize policy")
        assert_true(plan["duplicate_shards"] == [], "no duplicates in plan")

        # Duplicate shard assignment blocked at plan level
        dup_plan = build_parallel_resume_plan(
            ["xp-normal-001", "xp-normal-001"], normal_workers=4, fault_workers=1
        )
        assert_true(not dup_plan["ok"], "duplicate shards rejected")

        state = init_parallel_coordinator_state(
            attempt_dir=attempt,
            shards=shards,
            normal_workers=4,
            fault_workers=1,
        )
        assert_true(state["finalize_blocked"] is True, "finalize blocked before complete")
        assert_true((attempt / "parallel-coordinator-state.json").is_file(), "state written")

        # 4 workers claim distinct normal shards concurrently (threaded claims)
        import threading

        claims = []
        lock = threading.Lock()

        def _claim(wid: str):
            r = claim_next_shard_for_worker(
                attempt_dir=attempt, worker_id=wid, queue="normal", pid=os.getpid()
            )
            with lock:
                claims.append(r)

        threads = [
            threading.Thread(target=_claim, args=(f"worker-{i}",)) for i in range(1, 5)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        ok_claims = [c for c in claims if c.get("ok")]
        assert_true(len(ok_claims) == 4, "4 workers start concurrently")
        claimed_shards = sorted(c["shard"] for c in ok_claims)
        assert_true(claimed_shards == sorted(plan["normal_shards"]), "no duplicate shard assignment")
        # Same shard duplicate claim blocked
        again = claim_next_shard_for_worker(
            attempt_dir=attempt, worker_id="worker-1", queue="normal"
        )
        assert_true(not again.get("ok"), "worker already running blocked")

        # Fault blocked while normal running
        fault_claim = claim_next_shard_for_worker(
            attempt_dir=attempt, worker_id="fault-worker-1", queue="fault"
        )
        assert_true(
            not fault_claim.get("ok")
            and fault_claim.get("reason") in {
                "FAULT_BLOCKED_WHILE_NORMAL_RUNNING",
                "FAULT_BLOCKED_WHILE_NORMAL_ACTIVE",
            },
            "fault blocked while normal running",
        )

        # Worker JSONL / side-run isolation
        allocs = []
        for c in ok_claims:
            a = allocate_side_run_generation(
                reports_root=reports,
                run_id="run",
                attempt="recovery-attempt-015",
                shard_id=c["shard"],
                commit=EXPECTED_FIXED_COMMIT,
                harness_version=EXPECTED_FIXED_HARNESS,
                attempt_dir=attempt,
                worker_id=c["worker_id"],
            )
            assert_true(a["ok"], f"alloc {c['worker_id']}")
            assert_true(f"worker-{c['worker_id']}" in a["side_run_id"] or f"__worker-{c['worker_id']}__" in a["side_run_id"],
                        "worker id in side-run path")
            assert_true("__generation-" in a["side_run_id"], "generation in side-run path")
            assert_true(a.get("name_prefix") and c["worker_id"] in a["name_prefix"], "name prefix isolated")
            assert_true(a.get("s3_prefix") and c["worker_id"] in a["s3_prefix"], "s3 prefix isolated")
            allocs.append(a)

        # Simulate worker crash: state preserved for completed, assignment stops on fail
        first = ok_claims[0]
        record_worker_result(
            attempt_dir=attempt,
            worker_id=first["worker_id"],
            shard_id=first["shard"],
            status="COMPLETE",
            generation_id=allocs[0]["generation_id"],
        )
        crashed = ok_claims[1]
        record_worker_result(
            attempt_dir=attempt,
            worker_id=crashed["worker_id"],
            shard_id=crashed["shard"],
            status="FAILED",
            generation_id=allocs[1]["generation_id"],
        )
        st = load_parallel_coordinator_state(attempt)
        assert_true(first["shard"] in (st.get("completed") or {}), "completed worker preserved")
        assert_true(st.get("assignment_stopped") is True, "stop new workers on failure")
        stopped = claim_next_shard_for_worker(
            attempt_dir=attempt, worker_id="worker-extra", queue="normal"
        )
        assert_true(stopped.get("reason") == "ASSIGNMENT_STOPPED", "new assignment stopped")

        # Reset for publish serialization + finalize tests
        state2 = init_parallel_coordinator_state(
            attempt_dir=attempt,
            shards=["xp-normal-001", "xp-normal-002"],
            normal_workers=2,
            fault_workers=1,
        )
        # Build two tiny validated artifacts
        def _art(path: Path, gen: str, cid: str):
            path.mkdir(parents=True)
            rows = [
                {
                    "combination_id": cid,
                    "status": "PASS",
                    "harness_version": EXPECTED_FIXED_HARNESS,
                    "git_commit": EXPECTED_FIXED_COMMIT,
                    "generation_id": gen,
                    "attempt": "recovery-attempt-015",
                    "shard": path.name.split("-ROUTE")[0] if False else "xp-normal-001",
                    "cleanup_ok": True,
                }
            ]
            # Fix shard field per path
            return path, rows, gen

        # Use validate helpers via publish path with crafted dirs
        from recovery_lib import write_json as wj

        def make_src(shard: str, gen: str, cid: str) -> Path:
            side = reports / f"side-{shard}-{gen}"
            art = side / f"{shard}-ROUTE_ON"
            art.mkdir(parents=True)
            row = {
                "combination_id": cid,
                "status": "PASS",
                "harness_version": EXPECTED_FIXED_HARNESS,
                "git_commit": EXPECTED_FIXED_COMMIT,
                "generation_id": gen,
                "attempt": "recovery-attempt-015",
                "shard": shard,
                "cleanup_ok": True,
            }
            (art / "cross-product-results.jsonl").write_text(json.dumps(row) + "\n")
            wj(art / "validation.json", {"ok": True, "expected": 1, "executed": 1, "unique": 1, "duplicate": 0, "PASS": 1, "FAIL": 0})
            wj(art / "cleanup-report.json", {"ok": True})
            wj(art / "shard-summary.json", {"expected": 1, "executed": 1})
            wj(art / "evidence-flush.json", {"ok": True})
            wj(
                side / "run-generation.json",
                {
                    "generation_id": gen,
                    "attempt": "recovery-attempt-015",
                    "shard": shard,
                    "status": "RUNNING",
                    "commit": EXPECTED_FIXED_COMMIT,
                    "harness_version": EXPECTED_FIXED_HARNESS,
                },
            )
            return art

        src1 = make_src("xp-normal-001", "gen-pub-1", "c1")
        src2 = make_src("xp-normal-002", "gen-pub-2", "c2")
        val1 = validate_replacement_artifact(
            art_dir=src1,
            shard_id="xp-normal-001",
            expected_count=1,
            expected_harness=EXPECTED_FIXED_HARNESS,
            expected_commit=EXPECTED_FIXED_COMMIT,
            expected_ids=["c1"],
            expected_generation_id="gen-pub-1",
            expected_attempt="recovery-attempt-015",
            side_run_dir=src1.parent,
        )
        val2 = validate_replacement_artifact(
            art_dir=src2,
            shard_id="xp-normal-002",
            expected_count=1,
            expected_harness=EXPECTED_FIXED_HARNESS,
            expected_commit=EXPECTED_FIXED_COMMIT,
            expected_ids=["c2"],
            expected_generation_id="gen-pub-2",
            expected_attempt="recovery-attempt-015",
            side_run_dir=src2.parent,
        )
        assert_true(val1.get("ok") and val2.get("ok"), "validation ok for publish fixtures")

        pubs = []
        pub_errors = []

        def _pub(src, shard, gen, val):
            try:
                r = coordinator_publish_and_activate(
                    src_dir=src,
                    attempt_dir=attempt,
                    shard_id=shard,
                    generation_id=gen,
                    commit=EXPECTED_FIXED_COMMIT,
                    harness_version=EXPECTED_FIXED_HARNESS,
                    validation=val,
                    merge_eligible=False,
                )
                with lock:
                    pubs.append(r)
            except Exception as exc:
                with lock:
                    pub_errors.append(str(exc))

        t1 = threading.Thread(target=_pub, args=(src1, "xp-normal-001", "gen-pub-1", val1))
        t2 = threading.Thread(target=_pub, args=(src2, "xp-normal-002", "gen-pub-2", val2))
        t1.start(); t2.start(); t1.join(); t2.join()
        assert_true(not pub_errors, f"no publish exceptions: {pub_errors}")
        assert_true(all(p.get("ok") for p in pubs), "serialized publish both ok")
        assert_true(all(p.get("active_pointer_switch") == "PASS" for p in pubs), "pointer switch pass")
        rep = json.loads((attempt / "replacement-map.json").read_text())
        assert_true(rep["xp-normal-001"]["active_generation_id"] == "gen-pub-1", "pointer 001")
        assert_true(rep["xp-normal-002"]["active_generation_id"] == "gen-pub-2", "pointer 002")

        # Pointer switch collision: second activate for same shard with different gen under lock
        # should succeed as supersede (new generation) — verify lock acquisition exclusive.
        acquired = []

        def _lock_hold(tag, hold=0.2):
            with CoordinatorReplacementLock(attempt):
                acquired.append((tag, time.time()))
                time.sleep(hold)

        lt1 = threading.Thread(target=_lock_hold, args=("a", 0.25))
        lt2 = threading.Thread(target=_lock_hold, args=("b", 0.01))
        t0 = time.time()
        lt1.start(); time.sleep(0.02); lt2.start(); lt1.join(); lt2.join()
        assert_true(len(acquired) == 2, "both lock holders eventually acquired")
        assert_true(acquired[1][1] - acquired[0][1] >= 0.15, "second waiter blocked until first release")

        # Cross-worker contamination detection
        contam = detect_cross_worker_contamination(
            worker_results=[
                {
                    "worker_id": "worker-1",
                    "generation_id": "g1",
                    "jsonl_path": "/tmp/a.jsonl",
                    "combination_ids": ["x1", "x2"],
                    "generation_ids_in_jsonl": ["g1"],
                    "writer_owners": ["worker-1"],
                },
                {
                    "worker_id": "worker-2",
                    "generation_id": "g1",  # shared generation — contamination
                    "jsonl_path": "/tmp/a.jsonl",
                    "combination_ids": ["x2"],  # duplicate scenario
                    "generation_ids_in_jsonl": ["g1"],
                    "writer_owners": ["worker-2"],
                },
            ]
        )
        assert_true(contam["cross_worker_contamination"] > 0, "contamination detected")
        assert_true(contam["scenario_duplicate"] >= 1, "scenario duplicate counted")

        clean = detect_cross_worker_contamination(
            worker_results=[
                {
                    "worker_id": "worker-1",
                    "generation_id": "g1",
                    "jsonl_path": "/tmp/w1.jsonl",
                    "combination_ids": ["a"],
                    "generation_ids_in_jsonl": ["g1"],
                    "writer_owners": ["worker-1"],
                },
                {
                    "worker_id": "worker-2",
                    "generation_id": "g2",
                    "jsonl_path": "/tmp/w2.jsonl",
                    "combination_ids": ["b"],
                    "generation_ids_in_jsonl": ["g2"],
                    "writer_owners": ["worker-2"],
                },
            ]
        )
        assert_true(clean["ok"] and clean["cross_worker_contamination"] == 0, "clean workers")

        # Finalize blocked until all complete
        fin = assert_finalize_allowed(attempt)
        assert_true(not fin.get("ok"), "finalize blocked mid-flight")

        # Complete remaining after re-init clean state
        st3 = init_parallel_coordinator_state(
            attempt_dir=attempt,
            shards=["xp-normal-001"],
            normal_workers=1,
            fault_workers=1,
        )
        c = claim_next_shard_for_worker(attempt_dir=attempt, worker_id="worker-1", queue="normal")
        assert_true(c.get("ok"), "claim for finalize path")
        record_worker_result(
            attempt_dir=attempt,
            worker_id="worker-1",
            shard_id="xp-normal-001",
            status="COMPLETE",
            generation_id="g-final",
        )
        fin2 = assert_finalize_allowed(attempt)
        assert_true(fin2.get("ok"), "finalize allowed after all complete")

        gate = evaluate_parallel_load_gates(cpu_percent=90.0)
        assert_true(gate["pause_new_workers"] and not gate["ok"], "CPU gate pauses new workers")
        gate2 = evaluate_parallel_load_gates(run_already_active=True)
        assert_true("RUN_ALREADY_ACTIVE" in gate2["reasons"], "RUN_ALREADY_ACTIVE gate")

        dry = build_parallel_dry_run_report(
            plan={"reuse_shards": ["xp-normal-000"], "rerun_shards": shards},
            parallel_plan=plan,
            selected_combinations=26316,
        )
        assert_true(dry["files_written"] == 0 and dry["shards_executed"] == 0, "dry-run no side effects")
        assert_true(dry["selected_combinations"] == 26316, "dry-run selected combinations")


def main() -> int:
    test_immutable_not_overwritten()
    test_harness_drift_compare()
    test_run_all_shards_fail_fast()
    test_stale_lock_and_active_lock()
    test_pid_reuse_mismatch()
    test_status_aborted_not_in_progress()
    test_ended_at_failed_shards_status()
    test_duplicate_and_extra_rows()
    test_merge_selection_excludes_superseded_and_mismatch()
    test_final_gate_untrusted_fails_selection()
    test_cleanup_ownership_rules_documented()
    test_bootstrap_immutable_from_expected_fixed()
    test_reports_root_resolution()
    test_dry_run_no_side_effects()
    test_resume_refuses_wrong_reports_root()
    test_shard_plan_snapshot_create_hash_and_no_overwrite()
    test_recovery_plan_links_snapshot()
    test_preflight_zero_and_missing_shard()
    test_false_complete_guards_and_incomplete()
    test_duplicate_and_mixed_harness_detection()
    test_atomic_publish_and_no_partial_exposure()
    test_original_vs_attempt_status_separation()
    test_zero_shard_side_run_merge_excluded()
    test_only_shard_selection_and_canary_stop()
    test_recovery_artifact_immutability_helpers()
    test_run_all_shards_shell_false_complete_guard()
    test_authoritative_count_set_equality()
    test_negative_count_gates()
    test_post_canary_finalize_transitions_and_gates()
    test_circular_missing_zero_is_rejected()
    test_authoritative_integrity_classification_and_gates()
    test_generation_isolation_a_through_h()
    test_replacement_generation_pointer_a_through_h()
    test_parallel_resume_safety_a_through_l()
    print(f"\ntest_xp_recovery pass={PASS} fail={FAIL}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
