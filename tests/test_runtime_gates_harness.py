"""Harness stream ownership gates for Full E2E schedulers."""

from __future__ import annotations

from app.dev_validation_lab.runtime_gates import (
    is_run_once_harness_stream,
    stream_name_is_full_e2e_harness,
)


def test_canonical_full_e2e_prefix_is_harness() -> None:
    assert stream_name_is_full_e2e_harness("[FULL E2E] matrix stream")
    assert is_run_once_harness_stream("[FULL E2E] matrix stream")


def test_isolated_oss_prefix_is_not_blanket_skipped(monkeypatch) -> None:
    """Scheduler scenarios under [OSS V1 E2E] must remain pollable."""

    monkeypatch.setenv("GDC_E2E_NAME_PREFIX", "[OSS V1 E2E]")
    assert not stream_name_is_full_e2e_harness("[OSS V1 E2E] gov stream x")
    assert not is_run_once_harness_stream("[OSS V1 E2E] scheduler stream")


def test_unrelated_prefixes_are_not_harness(monkeypatch) -> None:
    monkeypatch.delenv("GDC_E2E_NAME_PREFIX", raising=False)
    assert not stream_name_is_full_e2e_harness("[DEV E2E] visible")
    assert not stream_name_is_full_e2e_harness("[OSS V1 E2E] isolated")
