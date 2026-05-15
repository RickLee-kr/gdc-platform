"""WireMock stub sync and optional post-seed validation triggers for the dev validation lab."""

from __future__ import annotations

import json
import logging
from pathlib import Path

import httpx

from app.config import settings
from app.database import SessionLocal
from app.dev_validation_lab.seeder import lab_effective, seed_dev_validation_lab
from app.dev_validation_lab.validation_gates import lab_validation_should_execute
from app.validation.models import ContinuousValidation
from app.validation.runner import execute_continuous_validation_row

logger = logging.getLogger(__name__)


def _wiremock_mappings_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "tests" / "wiremock" / "mappings"


def _seed_lab_scenario_states(client: httpx.Client, base: str) -> None:
    """Park lab-only scenarios at their idempotent steady state.

    The lab polls continuously, but ``webhook_retry_once`` was authored for a
    single end-to-end pytest run (Started → after_first_fail → after_success)
    and pytest explicitly calls ``__admin/scenarios/reset`` before each run.
    The lab has no such reset hook, so without this step the scenario would
    transition once and then sit at ``after_success`` with no matching stub on
    cold-boot, causing 404s and a persistent FAIL on ``dev_lab_full_delivery``.

    By moving the scenario directly to its ``after_success`` steady state
    (where the idempotent ``template-receiver-retry-once-3.json`` stub returns
    200), each lab cycle delivers cleanly. The retry path itself remains
    covered by the pytest E2E retry test, which resets scenarios on its own.
    """

    for scenario_name, target_state in (("webhook_retry_once", "after_success"),):
        try:
            r = client.put(
                f"{base}/__admin/scenarios/{scenario_name}/state",
                json={"state": target_state},
            )
            ok = r.status_code in (200, 201, 204)
        except Exception as exc:  # pragma: no cover - network fail-open
            ok = False
            logger.warning(
                "%s",
                {
                    "stage": "dev_validation_lab_wiremock_scenario_seed_failed",
                    "scenario": scenario_name,
                    "target_state": target_state,
                    "error_type": type(exc).__name__,
                    "message": str(exc),
                },
            )
            continue
        logger.info(
            "%s",
            {
                "stage": "dev_validation_lab_wiremock_scenario_seeded",
                "scenario": scenario_name,
                "target_state": target_state,
                "success": ok,
            },
        )


def sync_wiremock_template_mappings(*, base_url: str) -> bool:
    """POST template-*.json stubs to WireMock admin (same contract as pytest helpers). Fail-open."""

    root = _wiremock_mappings_dir()
    if not root.is_dir():
        logger.warning("%s", {"stage": "dev_validation_lab_wiremock_dir_missing", "path": str(root)})
        return False
    base = base_url.rstrip("/")
    ok = True
    try:
        with httpx.Client(timeout=20.0) as client:
            for path in sorted(root.glob("template-*.json")):
                doc = json.loads(path.read_text(encoding="utf-8"))
                mid = doc.get("id")
                if not mid:
                    continue
                client.delete(f"{base}/__admin/mappings/{mid}")
                r = client.post(f"{base}/__admin/mappings", json=doc)
                if r.status_code not in (200, 201):
                    ok = False
                    logger.warning(
                        "%s",
                        {
                            "stage": "dev_validation_lab_wiremock_mapping_failed",
                            "file": path.name,
                            "status_code": r.status_code,
                            "body": (r.text or "")[:300],
                        },
                    )
            _seed_lab_scenario_states(client, base)
    except Exception as exc:  # pragma: no cover - network fail-open
        logger.warning(
            "%s",
            {
                "stage": "dev_validation_lab_wiremock_sync_failed",
                "error_type": type(exc).__name__,
                "message": str(exc),
            },
        )
        return False
    logger.info("%s", {"stage": "dev_validation_lab_wiremock_sync_complete", "success": ok})
    return ok


def _trigger_initial_validations() -> None:
    if not settings.DEV_VALIDATION_AUTO_START:
        logger.info(
            "%s",
            {"stage": "dev_validation_lab_auto_validations_skipped", "DEV_VALIDATION_AUTO_START": False},
        )
        return
    db = SessionLocal()
    attempted = 0
    failed = 0
    try:
        rows = (
            db.query(ContinuousValidation)
            .filter(ContinuousValidation.template_key.isnot(None))
            .filter(ContinuousValidation.template_key.startswith("dev_lab_"))
            .filter(ContinuousValidation.enabled.is_(True))
            .order_by(ContinuousValidation.id.asc())
            .all()
        )
        for row in rows:
            if not lab_validation_should_execute(row):
                continue
            attempted += 1
            try:
                execute_continuous_validation_row(row)
            except Exception as exc:  # pragma: no cover
                failed += 1
                logger.warning(
                    "%s",
                    {
                        "stage": "dev_validation_lab_initial_validation_failed",
                        "validation_id": row.id,
                        "error_type": type(exc).__name__,
                        "message": str(exc),
                    },
                )
        logger.info(
            "%s",
            {
                "stage": "dev_validation_lab_auto_validations_summary",
                "candidates": len(rows),
                "attempted": attempted,
                "failed": failed,
                "succeeded": attempted - failed,
            },
        )
    finally:
        db.close()


def run_dev_validation_lab_startup() -> None:
    """Entry point from FastAPI lifespan: seed DB entities, best-effort WireMock sync, optional validation runs."""

    logger.info(
        "%s",
        {
            "stage": "dev_validation_lab_config_snapshot",
            "ENABLE_DEV_VALIDATION_LAB": bool(settings.ENABLE_DEV_VALIDATION_LAB),
            "DEV_VALIDATION_AUTO_START": bool(settings.DEV_VALIDATION_AUTO_START),
            "APP_ENV": str(settings.APP_ENV or ""),
        },
    )
    if not lab_effective():
        reason = "lab_disabled" if not settings.ENABLE_DEV_VALIDATION_LAB else "production_app_env"
        logger.info("%s", {"stage": "dev_validation_lab_seed_skipped", "reason": reason})
        return
    logger.info("%s", {"stage": "dev_validation_lab_startup_begin"})
    db = SessionLocal()
    summary: dict[str, object]
    try:
        summary = seed_dev_validation_lab(db)
    except Exception as exc:
        logger.warning(
            "%s",
            {
                "stage": "dev_validation_lab_seed_failed",
                "error_type": type(exc).__name__,
                "message": str(exc),
            },
        )
        return
    finally:
        db.close()

    if summary.get("skipped"):
        logger.info("%s", {"stage": "dev_validation_lab_seed_complete", **summary})
        return

    logger.info("%s", {"stage": "dev_validation_lab_seed_complete", **summary})
    sync_wiremock_template_mappings(base_url=settings.DEV_VALIDATION_WIREMOCK_BASE_URL)
    _trigger_initial_validations()
