"""Lightweight flaky signal from PASS→FAIL transitions (local dev only; stdlib only)."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET


def _case_outcomes(junit_path: Path) -> dict[str, str]:
    if not junit_path.is_file():
        return {}
    try:
        root = ET.parse(junit_path).getroot()
    except ET.ParseError:
        return {}
    suites: list[ET.Element] = []
    if root.tag == "testsuites":
        suites = list(root.findall("testsuite"))
    elif root.tag == "testsuite":
        suites = [root]
    else:
        return {}

    out: dict[str, str] = {}
    for s in suites:
        for case in s.iter("testcase"):
            name = case.attrib.get("name", "")
            classname = case.attrib.get("classname", "")
            full = f"{classname}::{name}" if classname else name
            status = "pass"
            for child in list(case):
                if child.tag == "skipped":
                    status = "skip"
                elif child.tag in ("failure", "error"):
                    status = "fail"
                    break
            out[full] = status
    return out


def _load_state(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {"per_test": {}, "pass_to_fail_hits": {}}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"per_test": {}, "pass_to_fail_hits": {}}


def _save_state(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def update_state(junit_path: Path, state_path: Path, summary_path: Path) -> None:
    now = datetime.now(timezone.utc).isoformat()
    outcomes = _case_outcomes(junit_path)
    state = _load_state(state_path)
    per_test: dict[str, Any] = state.setdefault("per_test", {})
    hits: dict[str, int] = state.setdefault("pass_to_fail_hits", {})

    for test_id, outcome in outcomes.items():
        prev = per_test.get(test_id, {}).get("last_outcome")
        row = per_test.setdefault(test_id, {})
        if prev == "pass" and outcome == "fail":
            hits[test_id] = int(hits.get(test_id, 0)) + 1
        row["last_outcome"] = outcome
        row["updated_at"] = now
        per_test[test_id] = row

    state["per_test"] = per_test
    state["pass_to_fail_hits"] = hits
    state["updated_at"] = now
    _save_state(state_path, state)

    ranked = sorted(hits.items(), key=lambda kv: kv[1], reverse=True)[:20]
    lines = [
        "# Flaky signals (PASS→FAIL transitions)",
        "",
        f"- updated_at: {now}",
        "",
        "Higher counts suggest unstable tests (heuristic only).",
        "",
    ]
    for name, n in ranked:
        lines.append(f"- {n}x  `{name}`")
    if not ranked:
        lines.append("- (no PASS→FAIL transitions recorded yet)")
    lines.append("")
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    u = sub.add_parser("update")
    u.add_argument("--junit", type=Path, required=True)
    u.add_argument("--state", type=Path, required=True)
    u.add_argument("--summary", type=Path, required=True)
    args = p.parse_args()
    if args.cmd == "update":
        update_state(args.junit, args.state, args.summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
