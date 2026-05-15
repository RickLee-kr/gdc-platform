"""Lightweight checks for development-only continuous testing scripts (no WireMock required)."""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path
from textwrap import dedent
from xml.sax.saxutils import escape

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_TESTING = ROOT / "scripts" / "testing"
PY_HELPERS = SCRIPTS_TESTING / "py"


def _load_helper(mod_name: str, filename: str):
    path = PY_HELPERS / filename
    spec = importlib.util.spec_from_file_location(mod_name, path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def junit_summary():
    return _load_helper("junit_summary", "junit_summary.py")


@pytest.fixture(scope="module")
def regression_transition():
    return _load_helper("regression_transition", "regression_transition.py")


@pytest.fixture(scope="module")
def e2e_watch_stats():
    return _load_helper("e2e_watch_stats", "e2e_watch_stats.py")


def _write_sample_junit(path: Path, *, failures: int, case_name: str = "test_case") -> None:
    fail_xml = ""
    if failures:
        name = case_name
        fail_xml = dedent(
            f"""
            <failure message="boom">assert 0</failure>
            """
        ).strip()
    else:
        name = case_name
    body = dedent(
        f"""
        <testsuites>
          <testsuite name="suite" tests="1" failures="{failures}" errors="0" skipped="0" time="1.2">
            <testcase classname="tests.demo" name="{escape(name)}" time="1.2">
              {fail_xml}
            </testcase>
          </testsuite>
        </testsuites>
        """
    ).strip()
    path.write_text(f'<?xml version="1.0" encoding="utf-8"?>\n{body}\n', encoding="utf-8")


def test_junit_summary_counts_pass_and_fail(tmp_path: Path, junit_summary) -> None:
    ok = tmp_path / "ok.xml"
    bad = tmp_path / "bad.xml"
    _write_sample_junit(ok, failures=0)
    _write_sample_junit(bad, failures=1)
    d_ok = junit_summary.parse_junit_xml(ok)
    d_bad = junit_summary.parse_junit_xml(bad)
    assert d_ok["passed"] == 1 and d_ok["failed"] == 0
    assert d_bad["failed"] == 1 and d_bad["failed_tests"]


def test_regression_transition_messages(regression_transition) -> None:
    assert regression_transition.describe_transition("PASS", "FAIL") == "REGRESSION: PASS → FAIL"
    assert regression_transition.describe_transition("FAIL", "PASS") == "RECOVERY: FAIL → PASS"
    assert regression_transition.describe_transition("PASS", "PASS") is None


def test_e2e_watch_stats_cli(tmp_path: Path, e2e_watch_stats) -> None:
    ok = tmp_path / "ok.xml"
    _write_sample_junit(ok, failures=0)
    buf = subprocess.run(
        [sys.executable, str(PY_HELPERS / "e2e_watch_stats.py"), str(ok), "0", "PASS"],
        check=False,
        capture_output=True,
        text=True,
    )
    assert buf.returncode == 0
    lines = buf.stdout.strip().splitlines()
    assert lines[0] == "PASS"


def test_bootstrap_scripts_exist_and_bash_syntax() -> None:
    names = [
        "start-test-stack.sh",
        "stop-test-stack.sh",
        "reset-test-stack.sh",
        "watch-e2e.sh",
        "run-focused-tests.sh",
        "run-smoke-tests.sh",
        "run-full-regression.sh",
        "_env.sh",
    ]
    for name in names:
        p = SCRIPTS_TESTING / name
        assert p.is_file(), f"missing {p}"
        r = subprocess.run(["bash", "-n", str(p)], check=False, capture_output=True, text=True)
        assert r.returncode == 0, r.stderr


def test_test_history_dirs_created_by_watch_helpers(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Watch mode expects these relative paths; ensure mkdir -p targets are sane."""
    hist = tmp_path / ".test-history" / "smoke"
    hist.mkdir(parents=True)
    (hist / "probe.log").write_text("ok\n", encoding="utf-8")
    assert (hist / "probe.log").read_text().startswith("ok")


def test_flaky_tracker_update(tmp_path: Path) -> None:
    flaky = _load_helper("flaky_tracker", "flaky_tracker.py")
    j1 = tmp_path / "a.xml"
    j2 = tmp_path / "b.xml"
    _write_sample_junit(j1, failures=0, case_name="test_same")
    _write_sample_junit(j2, failures=1, case_name="test_same")
    state = tmp_path / "state.json"
    summary = tmp_path / "flaky.txt"
    flaky.update_state(j1, state, summary)
    flaky.update_state(j2, state, summary)
    data = state.read_text(encoding="utf-8")
    assert "pass_to_fail_hits" in data
    assert "tests.demo::test_same" in data
