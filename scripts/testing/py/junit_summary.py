"""Parse pytest --junitxml output for concise summaries (stdlib only)."""

from __future__ import annotations

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any


def parse_junit_xml(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {
            "error": "missing_file",
            "tests": 0,
            "passed": 0,
            "failed": 0,
            "skipped": 0,
            "failed_tests": [],
            "duration_s": 0.0,
        }
    try:
        tree = ET.parse(path)
    except ET.ParseError as exc:
        return {
            "error": f"parse_error:{exc}",
            "tests": 0,
            "passed": 0,
            "failed": 0,
            "skipped": 0,
            "failed_tests": [],
            "duration_s": 0.0,
        }
    root = tree.getroot()
    suites: list[ET.Element] = []
    if root.tag == "testsuites":
        suites = list(root.findall("testsuite"))
    elif root.tag == "testsuite":
        suites = [root]
    else:
        return {
            "error": "unknown_root",
            "tests": 0,
            "passed": 0,
            "failed": 0,
            "skipped": 0,
            "failed_tests": [],
            "duration_s": 0.0,
        }

    tests = 0
    failures = 0
    errors = 0
    skipped = 0
    duration = 0.0
    for s in suites:
        tests += int(s.attrib.get("tests", 0) or 0)
        failures += int(s.attrib.get("failures", 0) or 0)
        errors += int(s.attrib.get("errors", 0) or 0)
        skipped += int(s.attrib.get("skipped", 0) or 0)
        duration += float(s.attrib.get("time", 0) or 0.0)

    failed_tests: list[dict[str, str]] = []
    for s in suites:
        for case in s.iter("testcase"):
            name = case.attrib.get("name", "")
            classname = case.attrib.get("classname", "")
            full = f"{classname}::{name}" if classname else name
            for child in list(case):
                if child.tag in ("failure", "error"):
                    msg = child.attrib.get("message") or child.text or ""
                    failed_tests.append({"name": full, "message": msg[:500]})

    failed_total = failures + errors
    passed = tests - failed_total - skipped
    if passed < 0:
        passed = 0
    return {
        "tests": tests,
        "passed": passed,
        "failed": failed_total,
        "skipped": skipped,
        "failed_tests": failed_tests,
        "duration_s": round(duration, 3),
    }


def format_text(data: dict[str, Any]) -> str:
    if data.get("error"):
        return f"summary error={data['error']}"
    names = ", ".join(f["name"] for f in data.get("failed_tests", [])[:8])
    more = "" if len(data.get("failed_tests", [])) <= 8 else " …"
    return (
        f"tests={data['tests']} passed={data['passed']} failed={data['failed']} "
        f"skipped={data['skipped']} duration_s={data['duration_s']}"
        + (f" failures: {names}{more}" if names else "")
    )


def write_markdown(path: Path, data: dict[str, Any]) -> None:
    lines = [
        "# Pytest summary",
        "",
        f"- tests: {data.get('tests', 0)}",
        f"- passed: {data.get('passed', 0)}",
        f"- failed: {data.get('failed', 0)}",
        f"- skipped: {data.get('skipped', 0)}",
        f"- duration_s: {data.get('duration_s', 0)}",
        "",
    ]
    if data.get("error"):
        lines.append(f"- parse_note: `{data['error']}`")
        lines.append("")
    ft = data.get("failed_tests") or []
    if ft:
        lines.append("## Failed tests")
        lines.append("")
        for row in ft:
            lines.append(f"- `{row['name']}`")
        lines.append("")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    p = argparse.ArgumentParser(description="Summarize pytest junitxml output.")
    p.add_argument("junit_path", type=Path)
    p.add_argument("--json", action="store_true", help="print JSON (default if no other format)")
    p.add_argument("--text", action="store_true", help="print one-line human summary")
    p.add_argument("--markdown", type=Path, metavar="PATH", help="write markdown summary file")
    args = p.parse_args()
    data = parse_junit_xml(args.junit_path)
    if args.markdown:
        write_markdown(args.markdown, data)
    if args.text:
        print(format_text(data))
    if args.json or (not args.text and not args.markdown):
        print(json.dumps(data, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
