#!/usr/bin/env python3
"""Schemathesis dry-run PoC on a small representative OpenAPI subset.

Not a CI mandatory gate. Builds a filtered schema, runs ``schemathesis run``
(fuzzing phase, low example count) against ``--base-url`` (default: lab API),
and classifies failures as PRODUCT_DEFECT vs SCHEMATHESIS_FALSE_POSITIVE.

Usage:

  PYTHONPATH=. python3 scripts/openapi/export_openapi.py --print-summary
  pip install -r requirements-openapi.txt   # or: pip install 'schemathesis>=3.39,<5'
  PYTHONPATH=. python3 scripts/openapi/schemathesis_poc.py \\
    --base-url http://127.0.0.1:8000 \\
    --out artifacts/openapi/schemathesis-poc.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from copy import deepcopy
from pathlib import Path
from typing import Any


DEFAULT_INCLUDE_PATHS = (
    "/health",
    "/api/v1/auth/login",
    "/api/v1/sources/",
    "/api/v1/runtime/health/overview",
)


def classify_failure(row: dict, require_auth: bool) -> str:
    message = json.dumps(row)
    msg = message.lower()
    received = row.get("received_status")
    # Schemathesis injects bearer material when securitySchemes exist; middleware
    # still validates a *present* token even when REQUIRE_AUTH=false.
    if received == 401 and not require_auth and "auth_token_invalid" in msg:
        return "SCHEMATHESIS_FALSE_POSITIVE"
    if received == 401 and not require_auth and "undocumented http status code" in msg:
        return "SCHEMATHESIS_FALSE_POSITIVE"
    # Framework-level JSON parse failures return detail:string under HTTP 400;
    # login's documented 400 shape is USER_AUTH_FAILED object — negative fuzz FP.
    if "response violates schema" in msg and "there was an error parsing the body" in msg:
        return "SCHEMATHESIS_FALSE_POSITIVE"
    if "undocumented http status code" in msg:
        return "PRODUCT_DEFECT"
    if "response violates schema" in msg or "response schema" in msg:
        return "PRODUCT_DEFECT"
    if "server error" in msg or (isinstance(received, int) and received >= 500):
        return "PRODUCT_DEFECT"
    if "no examples in schema" in msg:
        return "SCHEMATHESIS_FALSE_POSITIVE"
    return "NEEDS_REVIEW"


def filter_schema(schema: dict, include_paths: tuple[str, ...]) -> dict:
    filtered = deepcopy(schema)
    paths = filtered.get("paths") or {}
    missing = [p for p in include_paths if p not in paths]
    if missing:
        # try trailing-slash variants
        resolved = []
        still_missing = []
        for p in include_paths:
            if p in paths:
                resolved.append(p)
            elif not p.endswith("/") and (p + "/") in paths:
                resolved.append(p + "/")
            elif p.endswith("/") and p.rstrip("/") in paths:
                resolved.append(p.rstrip("/"))
            else:
                still_missing.append(p)
        if still_missing:
            raise SystemExit(f"subset paths missing from schema: {still_missing}")
        include_paths = tuple(resolved)
    filtered["paths"] = {p: paths[p] for p in include_paths}
    return filtered


def parse_cli_failures(cli_text: str) -> list[dict[str, Any]]:
    failures: list[dict[str, Any]] = []
    # Blocks like: ___________________________ POST /api/v1/auth/login ____________________________
    parts = re.split(r"\n_{5,}\s*", cli_text)
    for part in parts:
        m = re.match(r"(GET|POST|PUT|PATCH|DELETE)\s+(\S+)", part.strip())
        if not m:
            continue
        method, path = m.group(1), m.group(2)
        if "Test Case ID" not in part and "Received:" not in part and "Response violates" not in part:
            continue
        bullet = re.search(r"-\s+([^\n]+)", part)
        received = re.search(r"Received:\s*(\d+)", part)
        documented = re.search(r"Documented:\s*([^\n]+)", part)
        body = re.search(r"\[(\d+)\][^\n]*:\s*\n\s*`([^`]+)`", part)
        message_bits = []
        if bullet:
            message_bits.append(bullet.group(1).strip())
        if "Response violates schema" in part:
            message_bits.append("Response violates schema")
        if "There was an error parsing the body" in part:
            message_bits.append("There was an error parsing the body")
        if "AUTH_TOKEN_INVALID" in part:
            message_bits.append("AUTH_TOKEN_INVALID")
        message = " | ".join(message_bits) or part[:200].strip()
        status = None
        if received:
            status = int(received.group(1))
        elif body:
            status = int(body.group(1))
        elif re.search(r"\[401\]", part):
            status = 401
        elif re.search(r"\[400\]", part):
            status = 400
        failures.append(
            {
                "method": method,
                "path": path,
                "message": message,
                "received_status": status,
                "documented_statuses": documented.group(1).strip() if documented else None,
                "response_excerpt": body.group(2)[:400] if body else None,
            }
        )
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", type=Path, default=Path("artifacts/openapi/openapi.json"))
    parser.add_argument("--out", type=Path, default=Path("artifacts/openapi/schemathesis-poc.json"))
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--max-examples", type=int, default=5)
    parser.add_argument(
        "--include-path",
        action="append",
        dest="include_paths",
        default=None,
    )
    parser.add_argument("--phases", default="fuzzing")
    args = parser.parse_args()

    require_auth = os.environ.get("REQUIRE_AUTH", "false").lower() in {"1", "true", "yes"}
    include = tuple(args.include_paths) if args.include_paths else DEFAULT_INCLUDE_PATHS

    if not args.schema.is_file():
        from scripts.openapi.export_openapi import dumps_deterministic, export_schema

        os.environ.setdefault("PYTHONPATH", ".")
        schema = export_schema()
        args.schema.parent.mkdir(parents=True, exist_ok=True)
        args.schema.write_text(dumps_deterministic(schema), encoding="utf-8")
    else:
        schema = json.loads(args.schema.read_text(encoding="utf-8"))

    subset = filter_schema(schema, include)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    subset_path = args.out.parent / "openapi.subset.json"
    subset_path.write_text(json.dumps(subset, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    st_bin = shutil.which("schemathesis")
    if not st_bin:
        report = {
            "status": "FAIL",
            "reason": "schemathesis_not_installed",
            "hint": "pip install -r requirements-openapi.txt",
            "include_paths": list(include),
        }
        args.out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print("SCHEMATHESIS_POC=FAIL reason=schemathesis_not_installed", file=sys.stderr)
        return 1

    ndjson_path = args.out.parent / "schemathesis-poc.ndjson"
    cmd = [
        st_bin,
        "run",
        str(subset_path),
        "-u",
        args.base_url,
        "--phases",
        args.phases,
        "-n",
        str(args.max_examples),
        "--workers",
        "1",
        "--max-failures",
        "50",
        "--checks",
        "not_a_server_error,status_code_conformance,content_type_conformance,response_schema_conformance",
        "--report-ndjson-path",
        str(ndjson_path),
    ]
    if not require_auth:
        # Avoid Schemathesis synthesizing invalid Bearer tokens that the
        # middleware rejects even when REQUIRE_AUTH=false.
        cmd.extend(["--generation-with-security-parameters", "false"])
    proc = subprocess.run(cmd, capture_output=True, text=True)
    cli_text = (proc.stdout or "") + "\n" + (proc.stderr or "")
    (args.out.parent / "schemathesis-poc.cli.txt").write_text(cli_text, encoding="utf-8")

    raw_failures = parse_cli_failures(cli_text)
    classified = []
    for row in raw_failures:
        blob = json.dumps(row)
        classification = classify_failure(row, require_auth=require_auth)
        classified.append({**row, "classification": classification})

    product = [f for f in classified if f["classification"] == "PRODUCT_DEFECT"]
    fps = [f for f in classified if f["classification"] == "SCHEMATHESIS_FALSE_POSITIVE"]
    review = [f for f in classified if f["classification"] == "NEEDS_REVIEW"]

    tested = "Tested:" in cli_text
    if product:
        status = "FAIL"
    elif "Empty test suite" in cli_text or "No test cases were generated" in cli_text:
        status = "FAIL"
    elif fps and not review and not product:
        status = "PASS_WITH_FALSE_POSITIVES"
    elif review and not product:
        # Unclassified leftovers — treat as partial until triaged.
        status = "PASS_WITH_FALSE_POSITIVES" if fps else "FAIL"
    elif proc.returncode == 0:
        status = "PASS"
    elif fps and not product:
        status = "PASS_WITH_FALSE_POSITIVES"
    else:
        status = "FAIL"

    # Extract counts from summary when present
    m_gen = re.search(r"(\d+)\s+generated", cli_text)
    m_pass = re.search(r"✅\s*(\d+)\s+passed", cli_text)
    m_fail = re.search(r"❌\s*(\d+)\s+failed", cli_text)

    report = {
        "status": status,
        "exit_code": proc.returncode,
        "require_auth": require_auth,
        "base_url": args.base_url,
        "include_paths": list(subset["paths"].keys()),
        "subset_schema": str(subset_path),
        "generated": int(m_gen.group(1)) if m_gen else None,
        "passed": int(m_pass.group(1)) if m_pass else None,
        "failed": int(m_fail.group(1)) if m_fail else None,
        "failures": classified,
        "product_defects": product,
        "false_positives": fps,
        "needs_review": review,
        "command": cmd,
    }
    args.out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(
        f"SCHEMATHESIS_POC={status} "
        f"passed={report['passed']} failed={report['failed']} "
        f"product_defects={len(product)} false_positives={len(fps)} out={args.out}"
    )
    return 0 if status.startswith("PASS") else 1


if __name__ == "__main__":
    raise SystemExit(main())
