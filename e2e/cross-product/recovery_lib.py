#!/usr/bin/env python3
"""Cross-Product E2E recovery helpers: immutable manifest, lock/status, shard trust, plans."""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

EXPECTED_FIXED_HARNESS = (
    "009daf57881a515e73d7ef388eb1bd9bdd6e82bb2a9166fe3479b50bf5e2e307"
)
EXPECTED_FIXED_COMMIT = "42c4092270af0c789327d218cd805766f7317bdd"

IMMUTABLE_FIELDS = (
    "run_id",
    "git_commit",
    "harness_version",
    "manifest_hash",
    "applicability_rules_hash",
    "axes_hash",
    "executor_hash",
    "driver_hash",
    "spec_hash",
    "oracle_hash",
    "fixture_hash",
    "route_runtime",
    "started_at",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def default_repo_reports_root(repo_root: Optional[Path] = None) -> Path:
    """Repository-local default: <repo>/e2e/reports."""
    root = Path(repo_root) if repo_root else Path(__file__).resolve().parents[2]
    return (root / "e2e" / "reports").resolve()


def resolve_reports_root_detailed(
    cli_value: Optional[str] = None,
    *,
    env: Optional[dict[str, str]] = None,
    repo_root: Optional[Path] = None,
) -> tuple[Path, str]:
    """Resolve reports root with priority: CLI > GDC_E2E_REPORTS_ROOT > repo default.

    Returns (absolute_path, source) where source is cli|env|default.
    Does not create the directory. Expands ~ and normalizes to an absolute path.
    """
    env_map = env if env is not None else os.environ
    if cli_value is not None and str(cli_value).strip():
        raw = str(cli_value).strip()
        source = "cli"
    elif str(env_map.get("GDC_E2E_REPORTS_ROOT") or "").strip():
        raw = str(env_map["GDC_E2E_REPORTS_ROOT"]).strip()
        source = "env"
    else:
        return default_repo_reports_root(repo_root), "default"

    path = Path(os.path.expanduser(raw)).expanduser()
    if not path.is_absolute():
        # Relative paths resolve against the caller's cwd (operator intent).
        path = (Path.cwd() / path).resolve()
    else:
        path = path.resolve()
    return path, source


def resolve_reports_root(
    cli_value: Optional[str] = None,
    *,
    env: Optional[dict[str, str]] = None,
    repo_root: Optional[Path] = None,
) -> Path:
    return resolve_reports_root_detailed(cli_value, env=env, repo_root=repo_root)[0]


def resolve_run_dir(
    run_id: str,
    *,
    reports_root: Optional[Path] = None,
    cli_reports_root: Optional[str] = None,
    repo_root: Optional[Path] = None,
    must_exist: bool = True,
) -> Path:
    root = reports_root or resolve_reports_root(cli_reports_root, repo_root=repo_root)
    run_dir = (root / run_id).resolve()
    if must_exist and not run_dir.is_dir():
        raise FileNotFoundError(
            f"run dir missing: {run_dir} (reports_root={root})"
        )
    return run_dir


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def write_json(path: Path, doc: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=2) + "\n")


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compute_harness_version(
    *,
    root: Path,
    commit: str,
    gen_dir: Optional[Path] = None,
) -> dict[str, str]:
    xp = root / "e2e" / "cross-product"
    e2e = root / "e2e"
    gen = gen_dir or (xp / "generated")
    files = {
        "executor_hash": xp / "cross-product-executor.ts",
        "driver_hash": e2e / "framework" / "data-relay-driver.ts",
        "spec_hash": xp / "matrix" / "cross-product.spec.ts",
        "oracle_hash": xp / "oracle.ts",
        "fixture_hash": xp / "fixtures" / "composite-chain-fixture.ts",
    }
    hashes = {k: sha256_file(p) for k, p in files.items()}
    summary = read_json(gen / "generation-summary.json", {}) or {}
    manifest_hash = str(summary.get("manifest_hash") or "")
    rules_hash = str(summary.get("applicability_rules_hash") or "")
    axes_hash = str(summary.get("axes_hash") or "")
    harness_version = hashlib.sha256(
        "\n".join(
            [
                hashes["executor_hash"],
                hashes["driver_hash"],
                hashes["spec_hash"],
                hashes["oracle_hash"],
                hashes["fixture_hash"],
                commit,
                manifest_hash,
                rules_hash,
                axes_hash,
            ]
        ).encode()
    ).hexdigest()
    return {
        **hashes,
        "git_commit": commit,
        "manifest_hash": manifest_hash,
        "applicability_rules_hash": rules_hash,
        "axes_hash": axes_hash,
        "harness_version": harness_version,
    }


# ---------------------------------------------------------------------------
# Process / lock identity
# ---------------------------------------------------------------------------


def process_start_time(pid: int) -> Optional[str]:
    try:
        stat = Path(f"/proc/{pid}/stat").read_text()
        # comm may contain spaces/parens; starttime is field 22 after ") ".
        rest = stat.split(")", 1)[1].strip().split()
        return rest[19]  # 22nd field overall → index 19 after state
    except Exception:
        return None


def process_cmdline(pid: int) -> Optional[str]:
    try:
        raw = Path(f"/proc/{pid}/cmdline").read_bytes()
        return raw.replace(b"\x00", b" ").decode("utf-8", errors="replace").strip()
    except Exception:
        return None


def pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def process_matches_lock(lock: dict[str, Any]) -> bool:
    """True only if PID is alive AND identity matches lock metadata when present."""
    try:
        pid = int(lock.get("pid") or 0)
    except (TypeError, ValueError):
        return False
    if not pid_alive(pid):
        return False
    expected_start = lock.get("process_start_time")
    if expected_start:
        actual = process_start_time(pid)
        if actual is None or str(actual) != str(expected_start):
            return False
    expected_cmd = lock.get("command")
    if expected_cmd:
        actual_cmd = process_cmdline(pid) or ""
        # Require substantial overlap; PID reuse with unrelated command → mismatch.
        token = "xp-full-recovery-orchestrator"
        if token in str(expected_cmd) and token not in actual_cmd:
            return False
    return True


def build_lock_doc(run_id: str, pid: int, lock_file: str) -> dict[str, Any]:
    return {
        "run_id": run_id,
        "pid": pid,
        "process_start_time": process_start_time(pid),
        "acquired_at": utc_now(),
        "command": process_cmdline(pid) or f"pid={pid}",
        "lock_file": lock_file,
    }


def classify_lock(lock_path: Path) -> dict[str, Any]:
    if not lock_path.exists():
        return {"lock_status": "ABSENT", "lock": None, "owner_alive": False}
    lock = read_json(lock_path, {}) or {}
    alive = process_matches_lock(lock)
    if alive:
        return {"lock_status": "HELD_ACTIVE", "lock": lock, "owner_alive": True}
    if lock.get("pid") and pid_alive(int(lock["pid"])) and not alive:
        return {
            "lock_status": "PID_REUSED_MISMATCH",
            "lock": lock,
            "owner_alive": False,
        }
    return {"lock_status": "STALE_LOCK", "lock": lock, "owner_alive": False}


# ---------------------------------------------------------------------------
# Immutable run manifest
# ---------------------------------------------------------------------------


def immutable_manifest_path(run_dir: Path) -> Path:
    return run_dir / "immutable-run-manifest.json"


def create_immutable_run_manifest(run_dir: Path, doc: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """Create immutable manifest once. Returns (doc, created). Never overwrites."""
    path = immutable_manifest_path(run_dir)
    if path.exists():
        return read_json(path, {}), False
    out = {k: doc.get(k) for k in IMMUTABLE_FIELDS}
    out["immutable"] = True
    out["created_at"] = utc_now()
    write_json(path, out)
    return out, True


def load_immutable_run_manifest(
    run_dir: Path,
    *,
    allow_bootstrap_write: bool = True,
) -> Optional[dict[str, Any]]:
    path = immutable_manifest_path(run_dir)
    if path.exists():
        return read_json(path)
    # Bootstrap from expected-fixed-harness.json for legacy runs (never overwrite sources).
    expected = read_json(run_dir / "expected-fixed-harness.json")
    if expected and expected.get("harness_version"):
        boot = {
            "run_id": run_dir.name,
            "git_commit": expected.get("git_commit") or EXPECTED_FIXED_COMMIT,
            "harness_version": expected.get("harness_version"),
            "manifest_hash": expected.get("manifest_hash"),
            "applicability_rules_hash": expected.get("applicability_rules_hash"),
            "axes_hash": expected.get("axes_hash"),
            "executor_hash": expected.get("executor_hash"),
            "driver_hash": expected.get("driver_hash"),
            "spec_hash": expected.get("spec_hash"),
            "oracle_hash": expected.get("oracle_hash"),
            "fixture_hash": expected.get("fixture_hash"),
            "route_runtime": "ROUTE_ON",
            "started_at": None,
            "immutable": True,
            "bootstrapped_from": "expected-fixed-harness.json",
            "created_at": utc_now(),
        }
        if allow_bootstrap_write:
            write_json(path, boot)
        return boot
    return None


def compare_to_immutable(
    immutable: dict[str, Any],
    current: dict[str, Any],
) -> list[str]:
    mismatches = []
    for key in (
        "git_commit",
        "harness_version",
        "manifest_hash",
        "applicability_rules_hash",
        "axes_hash",
        "executor_hash",
        "driver_hash",
        "spec_hash",
        "oracle_hash",
        "fixture_hash",
    ):
        exp = immutable.get(key)
        act = current.get(key)
        if exp and act and str(exp) != str(act):
            mismatches.append(f"{key}: expected={exp} actual={act}")
    return mismatches


def write_run_abort(
    run_dir: Path,
    *,
    abort_reason: str,
    expected: dict[str, Any],
    actual: dict[str, Any],
    detail: Optional[dict[str, Any]] = None,
) -> Path:
    doc = {
        "status": "ABORTED",
        "abort_reason": abort_reason,
        "final_verdict": f"ABORTED_{abort_reason}" if not abort_reason.startswith("ABORTED") else abort_reason,
        "expected_git_commit": expected.get("git_commit"),
        "actual_git_commit": actual.get("git_commit"),
        "expected_harness_version": expected.get("harness_version"),
        "actual_harness_version": actual.get("harness_version"),
        "detail": detail or {},
        "recorded_at": utc_now(),
    }
    path = run_dir / "run-abort.json"
    write_json(path, doc)
    # Correct mutable metadata status without rewriting immutable harness fields.
    meta_path = run_dir / "run-metadata.json"
    meta = read_json(meta_path, {}) or {}
    meta["status"] = "ABORTED"
    meta["abort_reason"] = abort_reason
    meta["ended_at"] = meta.get("ended_at") or utc_now()
    meta["final_verdict"] = doc["final_verdict"]
    write_json(meta_path, meta)
    return path


# ---------------------------------------------------------------------------
# Shard expected counts (ROUTE_ON uses route_on_count)
# ---------------------------------------------------------------------------


def load_expected_counts(
    *,
    e2e_root: Path,
    route_runtime: str = "ROUTE_ON",
) -> dict[str, int]:
    summary = read_json(e2e_root / "cross-product" / "generated" / "shard-summary.json", {}) or {}
    by_shard = summary.get("by_shard") or []
    out: dict[str, int] = {}
    for s in by_shard:
        sid = s.get("shard_id")
        if not sid:
            continue
        if route_runtime == "ROUTE_ON":
            out[sid] = int(s.get("route_on_count") or s.get("scenarios") or 0)
        elif route_runtime == "ROUTE_OFF":
            out[sid] = int(s.get("route_off_count") or s.get("scenarios") or 0)
        else:
            out[sid] = int(s.get("scenarios") or 0)
    if out:
        return out
    plan = read_json(e2e_root / "cross-product" / "generated" / "shard-plan.json", {}) or {}
    for s in plan.get("shards") or []:
        out[s["shard_id"]] = len(s.get("combination_ids") or [])
    return out


# ---------------------------------------------------------------------------
# Shard trust validator
# ---------------------------------------------------------------------------


def _result_path(art: Path) -> Optional[Path]:
    for p in (
        art / "cross-product-results.jsonl",
        art / "original" / "cross-product-results.jsonl",
    ):
        if p.exists() and p.stat().st_size > 0:
            return p
    return None


def _load_rows(path: Optional[Path]) -> list[dict[str, Any]]:
    if not path:
        return []
    rows = []
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except Exception:
            continue
    return rows


def validate_shard(
    *,
    run_dir: Path,
    shard_id: str,
    route_runtime: str,
    expected_count: int,
    expected_harness: str,
    expected_commit: str,
    expected_manifest_hash: str = "",
    expected_rules_hash: str = "",
    stable_seconds: float = 30.0,
) -> dict[str, Any]:
    art_name = f"{shard_id}-{route_runtime}"
    art = run_dir / art_name
    bad = run_dir / f".bad-{art_name}"
    superseded = (art / "superseded.json").exists() or (
        (art / "original").exists() and (art / "superseded.json").exists()
    )
    # Also treat original-only + superseded marker
    if (art / "superseded.json").exists():
        superseded = True

    preflight = read_json(art / "shard-preflight-fail.json")
    if not preflight and bad.exists():
        preflight = read_json(bad / "shard-preflight-fail.json")

    result_path = _result_path(art)
    rows_source = "artifact"
    if not result_path and bad.exists():
        result_path = _result_path(bad)
        rows_source = "bad_quarantine"

    rows = _load_rows(result_path)
    ids = [r.get("combination_id") for r in rows if r.get("combination_id")]
    unique = len(set(ids))
    dup_count = len(ids) - unique
    hv_counter = Counter(r.get("harness_version") for r in rows)
    commit_counter = Counter(r.get("git_commit") or r.get("commit") for r in rows)
    man = read_json(art / "shard-manifest.json", {}) or {}
    if not man and (art / "original" / "shard-manifest.json").exists():
        man = read_json(art / "original" / "shard-manifest.json", {}) or {}

    harness_versions = {h for h in hv_counter if h}
    harness_match = bool(harness_versions) and harness_versions == {expected_harness}
    harness_mismatch = bool(harness_versions) and expected_harness not in harness_versions
    mixed_harness = len(harness_versions) > 1
    commit_match = (not commit_counter) or all(
        (c is None) or (c == expected_commit) for c in commit_counter
    )

    # Hash fields on rows when present
    manifest_ok = True
    rules_ok = True
    if expected_manifest_hash:
        mh = {r.get("manifest_hash") for r in rows if r.get("manifest_hash")}
        if mh and mh != {expected_manifest_hash}:
            manifest_ok = False
    if expected_rules_hash:
        rh = {r.get("applicability_rules_hash") for r in rows if r.get("applicability_rules_hash")}
        if rh and rh != {expected_rules_hash}:
            rules_ok = False

    abnormal = (art / "abnormal-exit.json").exists() or (
        bad.exists() and (bad / "abnormal-exit.json").exists()
    )
    evidence_dirs = list(art.glob("cross_product__xp_*")) if art.exists() else []
    if bad.exists() and not evidence_dirs:
        evidence_dirs = list(bad.glob("cross_product__xp_*"))
    cleanup_ok_rows = sum(1 for r in rows if "cleanup_ok" in r)
    cleanup_report = (art / "cleanup-report.json").exists() or (
        run_dir / "cleanup-report.json"
    ).exists()
    cleanup_recorded = cleanup_ok_rows >= max(1, int(len(rows) * 0.9)) or cleanup_report
    evidence_flushed = (not rows) or len(evidence_dirs) >= max(0, len(rows) - 5)

    stable = True
    result_age = None
    if result_path and result_path.exists():
        result_age = time.time() - result_path.stat().st_mtime
        stable = result_age >= stable_seconds

    ended = man.get("ended_at") is not None or man.get("exit_code") is not None
    playwright_log = art / "playwright.log"
    if not playwright_log.exists() and bad.exists():
        playwright_log = bad / "playwright.log"
    playwright_ok = True
    if playwright_log.exists():
        # Soft signal only; absence of crash markers.
        text = playwright_log.read_text(errors="ignore")[-8000:]
        if "Target closed" in text and man.get("exit_code") not in (0, 1, None):
            playwright_ok = False

    reasons: list[str] = []
    verdict = "MISSING"

    if superseded:
        verdict = "SUPERSEDED"
        reasons.append("superseded.json present; original retained for evidence")
    elif preflight and preflight.get("reason") == "harness_version_mismatch":
        # Preflight-only mismatch with no trusted rows → not a product FAIL.
        if not rows or not harness_match:
            verdict = "HARNESS_MISMATCH"
            reasons.append("shard-preflight-fail harness_version_mismatch")
        else:
            verdict = "NEEDS_FULL_RERUN"
            reasons.append("preflight mismatch after partial execution")
    elif not art.exists() and not bad.exists():
        verdict = "MISSING"
        reasons.append("artifact directory missing")
    elif not rows:
        if preflight:
            verdict = (
                "HARNESS_MISMATCH"
                if "harness" in str(preflight.get("reason"))
                else "INCOMPLETE"
            )
            reasons.append(f"preflight:{preflight.get('reason')}")
        else:
            verdict = "MISSING"
            reasons.append("no result rows")
    elif mixed_harness or (harness_versions and not harness_match):
        verdict = "HARNESS_MISMATCH"
        reasons.append(f"harness_versions={sorted(str(h) for h in harness_versions)}")
        if unique != expected_count or len(rows) != expected_count:
            reasons.append("also incomplete vs expected")
        reasons.append("NEEDS_FULL_RERUN")
    elif dup_count > 0:
        verdict = "DUPLICATE_RESULTS"
        reasons.append(f"duplicate_combination_ids={dup_count}")
    elif expected_count > 0 and len(rows) > expected_count:
        verdict = "DUPLICATE_RESULTS"
        reasons.append(f"rows={len(rows)} > expected={expected_count}")
    elif expected_count > 0 and (len(rows) < expected_count or unique < expected_count):
        verdict = "INCOMPLETE"
        reasons.append(f"rows={len(rows)} unique={unique} expected={expected_count}")
    elif abnormal:
        verdict = "ABNORMAL_EXIT"
        reasons.append("abnormal-exit marker")
    elif not ended and not superseded:
        verdict = "INCOMPLETE"
        reasons.append("missing ended_at/exit_code")
    elif not stable:
        verdict = "INCOMPLETE"
        reasons.append(f"results not stable age={result_age}")
    elif not harness_match:
        verdict = "HARNESS_MISMATCH"
        reasons.append("harness mismatch")
    elif not commit_match:
        verdict = "HARNESS_MISMATCH"
        reasons.append(f"git_commit mismatch {dict(commit_counter)}")
    elif not manifest_ok or not rules_ok:
        verdict = "HARNESS_MISMATCH"
        reasons.append("manifest/rules hash mismatch on rows")
    else:
        verdict = "TRUSTED_COMPLETE"
        reasons.append("expected=executed=unique; harness/commit match; ended; stable")

    needs_full_rerun = verdict in {
        "INCOMPLETE",
        "DUPLICATE_RESULTS",
        "HARNESS_MISMATCH",
        "ABNORMAL_EXIT",
        "MISSING",
        "NEEDS_FULL_RERUN",
        "SUPERSEDED",
    } or ("NEEDS_FULL_RERUN" in reasons)

    reuse = verdict == "TRUSTED_COMPLETE"

    return {
        "shard_id": shard_id,
        "artifact": art_name,
        "verdict": verdict,
        "reuse": reuse,
        "rerun": needs_full_rerun,
        "rerun_reason": "; ".join(reasons),
        "expected_combinations": expected_count,
        "executed_rows": len(rows),
        "unique_combination_ids": unique,
        "duplicate_combination_ids": dup_count,
        "harness_versions": dict(hv_counter),
        "harness_match": harness_match,
        "commit_match": commit_match,
        "manifest_ok": manifest_ok,
        "rules_ok": rules_ok,
        "superseded": superseded,
        "abnormal": abnormal,
        "preflight": preflight,
        "ended": ended,
        "stable": stable,
        "result_age_seconds": result_age,
        "cleanup_recorded": cleanup_recorded,
        "evidence_flushed": evidence_flushed,
        "evidence_dirs": len(evidence_dirs),
        "playwright_ok": playwright_ok,
        "rows_source": rows_source,
        "bad_quarantine_exists": bad.exists(),
        "original_path": str(art),
        "replacement_path": None,
    }


def validate_all_shards(
    *,
    run_dir: Path,
    e2e_root: Path,
    route_runtime: str = "ROUTE_ON",
    expected_harness: str = EXPECTED_FIXED_HARNESS,
    expected_commit: str = EXPECTED_FIXED_COMMIT,
) -> dict[str, Any]:
    immutable = load_immutable_run_manifest(run_dir) or {}
    expected_harness = str(immutable.get("harness_version") or expected_harness)
    expected_commit = str(immutable.get("git_commit") or expected_commit)
    expected_manifest = str(immutable.get("manifest_hash") or "")
    expected_rules = str(immutable.get("applicability_rules_hash") or "")
    counts = load_expected_counts(e2e_root=e2e_root, route_runtime=route_runtime)
    plan = read_json(e2e_root / "cross-product" / "generated" / "shard-plan.json", {}) or {}
    shard_ids = [s["shard_id"] for s in plan.get("shards") or []]
    if not shard_ids:
        shard_ids = sorted(counts.keys())

    shards = []
    for sid in shard_ids:
        shards.append(
            validate_shard(
                run_dir=run_dir,
                shard_id=sid,
                route_runtime=route_runtime,
                expected_count=int(counts.get(sid) or 0),
                expected_harness=expected_harness,
                expected_commit=expected_commit,
                expected_manifest_hash=expected_manifest,
                expected_rules_hash=expected_rules,
            )
        )

    by_verdict: dict[str, list[str]] = {}
    for s in shards:
        by_verdict.setdefault(s["verdict"], []).append(s["shard_id"])

    return {
        "run_id": run_dir.name,
        "captured_at": utc_now(),
        "expected_harness_version": expected_harness,
        "expected_git_commit": expected_commit,
        "route_runtime": route_runtime,
        "shard_count": len(shards),
        "by_verdict": {k: len(v) for k, v in by_verdict.items()},
        "trusted_completed_shards": by_verdict.get("TRUSTED_COMPLETE", []),
        "superseded_shards": by_verdict.get("SUPERSEDED", []),
        "invalid_shards": [
            s["shard_id"]
            for s in shards
            if s["verdict"]
            not in {"TRUSTED_COMPLETE", "SUPERSEDED"}
        ],
        "missing_shards": by_verdict.get("MISSING", []),
        "needs_full_rerun": [s["shard_id"] for s in shards if s["rerun"]],
        "shards": shards,
    }


# ---------------------------------------------------------------------------
# Status determination
# ---------------------------------------------------------------------------


def heartbeat_age_seconds(run_dir: Path) -> Optional[float]:
    candidates = [
        run_dir / "recovery-orchestrator.log",
        run_dir / "recovery-orchestrator-state.json",
        run_dir / "status-snapshot.json",
    ]
    mtimes = [p.stat().st_mtime for p in candidates if p.exists()]
    if not mtimes:
        return None
    return time.time() - max(mtimes)


def last_result_age_seconds(run_dir: Path) -> Optional[float]:
    newest = None
    for p in run_dir.glob("*/cross-product-results.jsonl"):
        if p.name.startswith("."):
            continue
        mt = p.stat().st_mtime
        newest = mt if newest is None else max(newest, mt)
    if newest is None:
        return None
    return time.time() - newest


def _proc_has_run_id(pid: str, run_id: str) -> bool:
    try:
        env = Path(f"/proc/{pid}/environ").read_bytes().split(b"\x00")
        for item in env:
            if item.startswith(b"GDC_E2E_RUN_ID=") and item.split(b"=", 1)[1].decode() == run_id:
                return True
    except Exception:
        pass
    try:
        cwd = os.readlink(f"/proc/{pid}/cwd")
        if run_id in cwd:
            return True
    except Exception:
        pass
    return False


def playwright_alive(run_dir: Path, e2e_root: Path) -> bool:
    """True only for real run-all-shards / playwright test workers for this run.

    Avoid matching operator/agent shells that merely mention 'playwright' in a prompt.
    """
    run_id = run_dir.name
    try:
        for proc in Path("/proc").iterdir():
            if not proc.name.isdigit():
                continue
            try:
                argv = (proc / "cmdline").read_bytes().split(b"\x00")
                cmd = b" ".join(argv).decode("utf-8", errors="replace")
                exe = os.readlink(f"/proc/{proc.name}/exe")
            except Exception:
                continue
            # Ignore diagnostic/agent shells embedding these strings.
            if "recovery_lib" in cmd or "xp-recovery-status" in cmd or "test_xp_recovery" in cmd:
                continue
            is_run_all = any(b"run-all-shards.sh" in a for a in argv)
            is_pw = (
                ("/node" in exe or exe.endswith("node") or "playwright" in exe)
                and (
                    b"playwright" in b" ".join(argv)
                    or any(b"cross-product.spec" in a for a in argv)
                )
            )
            if not (is_run_all or is_pw):
                continue
            if _proc_has_run_id(proc.name, run_id) or run_id.encode() in b" ".join(argv):
                return True
    except Exception:
        pass
    reports_root = run_dir.parent
    pid_file = reports_root / ".pids" / "xp_full_on.pid"
    if pid_file.exists():
        try:
            pid = int(pid_file.read_text().strip())
            if pid_alive(pid):
                cmd = process_cmdline(pid) or ""
                if "run-all-shards.sh" in cmd:
                    return True
        except Exception:
            pass
    return False


def orchestrator_alive(lock_info: dict[str, Any], reports_root: Path) -> bool:
    if lock_info.get("owner_alive"):
        return True
    pid_file = reports_root / ".pids" / "xp_recovery.pid"
    if pid_file.exists():
        try:
            pid = int(pid_file.read_text().strip())
            if pid_alive(pid):
                cmd = process_cmdline(pid) or ""
                if "xp-full-recovery-orchestrator" in cmd:
                    # Still verify start-time if lock has it
                    lock = lock_info.get("lock") or {}
                    if lock.get("process_start_time"):
                        return process_matches_lock({**lock, "pid": pid})
                    return True
        except Exception:
            pass
    return False


def determine_status(
    *,
    run_dir: Path,
    e2e_root: Path,
    expected_harness: str = EXPECTED_FIXED_HARNESS,
    reports_root: Optional[Path] = None,
    allow_bootstrap_write: bool = True,
) -> dict[str, Any]:
    reports = Path(reports_root) if reports_root else run_dir.parent
    lock_path = reports / ".locks" / f"xp-full-recovery-{run_dir.name}.lock"
    lock_info = classify_lock(lock_path)
    state = read_json(run_dir / "recovery-orchestrator-state.json", {}) or {}
    meta = read_json(run_dir / "run-metadata.json", {}) or {}
    abort = read_json(run_dir / "run-abort.json")
    immutable = load_immutable_run_manifest(
        run_dir, allow_bootstrap_write=allow_bootstrap_write
    )
    validation = validate_all_shards(
        run_dir=run_dir,
        e2e_root=e2e_root,
        expected_harness=(immutable or {}).get("harness_version") or expected_harness,
        expected_commit=(immutable or {}).get("git_commit") or EXPECTED_FIXED_COMMIT,
    )

    orch = orchestrator_alive(lock_info, reports)
    pw = playwright_alive(run_dir, e2e_root)
    hb = heartbeat_age_seconds(run_dir)
    lr = last_result_age_seconds(run_dir)

    current_hv = meta.get("harness_version")
    imm_hv = (immutable or {}).get("harness_version")
    immutable_harness_match = None
    if imm_hv and current_hv:
        immutable_harness_match = str(imm_hv) == str(current_hv)

    abort_reason = None
    if abort:
        abort_reason = abort.get("abort_reason")
    elif current_hv and imm_hv and str(current_hv) != str(imm_hv):
        abort_reason = "HARNESS_DRIFT"

    # Verdict rules (order matters)
    if orch or pw:
        # Active work — but harness drift abort marker still surfaces.
        if abort and abort.get("abort_reason") == "HARNESS_DRIFT" and not pw:
            # Orchestrator may still be looping after drift; surface abort intent.
            final = "ABORTED_HARNESS_DRIFT"
            resumable = True
        else:
            final = "IN_PROGRESS"
            resumable = False
    elif abort or abort_reason == "HARNESS_DRIFT":
        final = "ABORTED_HARNESS_DRIFT" if (abort_reason or "").endswith("HARNESS_DRIFT") or (
            abort or {}
        ).get("abort_reason") == "HARNESS_DRIFT" else "ABORTED"
        abort_reason = abort_reason or (abort or {}).get("abort_reason") or "HARNESS_DRIFT"
        resumable = True
    elif lock_info["lock_status"] == "STALE_LOCK":
        final = "STALE_LOCK"
        resumable = True
    elif lock_info["lock_status"] == "PID_REUSED_MISMATCH":
        final = "STALE_LOCK"
        resumable = True
    elif meta.get("ended_at") and int(meta.get("failed_shards") or 0) == 0 and state.get("phase") == "complete":
        final = "COMPLETE"
        resumable = False
    elif meta.get("ended_at") and int(meta.get("failed_shards") or 0) > 0:
        # Ended with failures — if harness drift signature, prefer ABORTED.
        if abort_reason == "HARNESS_DRIFT" or (
            current_hv and imm_hv and str(current_hv) != str(imm_hv)
        ):
            final = "ABORTED_HARNESS_DRIFT"
            abort_reason = "HARNESS_DRIFT"
            resumable = True
        else:
            final = "FAIL"
            resumable = True
    elif state.get("phase") == "complete":
        final = "COMPLETE"
        resumable = False
    else:
        final = (
            "ABORTED"
            if abort
            else "STALE_LOCK"
            if (lock_info.get("lock") or {}).get("pid")
            else "UNKNOWN"
        )
        resumable = True

    # Never treat lock-file presence alone as IN_PROGRESS (already handled).

    return {
        "captured_at": utc_now(),
        "run_id": run_dir.name,
        "reports_root": str(reports.resolve()),
        "run_dir": str(run_dir.resolve()),
        "phase": state.get("phase"),
        "orchestrator_alive": orch,
        "playwright_alive": pw,
        "lock_status": lock_info["lock_status"],
        "lock": lock_info.get("lock"),
        "heartbeat_age_seconds": hb,
        "last_result_age_seconds": lr,
        "immutable_harness_match": immutable_harness_match,
        "abort_reason": abort_reason,
        "resumable": resumable,
        "trusted_completed_shards": validation["trusted_completed_shards"],
        "invalid_shards": validation["invalid_shards"],
        "missing_shards": validation["missing_shards"],
        "final_verdict": final,
        "run_metadata_ended_at": meta.get("ended_at"),
        "failed_shards": meta.get("failed_shards"),
        "expected_fixed_harness": (immutable or {}).get("harness_version") or expected_harness,
    }


# ---------------------------------------------------------------------------
# Recovery plan
# ---------------------------------------------------------------------------


def next_recovery_attempt_dir(run_dir: Path) -> Path:
    existing = sorted(run_dir.glob("recovery-attempt-*"))
    n = 1
    if existing:
        nums = []
        for p in existing:
            m = re.match(r"recovery-attempt-(\d+)$", p.name)
            if m:
                nums.append(int(m.group(1)))
        n = (max(nums) if nums else 0) + 1
    path = run_dir / f"recovery-attempt-{n:03d}"
    path.mkdir(parents=True, exist_ok=False)
    return path


def build_recovery_plan(
    *,
    run_dir: Path,
    e2e_root: Path,
    attempt_dir: Optional[Path] = None,
) -> dict[str, Any]:
    if attempt_dir is None:
        attempt_dir = next_recovery_attempt_dir(run_dir)
    else:
        attempt_dir.mkdir(parents=True, exist_ok=True)

    validation = validate_all_shards(run_dir=run_dir, e2e_root=e2e_root)
    write_json(attempt_dir / "shard-validation.json", validation)

    immutable = load_immutable_run_manifest(run_dir) or {}
    replacement_map: dict[str, Any] = {}
    plan_shards = []
    for s in validation["shards"]:
        sid = s["shard_id"]
        reuse = bool(s["reuse"])
        rerun = bool(s["rerun"])
        replacement = None
        if rerun:
            replacement = str(attempt_dir / "replacements" / f"{sid}-ROUTE_ON")
            replacement_map[sid] = {
                "original": s["original_path"],
                "replacement": replacement,
                "reason": s["rerun_reason"],
                "verdict": s["verdict"],
            }
        entry = {
            "shard_id": sid,
            "original_shard_path": s["original_path"],
            "verdict": s["verdict"],
            "reuse": reuse,
            "rerun": rerun,
            "rerun_reason": s["rerun_reason"],
            "replacement_path": replacement,
            "expected_combinations": s["expected_combinations"],
            "merge_include": reuse,  # replacements added after successful rerun
            "merge_exclude": s["verdict"]
            in {"SUPERSEDED", "HARNESS_MISMATCH", "DUPLICATE_RESULTS", "ABNORMAL_EXIT"}
            or s.get("bad_quarantine_exists"),
        }
        # SUPERSEDED shard-0: full rerun required (not FAIL-only)
        if s["verdict"] == "SUPERSEDED":
            entry["rerun"] = True
            entry["reuse"] = False
            entry["full_shard_rerun"] = True
            entry["fail_only_forbidden"] = True
            entry["rerun_reason"] = "SUPERSEDED original; full shard rerun with fixed harness"
            replacement_map[sid] = {
                "original": s["original_path"],
                "replacement": str(attempt_dir / "replacements" / f"{sid}-ROUTE_ON"),
                "reason": entry["rerun_reason"],
                "verdict": "SUPERSEDED",
                "full_shard_rerun": True,
            }
            entry["replacement_path"] = replacement_map[sid]["replacement"]
        plan_shards.append(entry)

    # harness-mismatch preflight failures must NOT count as product FAIL
    product_fail_excluded = [
        s["shard_id"]
        for s in validation["shards"]
        if s.get("preflight") and s["preflight"].get("reason") == "harness_version_mismatch"
    ]

    plan = {
        "run_id": run_dir.name,
        "attempt_dir": str(attempt_dir),
        "created_at": utc_now(),
        "immutable_run_manifest": immutable,
        "expected_harness_version": validation["expected_harness_version"],
        "expected_git_commit": validation["expected_git_commit"],
        "reuse_shards": [s["shard_id"] for s in plan_shards if s["reuse"]],
        "rerun_shards": [s["shard_id"] for s in plan_shards if s["rerun"]],
        "merge_exclude": [s["shard_id"] for s in plan_shards if s["merge_exclude"]],
        "product_fail_excluded_shards": product_fail_excluded,
        "shard_0_replacement_mode": "FULL_SHARD_FIXED_HARNESS",
        "shards": plan_shards,
        "rules": [
            "Do not delete or move existing artifacts",
            "SUPERSEDED original remains for evidence",
            "FAIL-only rerun forbidden for shard-0",
            "Merge uses TRUSTED_COMPLETE + successful replacements only",
            "Exclude SUPERSEDED, HARNESS_MISMATCH, .bad-* from final merge",
        ],
    }
    write_json(attempt_dir / "recovery-plan.json", plan)
    write_json(attempt_dir / "replacement-map.json", replacement_map)
    write_json(
        attempt_dir / "recovery-run-metadata.json",
        {
            "run_id": run_dir.name,
            "attempt": attempt_dir.name,
            "created_at": utc_now(),
            "status": "PLANNED",
            "expected_harness_version": validation["expected_harness_version"],
            "expected_git_commit": validation["expected_git_commit"],
            "rerun_shard_count": len(plan["rerun_shards"]),
            "reuse_shard_count": len(plan["reuse_shards"]),
        },
    )
    return plan


def merge_selection_from_plan(
    *,
    run_dir: Path,
    plan: dict[str, Any],
    replacement_map: dict[str, Any],
) -> dict[str, Any]:
    """Describe which artifact dirs to include in final merge."""
    include = []
    exclude = []
    for s in plan["shards"]:
        sid = s["shard_id"]
        if s["reuse"]:
            include.append({"shard_id": sid, "path": s["original_shard_path"], "source": "trusted_original"})
        elif sid in replacement_map:
            rep = replacement_map[sid].get("replacement")
            rep_path = Path(rep) if rep else None
            if not rep_path or not (rep_path / "cross-product-results.jsonl").exists():
                exclude.append({"shard_id": sid, "reason": "replacement_missing"})
                continue
            validation = read_json(rep_path / "validation.json", {}) or {}
            if validation.get("ok") is not True:
                exclude.append({"shard_id": sid, "reason": "replacement_not_validated"})
                continue
            if replacement_map[sid].get("merge_eligible") is False:
                exclude.append({"shard_id": sid, "reason": "merge_not_eligible"})
                continue
            if replacement_map[sid].get("merge_excluded") is True:
                exclude.append({"shard_id": sid, "reason": "merge_excluded"})
                continue
            include.append({"shard_id": sid, "path": str(rep_path), "source": "replacement"})
        else:
            exclude.append({"shard_id": sid, "reason": s["verdict"]})
    # Always exclude .bad-* and SUPERSEDED originals
    for p in run_dir.iterdir():
        if p.name.startswith(".bad-"):
            exclude.append({"shard_id": p.name, "reason": "bad_quarantine", "path": str(p)})
    return {"include": include, "exclude": exclude}


# ---------------------------------------------------------------------------
# Immutable shard-plan snapshot (recovery-attempt scoped)
# ---------------------------------------------------------------------------


def combination_ids_hash(ids: list[str]) -> str:
    return hashlib.sha256("\n".join(ids).encode()).hexdigest()


def shard_plan_snapshot_path(attempt_dir: Path) -> Path:
    return Path(attempt_dir) / "shard-plan.snapshot.json"


def attempt_status_path(attempt_dir: Path) -> Path:
    return Path(attempt_dir) / "attempt-status.json"


def load_route_filtered_combination_ids(
    *,
    shard_plan_path: Path,
    valid_combinations_path: Path,
    route_runtime: str = "ROUTE_ON",
) -> list[dict[str, Any]]:
    """Restore per-shard route-filtered combination_ids from catalog + shard-plan."""
    plan = read_json(shard_plan_path, {}) or {}
    shards_in = plan.get("shards") or []
    if not shards_in:
        raise FileNotFoundError(f"shard-plan has no shards: {shard_plan_path}")
    if not valid_combinations_path.is_file():
        raise FileNotFoundError(f"missing catalog: {valid_combinations_path}")

    wanted: dict[str, set[str]] = {}
    for s in shards_in:
        sid = s["shard_id"]
        wanted[sid] = set(s.get("combination_ids") or [])

    route_ids: dict[str, list[str]] = {sid: [] for sid in wanted}
    with valid_combinations_path.open() as fh:
        for line in fh:
            if not line.strip():
                continue
            row = json.loads(line)
            cid = row.get("combination_id")
            axes = row.get("axes") or {}
            if axes.get("route_runtime") != route_runtime:
                continue
            for sid, idset in wanted.items():
                if cid in idset:
                    route_ids[sid].append(cid)
                    break

    out = []
    for s in shards_in:
        sid = s["shard_id"]
        ids = sorted(set(route_ids.get(sid) or []))
        expected = int(
            s.get("route_on_count")
            if route_runtime == "ROUTE_ON"
            else s.get("route_off_count")
            if route_runtime == "ROUTE_OFF"
            else len(s.get("combination_ids") or [])
        )
        if expected <= 0:
            expected = len(ids)
        if len(ids) != expected:
            raise ValueError(
                f"shard {sid}: restored={len(ids)} expected={expected} route={route_runtime}"
            )
        if len(ids) != len(set(ids)):
            raise ValueError(f"shard {sid}: duplicate combination_ids in restore")
        out.append(
            {
                "shard_id": sid,
                "route_mode": route_runtime,
                "expected_count": len(ids),
                "combination_ids": ids,
                "combination_ids_hash": combination_ids_hash(ids),
                "source_total_ids": len(s.get("combination_ids") or []),
                "route_on_count": int(s.get("route_on_count") or 0),
                "route_off_count": int(s.get("route_off_count") or 0),
            }
        )
    return out


def build_shard_plan_snapshot(
    *,
    source_run_id: str,
    immutable: dict[str, Any],
    shard_plan_path: Path,
    valid_combinations_path: Path,
    route_runtime: str = "ROUTE_ON",
    source_label: str = "generated_catalog",
) -> dict[str, Any]:
    shards = load_route_filtered_combination_ids(
        shard_plan_path=shard_plan_path,
        valid_combinations_path=valid_combinations_path,
        route_runtime=route_runtime,
    )
    all_ids = [cid for s in shards for cid in s["combination_ids"]]
    if len(all_ids) != len(set(all_ids)):
        raise ValueError("duplicate combination_id across shards in snapshot")
    return {
        "source_run_id": source_run_id,
        "git_commit": immutable.get("git_commit"),
        "harness_version": immutable.get("harness_version"),
        "manifest_hash": immutable.get("manifest_hash"),
        "applicability_rules_hash": immutable.get("applicability_rules_hash"),
        "axes_hash": immutable.get("axes_hash"),
        "route_runtime": route_runtime,
        "generated_at": utc_now(),
        "source": {
            "label": source_label,
            "shard_plan_path": str(shard_plan_path.resolve()),
            "valid_combinations_path": str(valid_combinations_path.resolve()),
            "shard_plan_sha256": sha256_file(shard_plan_path),
            "valid_combinations_sha256": sha256_file(valid_combinations_path),
        },
        "shard_count": len(shards),
        "total_combinations": len(all_ids),
        "snapshot_hash": combination_ids_hash(
            [f"{s['shard_id']}:{s['combination_ids_hash']}" for s in shards]
        ),
        "shards": shards,
    }


def ensure_shard_plan_snapshot(
    attempt_dir: Path,
    snapshot: dict[str, Any],
    *,
    overwrite: bool = False,
) -> tuple[Path, bool]:
    """Write snapshot once. Refuses overwrite of an existing different snapshot."""
    path = shard_plan_snapshot_path(attempt_dir)
    if path.exists():
        existing = read_json(path, {}) or {}
        if existing.get("snapshot_hash") != snapshot.get("snapshot_hash"):
            if overwrite:
                raise RuntimeError(
                    f"refusing to overwrite shard-plan.snapshot.json with different hash at {path}"
                )
            raise RuntimeError(
                f"shard-plan.snapshot.json already exists with different hash at {path}"
            )
        return path, False
    write_json(path, snapshot)
    return path, True


def load_shard_plan_snapshot(attempt_dir: Path) -> Optional[dict[str, Any]]:
    path = shard_plan_snapshot_path(attempt_dir)
    if not path.is_file():
        return None
    return read_json(path)


def get_snapshot_shard(snapshot: dict[str, Any], shard_id: str) -> Optional[dict[str, Any]]:
    for s in snapshot.get("shards") or []:
        if s.get("shard_id") == shard_id:
            return s
    return None


def validate_snapshot_shard(
    snapshot: dict[str, Any],
    *,
    shard_id: str,
    expected_count: Optional[int] = None,
) -> dict[str, Any]:
    errors: list[str] = []
    shard = get_snapshot_shard(snapshot, shard_id)
    if not shard:
        return {
            "ok": False,
            "reason": "SHARD_PLAN_INVALID",
            "errors": [f"shard_id missing from snapshot: {shard_id}"],
        }
    ids = list(shard.get("combination_ids") or [])
    exp = int(shard.get("expected_count") or 0)
    if exp <= 0:
        errors.append("expected_count <= 0")
    if len(ids) <= 0:
        errors.append("combination_ids empty")
    if len(ids) != exp:
        errors.append(f"expected_count={exp} != len(ids)={len(ids)}")
    if len(ids) != len(set(ids)):
        errors.append("duplicate combination_ids")
    if sorted(ids) != ids:
        errors.append("combination_ids not sorted")
    if shard.get("combination_ids_hash") != combination_ids_hash(ids):
        errors.append("combination_ids_hash mismatch")
    if expected_count is not None and int(expected_count) != exp:
        errors.append(
            f"recovery plan expected_count={expected_count} != snapshot={exp}"
        )
    return {
        "ok": not errors,
        "reason": None if not errors else "SHARD_PLAN_INVALID",
        "errors": errors,
        "shard": shard,
        "expected_count": exp,
        "combination_count": len(ids),
    }


def write_attempt_abort(
    attempt_dir: Path,
    *,
    reason: str,
    detail: Optional[dict[str, Any]] = None,
) -> Path:
    doc = {
        "status": "ABORTED",
        "reason": reason,
        "detail": detail or {},
        "recorded_at": utc_now(),
    }
    path = Path(attempt_dir) / "attempt-abort.json"
    write_json(path, doc)
    update_attempt_status(
        attempt_dir,
        status="ABORTED" if reason != "SHARD_PLAN_INVALID" else "FAILED_PREFLIGHT",
        phase="PREFLIGHT",
        abort_reason=reason,
        resumable=True,
        final_verdict=f"FAILED_PREFLIGHT_{reason}" if reason.startswith("SHARD_") else reason,
        ended_at=utc_now(),
    )
    return path


def write_attempt_status(attempt_dir: Path, doc: dict[str, Any]) -> Path:
    path = attempt_status_path(attempt_dir)
    base = read_json(path, {}) or {}
    base.update(doc)
    base["updated_at"] = utc_now()
    if "started_at" not in base:
        base["started_at"] = utc_now()
    write_json(path, base)
    return path


def update_attempt_status(attempt_dir: Path, **fields: Any) -> Path:
    return write_attempt_status(attempt_dir, fields)


def load_attempt_status(attempt_dir: Path) -> dict[str, Any]:
    return read_json(attempt_status_path(attempt_dir), {}) or {}


def build_recovery_plan_v2(
    *,
    attempt_dir: Path,
    plan: Optional[dict[str, Any]] = None,
    snapshot: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Link recovery plan shards to immutable snapshot without overwriting v1 plan."""
    attempt_dir = Path(attempt_dir)
    plan = plan or read_json(attempt_dir / "recovery-plan.json", {}) or {}
    snapshot = snapshot or load_shard_plan_snapshot(attempt_dir)
    if not snapshot:
        raise FileNotFoundError(f"missing shard-plan.snapshot.json under {attempt_dir}")

    snap_path = str(shard_plan_snapshot_path(attempt_dir))
    shards_out = []
    for s in plan.get("shards") or []:
        entry = dict(s)
        sid = entry["shard_id"]
        snap_shard = get_snapshot_shard(snapshot, sid)
        if snap_shard:
            entry["shard_plan_snapshot"] = snap_path
            entry["expected_count"] = snap_shard["expected_count"]
            entry["combination_ids_hash"] = snap_shard["combination_ids_hash"]
            entry["route_mode"] = snap_shard.get("route_mode") or "ROUTE_ON"
            entry["replacement_output_dir"] = str(
                attempt_dir / "replacements" / f"{sid}-ROUTE_ON"
            )
            if entry.get("expected_combinations") and int(entry["expected_combinations"]) != int(
                snap_shard["expected_count"]
            ):
                entry["expected_count_mismatch"] = {
                    "plan": entry["expected_combinations"],
                    "snapshot": snap_shard["expected_count"],
                }
        shards_out.append(entry)

    missing = [
        sid
        for sid in (plan.get("rerun_shards") or [])
        if get_snapshot_shard(snapshot, sid) is None
    ]
    v2 = {
        **plan,
        "plan_version": 2,
        "created_at": utc_now(),
        "parent_plan": str(attempt_dir / "recovery-plan.json"),
        "shard_plan_snapshot": snap_path,
        "snapshot_hash": snapshot.get("snapshot_hash"),
        "shards": shards_out,
        "snapshot_missing_rerun_shards": missing,
    }
    out = attempt_dir / "recovery-plan.v2.json"
    write_json(out, v2)
    return v2


def write_combination_ids_file(path: Path, ids: list[str]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(ids) + "\n")
    return path


def write_runtime_shard_plan(path: Path, shard_id: str, ids: list[str], *, route_mode: str) -> Path:
    """Write a minimal shard-plan.json compatible with cross-product-loader."""
    doc = {
        "shards": [
            {
                "shard_id": shard_id,
                "route_mode": route_mode,
                "expected_count": len(ids),
                "combination_ids": list(ids),
            }
        ]
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=2) + "\n")
    return path


def invalidate_zero_shard_side_run(
    side_run_dir: Path,
    *,
    reason: str = "ZERO_SHARDS_EXECUTED",
) -> dict[str, Any]:
    """Mark a false-COMPLETE zero-shard side run invalid without deleting evidence."""
    side_run_dir = Path(side_run_dir)
    meta = read_json(side_run_dir / "run-metadata.json", {}) or {}
    doc = {
        "side_run_id": side_run_dir.name,
        "reason": reason,
        "executed": 0,
        "trusted": False,
        "merge_excluded": True,
        "product_fail_excluded": True,
        "original_status": meta.get("status"),
        "original_failed_shards": meta.get("failed_shards"),
        "corrected_status": "FAILED_PREFLIGHT",
        "recorded_at": utc_now(),
    }
    write_json(side_run_dir / "zero-shard-invalid.json", doc)
    write_json(
        side_run_dir / "corrected-status.json",
        {
            "status": "FAILED_PREFLIGHT",
            "complete": False,
            "reason": reason,
            "trusted": False,
            "merge_excluded": True,
            "recorded_at": utc_now(),
            "note": "Original run-metadata.json preserved; do not treat COMPLETE as success",
        },
    )
    return doc


def is_side_run_merge_excluded(side_run_dir: Path) -> bool:
    if (Path(side_run_dir) / "zero-shard-invalid.json").exists():
        return True
    corrected = read_json(Path(side_run_dir) / "corrected-status.json", {}) or {}
    return corrected.get("merge_excluded") is True


def atomic_publish_replacement(
    *,
    src_dir: Path,
    dst_dir: Path,
    generation: int = 1,
) -> dict[str, Any]:
    """Publish verified src into dst atomically. Never overwrite an existing published dst."""
    import shutil

    src_dir = Path(src_dir)
    dst_dir = Path(dst_dir)
    if not src_dir.is_dir():
        return {"ok": False, "reason": "SRC_MISSING", "src": str(src_dir), "dst": str(dst_dir)}
    if (dst_dir / "cross-product-results.jsonl").exists():
        return {
            "ok": False,
            "reason": "DST_EXISTS",
            "src": str(src_dir),
            "dst": str(dst_dir),
            "hint": "use a new generation or quarantine; overwrite forbidden",
        }
    parent = dst_dir.parent
    parent.mkdir(parents=True, exist_ok=True)
    staging = parent / f".staging-{dst_dir.name}-g{generation}-{os.getpid()}"
    if staging.exists():
        shutil.rmtree(staging)
    shutil.copytree(src_dir, staging, symlinks=True)
    os.replace(str(staging), str(dst_dir))
    return {"ok": True, "src": str(src_dir), "dst": str(dst_dir), "generation": generation}


def quarantine_failed_replacement(
    *,
    src_dir: Path,
    attempt_dir: Path,
    shard_id: str,
    reason: str,
) -> Path:
    import shutil

    qdir = Path(attempt_dir) / "replacements" / f".failed-attempt-{shard_id}-{int(time.time())}"
    if src_dir.is_dir():
        shutil.copytree(src_dir, qdir, symlinks=True)
    write_json(qdir / "quarantine.json", {"reason": reason, "recorded_at": utc_now(), "src": str(src_dir)})
    return qdir


def validate_replacement_artifact(
    *,
    art_dir: Path,
    shard_id: str,
    expected_count: int,
    expected_harness: str,
    expected_commit: str,
    expected_ids: Optional[list[str]] = None,
) -> dict[str, Any]:
    art_dir = Path(art_dir)
    result = art_dir / "cross-product-results.jsonl"
    errors: list[str] = []
    if not result.is_file():
        return {
            "ok": False,
            "reason": "FAILED_RESULT_MISSING",
            "errors": ["cross-product-results.jsonl missing"],
            "shard_id": shard_id,
        }
    rows = _load_rows(result)
    ids = [r.get("combination_id") for r in rows if r.get("combination_id")]
    unique = len(set(ids))
    dup = len(ids) - unique
    hvs = {r.get("harness_version") for r in rows if r.get("harness_version")}
    commits = {r.get("git_commit") or r.get("commit") for r in rows if (r.get("git_commit") or r.get("commit"))}
    if len(rows) == 0:
        errors.append("executed=0")
    if len(rows) != expected_count:
        errors.append(f"executed={len(rows)} expected={expected_count}")
    if unique != expected_count:
        errors.append(f"unique={unique} expected={expected_count}")
    if dup != 0:
        errors.append(f"duplicate={dup}")
    if hvs != {expected_harness}:
        errors.append(f"harness_versions={sorted(str(h) for h in hvs)}")
    if commits and commits != {expected_commit}:
        errors.append(f"git_commits={sorted(str(c) for c in commits)}")
    if expected_ids is not None:
        missing = sorted(set(expected_ids) - set(ids))
        extra = sorted(set(ids) - set(expected_ids))
        if missing:
            errors.append(f"missing_ids={len(missing)}")
        if extra:
            errors.append(f"extra_ids={len(extra)}")
    summary = art_dir / "shard-summary.json"
    if not summary.is_file() and not (art_dir / "shard-manifest.json").is_file():
        errors.append("summary/manifest missing")
    if (art_dir / "abnormal-exit.json").exists():
        errors.append("abnormal-exit marker")
    evidence_dirs = list(art_dir.glob("cross_product__xp_*"))
    evidence_flush = (art_dir / "evidence-flush.json").exists() or len(evidence_dirs) > 0
    cleanup_ok = (
        (art_dir / "cleanup-report.json").exists()
        or sum(1 for r in rows if r.get("cleanup_ok") is True) >= max(1, int(len(rows) * 0.9))
    )
    if rows and not evidence_flush:
        errors.append("evidence flush incomplete")
    if rows and not cleanup_ok:
        errors.append("cleanup incomplete")

    reason = None
    if errors:
        if "executed=0" in errors or not result.is_file():
            reason = "FAILED_RESULT_MISSING" if not result.is_file() else "INCOMPLETE_EXECUTION"
        elif any("executed=" in e or "unique=" in e for e in errors):
            reason = "INCOMPLETE_EXECUTION"
        else:
            reason = "FAILED_REPLACEMENT_VALIDATION"

    doc = {
        "ok": not errors,
        "reason": reason,
        "errors": errors,
        "shard_id": shard_id,
        "expected": expected_count,
        "executed": len(rows),
        "unique": unique,
        "duplicate": dup,
        "missing": len(set(expected_ids or []) - set(ids)) if expected_ids is not None else None,
        "harness_versions": sorted(str(h) for h in hvs),
        "git_commits": sorted(str(c) for c in commits),
        "evidence_dirs": len(evidence_dirs),
        "evidence_flush": evidence_flush,
        "cleanup_ok": cleanup_ok,
        "checked_at": utc_now(),
    }
    write_json(art_dir / "validation.json", doc)
    return doc


# ---------------------------------------------------------------------------
# Authoritative combination-count audit
# ---------------------------------------------------------------------------
#
# Count term definitions (do not conflate):
#   raw_cartesian_count        — theoretical full axis product (not materialised)
#   generated_candidate_count  — unique candidate IDs before applicability keep
#   applicable_valid_count     — catalog VALID rows (all route modes)
#   not_applicable_count       — catalog N/A rows
#   scenario_count             — orthogonal matrix scenarios (separate product)
#   combination_count          — one VALID catalog row = one combination_id
#   normal_combination_count   — fault_type == NONE within scope
#   fault_combination_count    — fault_type != NONE within scope
#   route_on_count / route_off_count — applicable_valid filtered by route_runtime
#   shard_assignment_count     — union of snapshot combination_ids
#   selected_recovery_count    — union of selected/rerun shard combination_ids
#
# For xp_full_on recovery, authoritative scope is route_runtime=ROUTE_ON:
#   authoritative_valid_count == route_on_count
#   (applicable_valid_count = route_on_count + route_off_count)


COUNT_TERM_DEFINITIONS: dict[str, str] = {
    "raw_cartesian_count": "Theoretical full axis product; not used as recovery authority",
    "generated_candidate_count": "Unique candidate combination IDs emitted before applicability keep",
    "applicable_valid_count": "VALID catalog rows across all route modes",
    "not_applicable_count": "N/A catalog rows rejected by applicability rules",
    "scenario_count": "Orthogonal matrix scenario count (distinct from combination_id)",
    "combination_count": "One VALID catalog row identified by combination_id",
    "normal_combination_count": "Combinations with fault_type=NONE in scope",
    "fault_combination_count": "Combinations with fault_type!=NONE in scope",
    "route_on_count": "VALID combinations with axes.route_runtime=ROUTE_ON",
    "route_off_count": "VALID combinations with axes.route_runtime=ROUTE_OFF",
    "shard_assignment_count": "Union size of snapshot shard combination_ids",
    "selected_recovery_count": "Union size of selected recovery shard combination_ids",
}


def load_catalog_combination_sets(
    valid_combinations_path: Path,
    *,
    route_runtime: Optional[str] = None,
) -> dict[str, Any]:
    """Load combination ID sets and counts from the immutable VALID catalog."""
    path = Path(valid_combinations_path)
    if not path.is_file():
        raise FileNotFoundError(f"missing catalog: {path}")

    all_ids: set[str] = set()
    scoped_ids: set[str] = set()
    route_counts: Counter[str] = Counter()
    fault_none = 0
    fault_nonzero = 0
    surface_counts: Counter[str] = Counter()
    by_source: Counter[str] = Counter()
    by_destination: Counter[str] = Counter()
    duplicates_in_file = 0
    seen: set[str] = set()

    with path.open() as fh:
        for line in fh:
            if not line.strip():
                continue
            row = json.loads(line)
            cid = row.get("combination_id")
            if not cid:
                continue
            if cid in seen:
                duplicates_in_file += 1
                continue
            seen.add(cid)
            all_ids.add(cid)
            axes = row.get("axes") or {}
            rr = axes.get("route_runtime") or ""
            route_counts[rr] += 1
            ft = axes.get("fault_type") or "NONE"
            es = axes.get("execution_surface") or ""
            surface_counts[es] += 1
            by_source[axes.get("source_type") or ""] += 1
            by_destination[axes.get("destination_type") or ""] += 1
            in_scope = route_runtime is None or rr == route_runtime
            if in_scope:
                scoped_ids.add(cid)
                if ft == "NONE":
                    fault_none += 1
                else:
                    fault_nonzero += 1

    id_hash = combination_ids_hash(sorted(scoped_ids))
    return {
        "catalog_path": str(path.resolve()),
        "catalog_sha256": sha256_file(path),
        "route_runtime_scope": route_runtime,
        "applicable_valid_count": len(all_ids),
        "authoritative_valid_count": len(scoped_ids),
        "route_on_count": int(route_counts.get("ROUTE_ON") or 0),
        "route_off_count": int(route_counts.get("ROUTE_OFF") or 0),
        "normal_combination_count": fault_none,
        "fault_combination_count": fault_nonzero,
        "browser_count": int(surface_counts.get("BROWSER") or 0),
        "api_count": int(surface_counts.get("API_SEEDED") or 0),
        "by_source": dict(by_source),
        "by_destination": dict(by_destination),
        "duplicates_in_file": duplicates_in_file,
        "authoritative_ids": scoped_ids,
        "all_valid_ids": all_ids,
        "authoritative_ids_hash": id_hash,
    }


def audit_shard_assignment(
    snapshot: dict[str, Any],
    *,
    authoritative_ids: set[str],
    selected_shard_ids: Optional[list[str]] = None,
) -> dict[str, Any]:
    """Audit per-shard assignment integrity against an authoritative ID set."""
    shards = list(snapshot.get("shards") or [])
    selected = set(selected_shard_ids) if selected_shard_ids is not None else None
    assign: dict[str, list[str]] = {}
    shard_rows: list[dict[str, Any]] = []
    listed_sum = 0
    expected_sum = 0
    within_dup = 0

    for s in shards:
        sid = s.get("shard_id")
        ids = list(s.get("combination_ids") or [])
        exp = int(s.get("expected_count") or 0)
        uniq = len(set(ids))
        dup = len(ids) - uniq
        within_dup += dup
        listed_sum += len(ids)
        expected_sum += exp
        for cid in ids:
            assign.setdefault(cid, []).append(sid)
        extra = sorted(set(ids) - authoritative_ids)
        missing_in_auth = 0  # per-shard missing vs auth is computed globally
        st = "fault" if str(sid).startswith("xp-fault-") else "normal"
        shard_rows.append(
            {
                "shard_id": sid,
                "type": st,
                "route_mode": s.get("route_mode") or snapshot.get("route_runtime"),
                "expected_count": exp,
                "listed_count": len(ids),
                "unique_count": uniq,
                "duplicate_count": dup,
                "extra_count": len(extra),
                "expected_matches_listed": exp == len(ids) and dup == 0,
                "selected": (sid in selected) if selected is not None else True,
            }
        )

    snapshot_ids = set(assign)
    multi = {cid: sids for cid, sids in assign.items() if len(sids) > 1}
    unassigned = sorted(authoritative_ids - snapshot_ids)
    extra = sorted(snapshot_ids - authoritative_ids)

    selected_ids: set[str] = set()
    if selected is not None:
        for s in shards:
            if s.get("shard_id") in selected:
                selected_ids.update(s.get("combination_ids") or [])
    else:
        selected_ids = set(snapshot_ids)

    return {
        "shard_count": len(shards),
        "shard_expected_sum": expected_sum,
        "shard_listed_sum": listed_sum,
        "snapshot_unique": len(snapshot_ids),
        "within_shard_duplicate": within_dup,
        "unassigned": len(unassigned),
        "multi_assigned": len(multi),
        "snapshot_extra": len(extra),
        "snapshot_missing": len(unassigned),
        "selected_unique": len(selected_ids),
        "shards": shard_rows,
        "unassigned_ids_sample": unassigned[:20],
        "extra_ids_sample": extra[:20],
        "multi_assigned_sample": [
            {"combination_id": cid, "shards": sids} for cid, sids in list(multi.items())[:20]
        ],
        "snapshot_ids": snapshot_ids,
        "selected_ids": selected_ids,
    }


def audit_combination_count_integrity(
    *,
    snapshot: dict[str, Any],
    valid_combinations_path: Path,
    selected_shard_ids: list[str],
    route_runtime: str = "ROUTE_ON",
    generation_summary_path: Optional[Path] = None,
) -> dict[str, Any]:
    """Compare authoritative catalog vs snapshot vs selected recovery shards.

    missing/extra are measured against the authoritative catalog scope, not
    merely plan↔snapshot (which can both omit the same IDs and hide gaps).
    """
    catalog = load_catalog_combination_sets(
        valid_combinations_path, route_runtime=route_runtime
    )
    A: set[str] = catalog["authoritative_ids"]
    assignment = audit_shard_assignment(
        snapshot, authoritative_ids=A, selected_shard_ids=selected_shard_ids
    )
    B: set[str] = assignment["snapshot_ids"]
    C: set[str] = assignment["selected_ids"]

    a_minus_b = sorted(A - B)
    b_minus_a = sorted(B - A)
    a_minus_c = sorted(A - C)
    c_minus_a = sorted(C - A)
    b_minus_c = sorted(B - C)
    c_minus_b = sorted(C - B)

    summary = {}
    if generation_summary_path and Path(generation_summary_path).is_file():
        summary = read_json(Path(generation_summary_path), {}) or {}

    generated_candidate = summary.get("candidate_combinations")
    not_applicable = summary.get("not_applicable_combinations")
    applicable_valid = summary.get("valid_combinations", catalog["applicable_valid_count"])

    eq = (
        len(A) == len(B) == len(C) == assignment["shard_expected_sum"] == assignment["shard_listed_sum"]
        and A == B == C
        and assignment["unassigned"] == 0
        and assignment["multi_assigned"] == 0
        and assignment["within_shard_duplicate"] == 0
        and not a_minus_b
        and not b_minus_a
        and not a_minus_c
        and not c_minus_a
    )

    errors: list[str] = []
    if a_minus_b:
        errors.append(f"authoritative_catalog_missing_from_snapshot={len(a_minus_b)}")
    if b_minus_a:
        errors.append(f"snapshot_extra_vs_authoritative={len(b_minus_a)}")
    if a_minus_c:
        errors.append(f"authoritative_catalog_missing_from_selected={len(a_minus_c)}")
    if c_minus_a:
        errors.append(f"selected_extra_vs_authoritative={len(c_minus_a)}")
    if assignment["unassigned"]:
        errors.append(f"unassigned={assignment['unassigned']}")
    if assignment["multi_assigned"]:
        errors.append(f"multi_assigned={assignment['multi_assigned']}")
    if assignment["within_shard_duplicate"]:
        errors.append(f"duplicate={assignment['within_shard_duplicate']}")
    if assignment["shard_expected_sum"] != len(A):
        errors.append(
            f"shard_expected_sum={assignment['shard_expected_sum']} != authoritative={len(A)}"
        )
    route_mismatch = [
        s["shard_id"]
        for s in assignment["shards"]
        if (s.get("route_mode") or route_runtime) != route_runtime
    ]
    if route_mismatch:
        errors.append(f"shard_route_mismatch={len(route_mismatch)}")

    reason = None
    if errors:
        if a_minus_b or assignment["unassigned"]:
            reason = "PREFLIGHT_FAIL_SNAPSHOT_MISSING_COMBINATIONS"
        elif b_minus_a:
            reason = "PREFLIGHT_FAIL_SNAPSHOT_EXTRA_COMBINATIONS"
        elif assignment["multi_assigned"] or assignment["within_shard_duplicate"]:
            reason = "PREFLIGHT_FAIL_SHARD_ASSIGNMENT_INVALID"
        else:
            reason = "PREFLIGHT_FAIL_APPLICABILITY_COUNT_UNPROVEN"

    # Drop heavy sets from serialisable output
    catalog_out = {
        k: v
        for k, v in catalog.items()
        if k not in ("authoritative_ids", "all_valid_ids")
    }
    assign_out = {
        k: v
        for k, v in assignment.items()
        if k not in ("snapshot_ids", "selected_ids")
    }

    return {
        "ok": eq and not errors,
        "reason": reason,
        "errors": errors,
        "count_term_definitions": COUNT_TERM_DEFINITIONS,
        "route_runtime_scope": route_runtime,
        "raw_cartesian_count": None,
        "generated_candidate_count": generated_candidate,
        "applicable_valid_count": applicable_valid,
        "not_applicable_count": not_applicable,
        "authoritative_count": len(A),
        "snapshot_count": len(B),
        "snapshot_unique": assignment["snapshot_unique"],
        "selected_count": len(C),
        "shard_expected_sum": assignment["shard_expected_sum"],
        "shard_listed_sum": assignment["shard_listed_sum"],
        "normal_count": catalog["normal_combination_count"],
        "fault_count": catalog["fault_combination_count"],
        "route_on_count": catalog["route_on_count"],
        "route_off_count": catalog["route_off_count"],
        "missing": len(a_minus_b),
        "extra": len(b_minus_a),
        "duplicate": assignment["within_shard_duplicate"],
        "unassigned": assignment["unassigned"],
        "multi_assigned": assignment["multi_assigned"],
        "authoritative_catalog_missing": len(a_minus_b),
        "authoritative_catalog_extra": len(b_minus_a),
        "snapshot_missing": len(a_minus_b),
        "snapshot_extra": len(b_minus_a),
        "plan_missing": len(a_minus_c),
        "plan_extra": len(c_minus_a),
        "set_diff_counts": {
            "A_minus_B": len(a_minus_b),
            "B_minus_A": len(b_minus_a),
            "A_minus_C": len(a_minus_c),
            "C_minus_A": len(c_minus_a),
            "B_minus_C": len(b_minus_c),
            "C_minus_B": len(c_minus_b),
        },
        "set_diff_samples": {
            "A_minus_B": a_minus_b[:20],
            "B_minus_A": b_minus_a[:20],
            "A_minus_C": a_minus_c[:20],
            "C_minus_A": c_minus_a[:20],
        },
        "authoritative_ids_hash": catalog["authoritative_ids_hash"],
        "catalog": catalog_out,
        "assignment": assign_out,
        "equation_ok": eq,
    }


def preflight_selected_shards(
    *,
    shard_ids: list[str],
    snapshot: dict[str, Any],
    plan_expected: Optional[dict[str, int]] = None,
    valid_combinations_path: Optional[Path] = None,
    route_runtime: str = "ROUTE_ON",
    generation_summary_path: Optional[Path] = None,
) -> dict[str, Any]:
    errors: list[str] = []
    if not shard_ids:
        return {
            "ok": False,
            "reason": "FAILED_PREFLIGHT_ZERO_SHARDS",
            "errors": ["selected_shards=0"],
            "selected_shards": 0,
            "selected_combinations": 0,
        }
    total = 0
    for sid in shard_ids:
        exp = (plan_expected or {}).get(sid)
        v = validate_snapshot_shard(snapshot, shard_id=sid, expected_count=exp)
        if not v["ok"]:
            errors.extend([f"{sid}: {e}" for e in v["errors"]])
        else:
            total += int(v["expected_count"])
    if total <= 0 and not errors:
        errors.append("selected_combinations=0")

    count_audit: Optional[dict[str, Any]] = None
    if valid_combinations_path is not None and not errors:
        count_audit = audit_combination_count_integrity(
            snapshot=snapshot,
            valid_combinations_path=Path(valid_combinations_path),
            selected_shard_ids=list(shard_ids),
            route_runtime=route_runtime,
            generation_summary_path=generation_summary_path,
        )
        if not count_audit["ok"]:
            errors.extend(count_audit.get("errors") or ["authoritative_count_mismatch"])

    reason = None
    if errors:
        if count_audit and count_audit.get("reason"):
            reason = count_audit["reason"]
        elif any("missing from snapshot" in e for e in errors):
            reason = "FAILED_PREFLIGHT_SHARD_PLAN_MISSING"
        elif "selected_shards=0" in errors or "selected_combinations=0" in errors:
            reason = "FAILED_PREFLIGHT_ZERO_SHARDS"
        else:
            reason = "SHARD_PLAN_INVALID"

    out: dict[str, Any] = {
        "ok": not errors,
        "reason": reason,
        "errors": errors,
        "selected_shards": len(shard_ids),
        "selected_combinations": total,
    }
    if count_audit is not None:
        out["count_audit"] = count_audit
        out["authoritative_count"] = count_audit["authoritative_count"]
        out["snapshot_count"] = count_audit["snapshot_count"]
        out["snapshot_unique"] = count_audit["snapshot_unique"]
        out["selected_count"] = count_audit["selected_count"]
        out["shard_expected_sum"] = count_audit["shard_expected_sum"]
        out["normal_count"] = count_audit["normal_count"]
        out["fault_count"] = count_audit["fault_count"]
        out["route_on_count"] = count_audit["route_on_count"]
        out["route_off_count"] = count_audit["route_off_count"]
        out["missing"] = count_audit["missing"]
        out["extra"] = count_audit["extra"]
        out["duplicate"] = count_audit["duplicate"]
        out["unassigned"] = count_audit["unassigned"]
        out["multi_assigned"] = count_audit["multi_assigned"]
        out["authoritative_catalog_missing"] = count_audit["authoritative_catalog_missing"]
        out["authoritative_catalog_extra"] = count_audit["authoritative_catalog_extra"]
        out["snapshot_missing"] = count_audit["snapshot_missing"]
        out["snapshot_extra"] = count_audit["snapshot_extra"]
        out["plan_missing"] = count_audit["plan_missing"]
        out["plan_extra"] = count_audit["plan_extra"]
        out["equation_ok"] = count_audit["equation_ok"]
    return out


def resolve_catalog_paths(
    *,
    e2e_root: Path,
    fallback_e2e_roots: Optional[list[Path]] = None,
) -> tuple[Path, Path]:
    """Locate shard-plan.json + valid-combinations.jsonl, preferring e2e_root then fallbacks."""
    candidates = [Path(e2e_root)]
    for p in fallback_e2e_roots or []:
        if p and Path(p) not in candidates:
            candidates.append(Path(p))
    for root in candidates:
        plan = root / "cross-product" / "generated" / "shard-plan.json"
        catalog = root / "cross-product" / "generated" / "valid-combinations.jsonl"
        if plan.is_file() and catalog.is_file():
            return plan, catalog
    raise FileNotFoundError(
        "unable to locate shard-plan.json + valid-combinations.jsonl in: "
        + ", ".join(str(c) for c in candidates)
    )


def ensure_recovery_snapshot_for_attempt(
    *,
    run_dir: Path,
    attempt_dir: Path,
    e2e_root: Path,
    fallback_e2e_roots: Optional[list[Path]] = None,
    route_runtime: str = "ROUTE_ON",
) -> dict[str, Any]:
    """Create immutable snapshot + plan v2 if missing; never rewrite existing snapshot."""
    existing = load_shard_plan_snapshot(attempt_dir)
    if existing:
        if not (attempt_dir / "recovery-plan.v2.json").exists():
            build_recovery_plan_v2(attempt_dir=attempt_dir, snapshot=existing)
        return existing

    imm = load_immutable_run_manifest(run_dir, allow_bootstrap_write=False) or {}
    plan_path, catalog_path = resolve_catalog_paths(
        e2e_root=e2e_root, fallback_e2e_roots=fallback_e2e_roots
    )
    # Require generation hashes to match immutable when present.
    summary = read_json(plan_path.parent / "generation-summary.json", {}) or {}
    for key in ("manifest_hash", "applicability_rules_hash", "axes_hash"):
        exp = imm.get(key)
        act = summary.get(key)
        if exp and act and str(exp) != str(act):
            raise RuntimeError(f"catalog {key} drift: immutable={exp} catalog={act}")

    snapshot = build_shard_plan_snapshot(
        source_run_id=run_dir.name,
        immutable=imm,
        shard_plan_path=plan_path,
        valid_combinations_path=catalog_path,
        route_runtime=route_runtime,
        source_label="generated_catalog",
    )
    ensure_shard_plan_snapshot(attempt_dir, snapshot, overwrite=False)
    build_recovery_plan_v2(attempt_dir=attempt_dir, snapshot=snapshot)
    return snapshot


def determine_attempt_status(attempt_dir: Path) -> dict[str, Any]:
    """Recovery-attempt status separate from original run final_verdict."""
    attempt_dir = Path(attempt_dir)
    status = load_attempt_status(attempt_dir)
    abort = read_json(attempt_dir / "attempt-abort.json")
    if abort and not status.get("status"):
        status = {
            "status": "FAILED_PREFLIGHT",
            "abort_reason": abort.get("reason"),
            "final_verdict": abort.get("reason"),
        }
    meta = read_json(attempt_dir / "recovery-run-metadata.json", {}) or {}
    if not status.get("status"):
        status = {
            "status": meta.get("status") or "UNKNOWN",
            "final_verdict": meta.get("status") or "UNKNOWN",
        }
    status.setdefault("attempt", attempt_dir.name)
    status.setdefault("attempt_dir", str(attempt_dir))
    return status
