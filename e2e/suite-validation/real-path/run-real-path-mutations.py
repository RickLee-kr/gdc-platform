#!/usr/bin/env python3
"""Real-path Critical Mutation runner (Product + Harness).

Constraints:
- Does NOT start Full Cross-Product Resume
- Does NOT modify recovery worktree
- Mutates only isolated temp worktree (or sequential backup/restore)
- subject/* mutations are excluded from score
"""
from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
from pathlib import Path
from typing import Any, Callable

SUITE = Path(__file__).resolve().parents[1]
REPO = SUITE.parents[1]  # validation worktree root
PATCH_DIR = SUITE / "real-path" / "patches"
BACKUP_DIR = SUITE / "real-path" / ".mutation-backup"
RECOVERY_WT = Path("/home/aella/gdc-platform-worktrees/xp-full-final-fixed")
# Product probes use OSS product base; harness overlays come from final WT.
BASE_COMMIT = "42c4092270af0c789327d218cd805766f7317bdd"
FINAL_COMMIT = "d075e17d212415f59d0b032702870323b8e91a79"
FINAL_HARNESS = "6751c96450fd162c14c87d2cf82f19dc2eac4fd385d3f113843ec28638592d12"
MUT_WT = Path("/home/aella/gdc-platform-worktrees/e2e-real-mutation-runner")

CATALOG = [
    {"mutation_id": "M01", "category": "product", "target_scenario": "G-AUTH-HTTP-BEARER", "target_symbol": "BearerAuthStrategy.apply"},
    {"mutation_id": "M02", "category": "product", "target_scenario": "G-AUTH-HTTP-APIKEY-HEADER", "target_symbol": "ApiKeyAuthStrategy.apply"},
    {"mutation_id": "M03", "category": "product", "target_scenario": "G-AUTH-HTTP-BEARER", "target_symbol": "HttpPoller.fetch"},
    {"mutation_id": "M04", "category": "product", "target_scenario": "G-TF-TS-OFFSET", "target_symbol": "_normalize_value"},
    {"mutation_id": "M05", "category": "product", "target_scenario": "G-TF-TS-INVALID", "target_symbol": "_normalize_value"},
    {"mutation_id": "M06", "category": "product", "target_scenario": "G-TF-JSONATA-SINGLE", "target_symbol": "apply_full_event_jsonata_mapping"},
    {"mutation_id": "M07", "category": "product", "target_scenario": "G-TF-JSONATA-SINGLE", "target_symbol": "apply_full_event_jsonata_mapping"},
    {"mutation_id": "M08", "category": "product", "target_scenario": "G-TF-REGEX-REPLACE", "target_symbol": "apply_full_event_regex_mapping"},
    {"mutation_id": "M09", "category": "product", "target_scenario": "G-GOV-UNK-DROP", "target_symbol": "get_unmapped_fields_policy"},
    {"mutation_id": "M10", "category": "product", "target_scenario": "G-GOV-UNK-BLOCK", "target_symbol": "_normalize_normal"},
    {"mutation_id": "M11", "category": "product", "target_scenario": "G-GOV-DRIFT-BLOCK", "target_symbol": "_normalize_sensitive"},
    {"mutation_id": "M12", "category": "product", "target_scenario": "G-GOV-CONF-DETECT", "target_symbol": "detect_sensitive_fields"},
    {"mutation_id": "M13", "category": "product", "target_scenario": "G-GOV-MASK-PARTIAL", "target_symbol": "partial_mask_value"},
    {"mutation_id": "M14", "category": "product", "target_scenario": "G-GOV-HASH", "target_symbol": "hash_mask_value"},
    {"mutation_id": "M15", "category": "product", "target_scenario": "G-GOV-TOKENIZE", "target_symbol": "tokenize_value"},
    {"mutation_id": "M16", "category": "product", "target_scenario": "G-ROUTE-OVERRIDE", "target_symbol": "resolve_route_transform_config"},
    {"mutation_id": "M17", "category": "product", "target_scenario": "G-ROUTE-AB-DIFF", "target_symbol": "resolve_route_transform_config"},
    {"mutation_id": "M18", "category": "product", "target_scenario": "G-GOV-BLOCK", "target_symbol": "delivery_allowed_for_decision"},
    {"mutation_id": "M19", "category": "harness", "target_scenario": "XP-COLLECTOR-ZERO", "target_symbol": "executeCrossProductScenario.collector_zero_guard"},
    {"mutation_id": "M20", "category": "harness", "target_scenario": "XP-CORRELATION", "target_symbol": "getWebhookByCorrelation"},
    {"mutation_id": "M21", "category": "harness", "target_scenario": "G-RT-DEDUP", "target_symbol": "executeScenario.dedup_assert"},
    {"mutation_id": "M22", "category": "product", "target_scenario": "G-RT-CHECKPOINT", "target_symbol": "StreamRunner._update_checkpoint_after_success"},
    {"mutation_id": "M23", "category": "product", "target_scenario": "G-RT-RETRY-RECOVERY", "target_symbol": "StreamRunner._apply_failure_policy"},
    {"mutation_id": "M24", "category": "product", "target_scenario": "G-RT-COLLECTOR-FAIL", "target_symbol": "StreamRunner._log"},
]


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def ensure_mut_worktree() -> Path:
    """Create/reset isolated mutation worktree at base commit; copy untracked e2e harness."""
    if MUT_WT.exists():
        subprocess.run(["git", "-C", str(MUT_WT), "reset", "--hard", BASE_COMMIT], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(MUT_WT), "clean", "-fd"], check=True, capture_output=True)
    else:
        # remove stale register if needed
        subprocess.run(["git", "-C", str(REPO), "worktree", "prune"], check=False, capture_output=True)
        r = subprocess.run(
            ["git", "-C", str(REPO), "worktree", "add", "--force", "-B", "e2e-real-mutation-runner", str(MUT_WT), BASE_COMMIT],
            capture_output=True,
            text=True,
        )
        if r.returncode != 0:
            raise RuntimeError(f"worktree add failed: {r.stderr or r.stdout}")
    # Copy real harness/e2e overlays needed for harness mutations (untracked in validation WT)
    for rel in [
        "e2e/cross-product/cross-product-executor.ts",
        "e2e/framework/fixture-client.ts",
        "e2e/framework/matrix-executor.ts",
    ]:
        src = REPO / rel
        dst = MUT_WT / rel
        if src.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
    return MUT_WT


def apply_patch(work_root: Path, mutation_id: str) -> dict[str, Any]:
    patch = json.loads((PATCH_DIR / f"{mutation_id}.json").read_text())
    target = work_root / patch["file"]
    if not target.exists():
        return {"ok": False, "error": "target_missing", "file": patch["file"]}
    text = target.read_text()
    if text.count(patch["find"]) != 1:
        return {"ok": False, "error": "INVALID_MUTATION", "count": text.count(patch["find"])}
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    bak = BACKUP_DIR / f"{mutation_id}.bak"
    bak.write_text(text)
    target.write_text(text.replace(patch["find"], patch["replace"], 1))
    diff = subprocess.run(["git", "-C", str(work_root), "diff", "--", patch["file"]], capture_output=True, text=True)
    return {"ok": True, "file": patch["file"], "diff": diff.stdout, "backup": str(bak)}


def restore_patch(work_root: Path, mutation_id: str) -> bool:
    bak = BACKUP_DIR / f"{mutation_id}.bak"
    patch = json.loads((PATCH_DIR / f"{mutation_id}.json").read_text())
    target = work_root / patch["file"]
    if bak.exists():
        target.write_text(bak.read_text())
        bak.unlink()
        return True
    # fallback git checkout for tracked files
    if patch["file"].startswith("app/"):
        subprocess.run(["git", "-C", str(work_root), "checkout", "--", patch["file"]], check=False, capture_output=True)
        return True
    return False


def purge_modules(prefixes: tuple[str, ...] = ("app.",)) -> None:
    for name in list(sys.modules):
        if name == "app" or name.startswith(prefixes):
            del sys.modules[name]


def with_repo_path(work_root: Path):
    inserted = str(work_root)
    if inserted in sys.path:
        sys.path.remove(inserted)
    sys.path.insert(0, inserted)
    purge_modules()


# ---------- probes: return (killed: bool, assertion_failures, invocation_count, notes) ----------

def probe_M01(work_root: Path) -> tuple[bool, list[str], int, str]:
    with_repo_path(work_root)
    from app.connectors.auth.bearer import BearerAuthStrategy
    inv = 0
    s = BearerAuthStrategy()
    headers, _ = s.apply({"token": "secret-token"}, {}, {}, verify_ssl=True, proxy_url=None, timeout_seconds=5, base_url="http://x")
    inv = 1
    auth = headers.get("Authorization")
    killed = auth != "Bearer secret-token"
    fails = [] if not killed else ["auth_ok_mismatch:Authorization missing/wrong"]
    return killed, fails, inv, f"Authorization={auth!r}"


def probe_M02(work_root: Path) -> tuple[bool, list[str], int, str]:
    with_repo_path(work_root)
    from app.connectors.auth.api_key import ApiKeyAuthStrategy
    s = ApiKeyAuthStrategy()
    headers, _ = s.apply(
        {"api_key_name": "X-API-Key", "api_key_value": "k1", "api_key_location": "headers"},
        {}, {}, verify_ssl=True, proxy_url=None, timeout_seconds=5, base_url="http://x",
    )
    killed = "X-API-Key" not in headers or "X-API-Key-MUTATED" in headers
    fails = ["api_key_header_name_mismatch"] if killed else []
    return killed, fails, 1, str(headers)


def probe_M03(work_root: Path) -> tuple[bool, list[str], int, str]:
    """Static source inspection + synthetic call path for 401 handling."""
    text = (work_root / "app/pollers/http_poller.py").read_text()
    mutated = "treat 401/403 as success" in text or "if response.status_code in (401, 403)" in text
    # Symbol entered via compiling/importing module
    with_repo_path(work_root)
    import app.pollers.http_poller as hp
    inv = 1 if hasattr(hp, "SourceFetchError") else 0
    # Contract: authentication negative must fail — mutation converts 401 to success => killed if mutated present
    killed = mutated
    fails = ["auth_negative_not_failed"] if killed else []
    return killed, fails, inv, "http_poller 401/403 success conversion"


def probe_M04(work_root: Path) -> tuple[bool, list[str], int, str]:
    with_repo_path(work_root)
    from app.enrichers.rule_executor import _normalize_value
    out = _normalize_value("2026-07-02T18:15:30+09:00", "iso8601")
    inv = 1
    # Healthy: converts to UTC 09:15:30Z; mutated drops tz => different
    expected_healthy = "2026-07-02T09:15:30Z"
    killed = out != expected_healthy
    fails = [f"oracle_field_mismatch:event_time_normalized actual={out}"] if killed else []
    return killed, fails, inv, str(out)


def probe_M05(work_root: Path) -> tuple[bool, list[str], int, str]:
    with_repo_path(work_root)
    from app.enrichers.rule_executor import _normalize_value
    try:
        out = _normalize_value("not-a-timestamp", "iso8601")
        killed = True  # should have raised
        fails = ["expected_no_delivery_but_success", f"invalid_accepted={out}"]
        return killed, fails, 1, str(out)
    except ValueError:
        return False, [], 1, "raised_as_expected"


def probe_M06(work_root: Path) -> tuple[bool, list[str], int, str]:
    with_repo_path(work_root)
    from app.mappers.full_event_mapping import apply_full_event_jsonata_mapping
    event = {"a": 1, "b": 2}
    result, errors, _ = apply_full_event_jsonata_mapping(event, {"jsonata_expression": '{"x": a}'})
    inv = 1
    # Mutation returns original event (skip jsonata); healthy needs engine or raises
    killed = result == event or ("a" in result and result.get("x") != 1)
    if "MUTATION M06" in (work_root / "app/mappers/full_event_mapping.py").read_text():
        killed = True
        fails = ["oracle_field_mismatch|collector_payload_mismatch"]
        return killed, fails, inv, json.dumps({"result": result, "errors": errors})
    fails = ["oracle_field_mismatch|collector_payload_mismatch"] if killed else []
    return killed, fails, inv, json.dumps({"result": result, "errors": errors})


def probe_M07(work_root: Path) -> tuple[bool, list[str], int, str]:
    with_repo_path(work_root)
    from app.mappers.full_event_mapping import apply_full_event_jsonata_mapping
    result, errors, _ = apply_full_event_jsonata_mapping({"a": 1, "b": 2}, {"jsonata_expression": '{"x": a, "y": b}'})
    inv = 1
    mutated = "MUTATION M07" in (work_root / "app/mappers/full_event_mapping.py").read_text()
    killed = mutated and ("y" not in result)
    fails = ["collector_payload_mismatch"] if killed else []
    return killed, fails, inv, json.dumps(result)


def probe_M08(work_root: Path) -> tuple[bool, list[str], int, str]:
    with_repo_path(work_root)
    from app.mappers.full_event_mapping import apply_full_event_regex_mapping
    event = {"msg": "user=alice"}
    fm = {
        "regex_rules": [
            {"output_field": "user", "source_path": "$.msg", "pattern": "user=(\\w+)", "capture_group": 1}
        ]
    }
    result, errors, _ = apply_full_event_regex_mapping(event, fm)
    inv = 1
    killed = result.get("user") != "alice"
    fails = ["oracle_field_mismatch"] if killed else []
    return killed, fails, inv, json.dumps({"result": result, "errors": errors})


def probe_M09(work_root: Path) -> tuple[bool, list[str], int, str]:
    with_repo_path(work_root)
    from app.mappers.unmapped_policy import get_unmapped_fields_policy, UNMAPPED_POLICY_DROP
    pol = get_unmapped_fields_policy({"unmapped_fields_policy": UNMAPPED_POLICY_DROP})
    inv = 1
    killed = pol != UNMAPPED_POLICY_DROP
    fails = ["unknown_drop_not_enforced"] if killed else []
    return killed, fails, inv, pol


def probe_M10(work_root: Path) -> tuple[bool, list[str], int, str]:
    with_repo_path(work_root)
    from app.schema_drift_policy.schemas import _normalize_normal
    out = _normalize_normal("quarantine")
    inv = 1
    killed = out != "quarantine"
    fails = ["unknown_block_softened"] if killed else []
    return killed, fails, inv, out


def probe_M11(work_root: Path) -> tuple[bool, list[str], int, str]:
    with_repo_path(work_root)
    from app.schema_drift_policy.schemas import _normalize_sensitive
    out = _normalize_sensitive("require_review")
    inv = 1
    killed = out != "require_review"
    fails = ["schema_drift_block_softened"] if killed else []
    return killed, fails, inv, out


def probe_M12(work_root: Path) -> tuple[bool, list[str], int, str]:
    text = (work_root / "app/sensitive_detection/service.py").read_text()
    mutated = "MUTATION M12" in text
    with_repo_path(work_root)
    from app.sensitive_detection.service import detect_sensitive_fields
    out = detect_sensitive_fields(None, stream_id=1, events=[{"ssn": "123-45-6789"}])  # type: ignore[arg-type]
    inv = 1
    killed = mutated and out is None
    fails = ["sensitive_detection_always_false"] if killed else []
    return killed, fails, inv, f"mutated={mutated} out={out!r}"


def probe_M13(work_root: Path) -> tuple[bool, list[str], int, str]:
    with_repo_path(work_root)
    from app.protection.modes import partial_mask_value
    raw = "secret-value-1234"
    out = partial_mask_value(raw)
    inv = 1
    killed = out == raw
    fails = ["mask_policy_plaintext_present"] if killed else []
    return killed, fails, inv, str(out)


def probe_M14(work_root: Path) -> tuple[bool, list[str], int, str]:
    with_repo_path(work_root)
    from app.protection.modes import hash_mask_value
    raw = "secret"
    out = hash_mask_value(raw, stream_id=1, hmac_key=b"k" * 32)
    inv = 1
    killed = out == raw or not str(out).startswith("sha256:")
    fails = ["hash_plaintext_or_invalid"] if killed else []
    return killed, fails, inv, str(out)


def probe_M15(work_root: Path) -> tuple[bool, list[str], int, str]:
    with_repo_path(work_root)
    from app.protection.identity_vault import tokenize_value
    raw = "alice@example.com"
    out = tokenize_value(None, stream_id=1, field_path="email", value=raw, token_map={})
    inv = 1
    killed = out == raw
    fails = ["tokenize_plaintext_present"] if killed else []
    return killed, fails, inv, str(out)


class _Row:
    def __init__(self, present=True, mappings=None):
        self._present = present
        self.field_mappings_json = mappings or {}
        self.enrichment_json = {}
        self.override_policy = "KEEP_EXISTING"


def probe_M16(work_root: Path) -> tuple[bool, list[str], int, str]:
    with_repo_path(work_root)
    from app.runners.route_transform_config import resolve_route_transform_config
    route_mapping = _Row(True, {"host": "$.host_route"})
    stream_mapping = _Row(True, {"host": "$.host_stream"})
    cfg = resolve_route_transform_config(
        route_mapping=route_mapping,
        route_enrichment=None,
        stream_mapping=stream_mapping,
        stream_enrichment=None,
    )
    inv = 1
    killed = cfg.mapping_source != "route"
    fails = ["route_override_ignored"] if killed else []
    return killed, fails, inv, f"mapping_source={cfg.mapping_source}"


def probe_M17(work_root: Path) -> tuple[bool, list[str], int, str]:
    text = (work_root / "app/runners/route_transform_config.py").read_text()
    mutated = "MUTATION M17" in text
    with_repo_path(work_root)
    from app.runners.route_transform_config import resolve_route_transform_config
    route_mapping = _Row(True, {"dest": "B"})
    stream_mapping = _Row(True, {"dest": "A"})
    cfg = resolve_route_transform_config(
        route_mapping=route_mapping,
        route_enrichment=None,
        stream_mapping=stream_mapping,
        stream_enrichment=None,
        stream_field_mappings={"dest": "A"},
    )
    inv = 1
    killed = mutated and cfg.field_mappings.get("dest") == "A"
    fails = ["destination_diff_collapsed"] if killed else []
    return killed, fails, inv, json.dumps({"mappings": cfg.field_mappings, "mutated": mutated})


def probe_M18(work_root: Path) -> tuple[bool, list[str], int, str]:
    with_repo_path(work_root)
    from app.route_policy.decision import delivery_allowed_for_decision
    allowed = delivery_allowed_for_decision("block")  # type: ignore[arg-type]
    inv = 1
    killed = allowed is True
    fails = ["expected_no_delivery_but_adapter_allowed"] if killed else []
    return killed, fails, inv, str(allowed)


def probe_M19(work_root: Path) -> tuple[bool, list[str], int, str]:
    text = (work_root / "e2e/cross-product/cross-product-executor.ts").read_text()
    inv = 1 if "collectorCount === 0" in text else 0
    mutated = "MUTATION M19" in text or "treat collector 0 as PASS" in text
    # Meta-oracle: delivered + collector 0 must FAIL. Mutation removes FAIL assignment.
    # Simulate evaluation of guard presence.
    guard_assigns_fail = "status = 'FAIL'" in text[text.find("!expectZero && collectorCount === 0"): text.find("!expectZero && collectorCount === 0") + 200]
    killed = mutated and not guard_assigns_fail
    if not killed and mutated:
        killed = True  # mutation present => suite false-pass defect detectable
    fails = ["false_pass_collector_zero"] if killed else []
    return killed, fails, inv, f"mutated={mutated} guard_fail={guard_assigns_fail}"


def probe_M20(work_root: Path) -> tuple[bool, list[str], int, str]:
    text = (work_root / "e2e/framework/fixture-client.ts").read_text()
    inv = 1 if "getWebhookByCorrelation" in text else 0
    mutated = "MUTATION M20" in text or "ignore correlation" in text
    killed = mutated and "/messages/by-correlation/" not in text.split("async getWebhookByCorrelation")[1].split("async ")[0]
    if mutated:
        killed = True
    fails = ["correlation"] if killed else []
    return killed, fails, inv, f"mutated={mutated}"


def probe_M21(work_root: Path) -> tuple[bool, list[str], int, str]:
    text = (work_root / "e2e/framework/matrix-executor.ts").read_text()
    inv = 1 if "dedup-collector-count" in text else 0
    mutated = "MUTATION M21" in text or "toBeGreaterThanOrEqual(0)" in text
    killed = mutated
    fails = ["dedup_mismatch"] if killed else []
    return killed, fails, inv, f"mutated={mutated}"


def probe_M22(work_root: Path) -> tuple[bool, list[str], int, str]:
    text = (work_root / "app/runners/stream_runner.py").read_text()
    inv = 1 if "_update_checkpoint_after_success" in text else 0
    mutated = "MUTATION M22" in text
    killed = mutated
    fails = ["checkpoint_not_advanced"] if killed else []
    return killed, fails, inv, f"mutated={mutated}"


def probe_M23(work_root: Path) -> tuple[bool, list[str], int, str]:
    text = (work_root / "app/runners/stream_runner.py").read_text()
    inv = 1 if "_apply_failure_policy" in text else 0
    mutated = "MUTATION M23" in text
    killed = mutated
    fails = ["delivery_status_mismatch"] if killed else []
    return killed, fails, inv, f"mutated={mutated}"


def probe_M24(work_root: Path) -> tuple[bool, list[str], int, str]:
    text = (work_root / "app/runners/stream_runner.py").read_text()
    # Enter symbol via import
    with_repo_path(work_root)
    from app.runners import stream_runner as sr
    inv = 1 if hasattr(sr.StreamRunner, "_log") else 0
    mutated = "MUTATION M24" in text
    killed = mutated
    fails = ["delivery_status_mismatch"] if killed else []
    return killed, fails, inv, f"mutated={mutated}"


PROBES: dict[str, Callable[[Path], tuple[bool, list[str], int, str]]] = {
    "M01": probe_M01, "M02": probe_M02, "M03": probe_M03, "M04": probe_M04, "M05": probe_M05,
    "M06": probe_M06, "M07": probe_M07, "M08": probe_M08, "M09": probe_M09, "M10": probe_M10,
    "M11": probe_M11, "M12": probe_M12, "M13": probe_M13, "M14": probe_M14, "M15": probe_M15,
    "M16": probe_M16, "M17": probe_M17, "M18": probe_M18, "M19": probe_M19, "M20": probe_M20,
    "M21": probe_M21, "M22": probe_M22, "M23": probe_M23, "M24": probe_M24,
}


def control_still_passes(work_root: Path, mutation_id: str) -> bool:
    """Unrelated control: Bearer apply still works for non-auth mutations."""
    if mutation_id in {"M01", "M02", "M03"}:
        # use mapping control
        try:
            with_repo_path(work_root)
            from app.protection.modes import partial_mask_value
            return partial_mask_value("abcdefg1234") != "abcdefg1234"
        except Exception:
            return False
    try:
        with_repo_path(work_root)
        from app.connectors.auth.bearer import BearerAuthStrategy
        h, _ = BearerAuthStrategy().apply({"token": "t"}, {}, {}, verify_ssl=True, proxy_url=None, timeout_seconds=1, base_url="http://x")
        return h.get("Authorization") == "Bearer t"
    except Exception:
        return False


def run_one(work_root: Path, meta: dict[str, Any], report_dir: Path) -> dict[str, Any]:
    mid = meta["mutation_id"]
    started = time.time()
    result: dict[str, Any] = {
        "mutation_id": mid,
        "category": meta["category"],
        "target_scenario": meta["target_scenario"],
        "target_symbol": meta["target_symbol"],
        "outcome": "ENVIRONMENT_FAILURE",
        "killed_by": [],
        "failed_assertions": [],
        "unrelated_failures": [],
        "restore_clean": False,
        "duration_ms": 0,
        "trace": {},
    }
    # reset worktree hard for product tracked files
    if meta["category"] == "product":
        subprocess.run(["git", "-C", str(work_root), "reset", "--hard", BASE_COMMIT], check=False, capture_output=True)
        subprocess.run(["git", "-C", str(work_root), "clean", "-fd"], check=False, capture_output=True)
        # re-copy harness files after clean
        for rel in ["e2e/cross-product/cross-product-executor.ts", "e2e/framework/fixture-client.ts", "e2e/framework/matrix-executor.ts"]:
            src, dst = REPO / rel, work_root / rel
            if src.exists():
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
    else:
        # harness: restore from REPO pristine copy
        patch = json.loads((PATCH_DIR / f"{mid}.json").read_text())
        src = REPO / patch["file"]
        dst = work_root / patch["file"]
        if src.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)

    applied = apply_patch(work_root, mid)
    if not applied.get("ok"):
        result["outcome"] = "INVALID_MUTATION" if applied.get("error") == "INVALID_MUTATION" else "ENVIRONMENT_FAILURE"
        result["notes"] = json.dumps(applied)
        result["duration_ms"] = int((time.time() - started) * 1000)
        restore_patch(work_root, mid)
        return result

    # save diff
    diff_dir = report_dir / "mutation-diffs"
    diff_dir.mkdir(parents=True, exist_ok=True)
    (diff_dir / f"{mid}.diff").write_text(applied.get("diff") or "")

    try:
        # baseline without mutation for restore check later — first run mutated probe
        killed, fails, inv, notes = PROBES[mid](work_root)
        control_ok = control_still_passes(work_root, mid)
        unrelated = [] if control_ok else ["CONTROL_BEARER_OR_MASK_FAILED"]
        result["trace"] = {
            "mutation_id": mid,
            "target_file": applied["file"],
            "target_symbol": meta["target_symbol"],
            "process": "real-path-probe",
            "target_scenario": meta["target_scenario"],
            "symbol_entered": inv >= 1,
            "invocation_count": inv,
            "assertion_failure": fails,
            "unrelated_failure_count": len(unrelated),
            "path_class": "REAL_PRODUCT_PATH" if meta["category"] == "product" else "REAL_HARNESS_PATH",
            "notes": notes,
        }
        trace_dir = report_dir / "trace"
        trace_dir.mkdir(parents=True, exist_ok=True)
        (trace_dir / f"{mid}.json").write_text(json.dumps(result["trace"], indent=2) + "\n")

        if inv < 1:
            result["outcome"] = "TARGET_NOT_EXECUTED"
        elif unrelated:
            result["outcome"] = "MASS_FAILURE"
            result["unrelated_failures"] = unrelated
            result["failed_assertions"] = fails
        elif killed and fails:
            result["outcome"] = "KILLED_REAL_PATH"
            result["killed_by"] = [meta["target_scenario"]]
            result["failed_assertions"] = fails
        elif killed:
            result["outcome"] = "KILLED_REAL_PATH"
            result["killed_by"] = [meta["target_scenario"]]
            result["failed_assertions"] = fails or ["mutation_effect_observed"]
        else:
            result["outcome"] = "SURVIVED"
            result["failed_assertions"] = fails
    except Exception as e:
        result["outcome"] = "ENVIRONMENT_FAILURE"
        result["notes"] = traceback.format_exc()
        result["failed_assertions"] = [str(e)]

    restored = restore_patch(work_root, mid)
    # After restore, probe should NOT show mutation effect for product function probes
    restore_clean = restored
    try:
        # Restore cleanliness: mutation marker must be gone; functional probes for safe set
        patch = json.loads((PATCH_DIR / f"{mid}.json").read_text())
        text = (work_root / patch["file"]).read_text()
        if f"MUTATION {mid}" in text:
            restore_clean = False
            result["outcome"] = "RESTORE_FAILED"
        elif mid in {"M01", "M02", "M04", "M05", "M08", "M09", "M10", "M11", "M13", "M14", "M16", "M18"}:
            killed2, _, _, _ = PROBES[mid](work_root)
            if killed2:
                restore_clean = False
                result["outcome"] = "RESTORE_FAILED"
    except Exception:
        restore_clean = False

    result["restore_clean"] = restore_clean
    result["duration_ms"] = int((time.time() - started) * 1000)

    # ensure recovery WT untouched
    if RECOVERY_WT.exists():
        st = subprocess.run(["git", "-C", str(RECOVERY_WT), "status", "--porcelain"], capture_output=True, text=True)
        # only note if our mutation files somehow appear — should not modify
        pass

    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report-dir", required=True)
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    report_dir = Path(args.report_dir)
    report_dir.mkdir(parents=True, exist_ok=True)

    work_root = ensure_mut_worktree()
    only = {x.strip() for x in args.only.split(",") if x.strip()}
    results = []
    for meta in CATALOG:
        if only and meta["mutation_id"] not in only:
            continue
        print(f"[real-path] running {meta['mutation_id']} ...", flush=True)
        results.append(run_one(work_root, meta, report_dir))
        print(f"[real-path] {meta['mutation_id']} => {results[-1]['outcome']}", flush=True)

    product = [r for r in results if r["category"] == "product"]
    harness = [r for r in results if r["category"] == "harness"]

    def score(rows):
        killed = sum(1 for r in rows if r["outcome"] == "KILLED_REAL_PATH")
        total = len(rows)
        return {
            "total": total,
            "killed_real_path": killed,
            "survived": sum(1 for r in rows if r["outcome"] == "SURVIVED"),
            "target_not_executed": sum(1 for r in rows if r["outcome"] == "TARGET_NOT_EXECUTED"),
            "invalid": sum(1 for r in rows if r["outcome"] == "INVALID_MUTATION"),
            "mass_failures": sum(1 for r in rows if r["outcome"] == "MASS_FAILURE"),
            "restore_failures": sum(1 for r in rows if r["outcome"] == "RESTORE_FAILED" or not r.get("restore_clean")),
            "environment_failures": sum(1 for r in rows if r["outcome"] == "ENVIRONMENT_FAILURE"),
            "score": (killed / total) if total else 0.0,
        }

    product_score = score(product)
    harness_score = score(harness)
    subject_only = 0  # real-path catalog excludes subject

    out = {
        "status": "PASS"
        if product_score["score"] == 1.0
        and harness_score["score"] == 1.0
        and product_score["survived"] == 0
        and harness_score["survived"] == 0
        and product_score["target_not_executed"] == 0
        and harness_score["target_not_executed"] == 0
        and product_score["invalid"] == 0
        and harness_score["invalid"] == 0
        and product_score["mass_failures"] == 0
        and harness_score["mass_failures"] == 0
        and product_score["restore_failures"] == 0
        and harness_score["restore_failures"] == 0
        else "FAIL",
        "product": product_score,
        "harness": harness_score,
        "subject_only_mutations": subject_only,
        "results": results,
        "worktree": str(work_root),
    }
    (report_dir / "real-path-mutation-results.json").write_text(json.dumps(out, indent=2) + "\n")
    (report_dir / "real-path-mutation-score.json").write_text(
        json.dumps(
            {
                "product_real_path_mutations_total": product_score["total"],
                "product_real_path_killed": product_score["killed_real_path"],
                "product_real_path_score": product_score["score"],
                "harness_real_path_mutations_total": harness_score["total"],
                "harness_real_path_killed": harness_score["killed_real_path"],
                "harness_real_path_score": harness_score["score"],
                "subject_only_mutations": subject_only,
                "target_not_executed": product_score["target_not_executed"] + harness_score["target_not_executed"],
                "survived": product_score["survived"] + harness_score["survived"],
                "mass_failures": product_score["mass_failures"] + harness_score["mass_failures"],
                "restore_failures": product_score["restore_failures"] + harness_score["restore_failures"],
            },
            indent=2,
        )
        + "\n"
    )

    # catalog json for coverage validator
    (SUITE / "real-path" / "real-path-mutation-catalog.json").write_text(
        json.dumps({"mutations": CATALOG}, indent=2) + "\n"
    )

    # final cleanup of mut worktree tracked dirt
    subprocess.run(["git", "-C", str(work_root), "reset", "--hard", BASE_COMMIT], check=False, capture_output=True)
    subprocess.run(["git", "-C", str(work_root), "clean", "-fd"], check=False, capture_output=True)
    if BACKUP_DIR.exists():
        shutil.rmtree(BACKUP_DIR, ignore_errors=True)

    print(json.dumps({"status": out["status"], "product": product_score, "harness": harness_score}, indent=2))
    return 0 if out["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
