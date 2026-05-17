"""Runtime gates for dev-validation lab activity (streams, continuous validation)."""

from __future__ import annotations

from app.dev_validation_lab.templates import LAB_NAME_PREFIX


def is_production_app_env(app_env: str | None = None) -> bool:
    """True when ``APP_ENV`` is production/prod (case-insensitive)."""

    from app.config import settings

    env = (app_env if app_env is not None else getattr(settings, "APP_ENV", "") or "").strip().lower()
    return env in {"production", "prod"}


def dev_validation_runtime_enabled() -> bool:
    """Whether lab streams and ``dev_lab_*`` validations may execute in this process.

    In production, lab runtime is off unless ``ENABLE_DEV_VALIDATION_LAB`` is explicitly true.
    In non-production, runtime is not suppressed at the APP_ENV layer (slice flags still apply).
    """

    from app.config import settings

    if is_production_app_env():
        return bool(getattr(settings, "ENABLE_DEV_VALIDATION_LAB", False))
    return True


def stream_name_is_dev_validation_lab(name: str | None) -> bool:
    return str(name or "").startswith(LAB_NAME_PREFIX)


__all__ = [
    "dev_validation_runtime_enabled",
    "is_production_app_env",
    "stream_name_is_dev_validation_lab",
]
