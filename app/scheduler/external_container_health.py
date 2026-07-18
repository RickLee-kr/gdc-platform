"""Probe health of a dedicated scheduler container (external to the API process).

Used when ``GDC_ENABLE_IN_PROCESS_SCHEDULER=false``. Relies on Docker Engine
inspect via the mounted docker socket (same pattern as platform admin compose
operations). Does not start or stop the scheduler.
"""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
from dataclasses import dataclass
from typing import Any, Literal

from app.config import settings

logger = logging.getLogger(__name__)

ExternalProbeOutcome = Literal["healthy", "unhealthy", "starting", "none", "unknown"]


@dataclass(frozen=True)
class ExternalSchedulerHealth:
    """Result of probing the dedicated scheduler container."""

    container_name: str
    probe_ok: bool
    running: bool | None
    health_status: ExternalProbeOutcome
    detail: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "container_name": self.container_name,
            "probe_ok": self.probe_ok,
            "running": self.running,
            "health_status": self.health_status,
            "detail": self.detail,
        }


def resolve_scheduler_container_name() -> str:
    name = (getattr(settings, "GDC_SCHEDULER_CONTAINER_NAME", None) or "").strip()
    return name or "gdc-platform-scheduler"


def probe_external_scheduler_container(
    *,
    container_name: str | None = None,
    timeout_seconds: float = 5.0,
) -> ExternalSchedulerHealth:
    """Inspect Docker health of the external scheduler container.

    Returns ``health_status="unknown"`` when Docker is unavailable or inspect fails
    so callers must not treat the scheduler as healthy by default.
    """

    name = (container_name or resolve_scheduler_container_name()).strip() or "gdc-platform-scheduler"
    docker_bin = shutil.which("docker")
    if not docker_bin:
        return ExternalSchedulerHealth(
            container_name=name,
            probe_ok=False,
            running=None,
            health_status="unknown",
            detail="docker CLI not available in this process",
        )

    try:
        completed = subprocess.run(
            [
                docker_bin,
                "inspect",
                "--format",
                "{{json .State}}",
                name,
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired:
        return ExternalSchedulerHealth(
            container_name=name,
            probe_ok=False,
            running=None,
            health_status="unknown",
            detail=f"docker inspect timed out after {timeout_seconds}s",
        )
    except OSError as exc:
        return ExternalSchedulerHealth(
            container_name=name,
            probe_ok=False,
            running=None,
            health_status="unknown",
            detail=f"docker inspect failed: {exc}",
        )

    if completed.returncode != 0:
        err = (completed.stderr or completed.stdout or "").strip()[:240]
        return ExternalSchedulerHealth(
            container_name=name,
            probe_ok=False,
            running=None,
            health_status="unknown",
            detail=err or f"docker inspect exit {completed.returncode}",
        )

    try:
        state = json.loads((completed.stdout or "").strip() or "{}")
    except json.JSONDecodeError:
        return ExternalSchedulerHealth(
            container_name=name,
            probe_ok=False,
            running=None,
            health_status="unknown",
            detail="docker inspect returned non-JSON state",
        )

    if not isinstance(state, dict):
        return ExternalSchedulerHealth(
            container_name=name,
            probe_ok=False,
            running=None,
            health_status="unknown",
            detail="docker inspect state is not an object",
        )

    running = bool(state.get("Running"))
    health_blob = state.get("Health")
    raw_health: str | None = None
    if isinstance(health_blob, dict):
        status_val = health_blob.get("Status")
        if isinstance(status_val, str) and status_val.strip():
            raw_health = status_val.strip().lower()

    if not running:
        return ExternalSchedulerHealth(
            container_name=name,
            probe_ok=True,
            running=False,
            health_status="unhealthy",
            detail="scheduler container is not running",
        )

    if raw_health in ("healthy", "unhealthy", "starting"):
        return ExternalSchedulerHealth(
            container_name=name,
            probe_ok=True,
            running=True,
            health_status=raw_health,  # type: ignore[arg-type]
            detail=None,
        )

    if raw_health is None:
        return ExternalSchedulerHealth(
            container_name=name,
            probe_ok=True,
            running=True,
            health_status="none",
            detail="scheduler container is running but has no Docker healthcheck status",
        )

    return ExternalSchedulerHealth(
        container_name=name,
        probe_ok=True,
        running=True,
        health_status="unknown",
        detail=f"unrecognized Docker health status: {raw_health}",
    )


__all__ = [
    "ExternalSchedulerHealth",
    "probe_external_scheduler_container",
    "resolve_scheduler_container_name",
]
