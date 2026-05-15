#!/usr/bin/env python3
"""Emit one-line watch fields from junit + pytest exit code (same dir imports)."""

from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from junit_summary import parse_junit_xml  # noqa: E402
from regression_transition import describe_transition  # noqa: E402


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: e2e_watch_stats.py <junit.xml> <pytest_rc> [prev_status]", file=sys.stderr)
        return 2
    junit = Path(sys.argv[1])
    rc = int(sys.argv[2])
    prev = (sys.argv[3] if len(sys.argv) > 3 else "UNKNOWN").strip().upper()
    d = parse_junit_xml(junit)
    err = d.get("error")
    tests = int(d.get("tests") or 0)
    failed = int(d.get("failed") or 0)
    if rc != 0 or err or tests == 0 or failed > 0:
        curr = "FAIL"
    else:
        curr = "PASS"
    p = prev if prev in ("PASS", "FAIL") else "UNKNOWN"
    msg = describe_transition(p, curr) if p in ("PASS", "FAIL") else None
    line = msg or f"state {curr}"
    print(curr)
    print(str(failed))
    print(str(tests))
    print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
