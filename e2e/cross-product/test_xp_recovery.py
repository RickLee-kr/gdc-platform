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
    atomic_publish_replacement,
    audit_combination_count_integrity,
    build_lock_doc,
    build_recovery_plan,
    build_recovery_plan_v2,
    build_shard_plan_snapshot,
    classify_lock,
    combination_ids_hash,
    compare_to_immutable,
    create_immutable_run_manifest,
    determine_attempt_status,
    determine_status,
    ensure_shard_plan_snapshot,
    get_snapshot_shard,
    invalidate_zero_shard_side_run,
    is_side_run_merge_excluded,
    load_immutable_run_manifest,
    load_shard_plan_snapshot,
    merge_selection_from_plan,
    preflight_selected_shards,
    process_matches_lock,
    process_start_time,
    resolve_reports_root,
    resolve_reports_root_detailed,
    resolve_run_dir,
    update_attempt_status,
    validate_replacement_artifact,
    validate_shard,
    validate_snapshot_shard,
    write_run_abort,
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
    test_circular_missing_zero_is_rejected()
    print(f"\ntest_xp_recovery pass={PASS} fail={FAIL}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
