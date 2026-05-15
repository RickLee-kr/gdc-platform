Purpose
-------
Backups of ``app/main.py`` and ``app/runtime/router.py`` before splitting the
DB startup stabilization PR from unrelated API/UI routes.

The stabilization-only scope must include only:
  - DATABASE_URL / Alembic alignment (alembic/env.py)
  - startup readiness + scheduler gating (app/startup_readiness.py, app/main.py lifespan)
  - DB pool settings (app/database.py)
  - GET /api/v1/runtime/status diagnostics (app/runtime/router.py -- /status only)
  - focused tests (tests/test_startup_readiness.py, tests/test_alembic_migration.py, conftest note)

Follow-up PR (restore UI/runtime extras)
----------------------------------------
Compare backup files to the post-stabilization ``app/main.py`` and
``app/runtime/router.py`` to re-apply in a **second commit / PR**:

  - SPA static serving, ``/``, ``/{full_path:path}``, ``/assets``, ``/favicon.svg``
  - ``test_target`` router include in ``app/main.py``
  - Runtime routes removed from stabilization scope:
      GET  /runtime/streams/{id}/metrics
      POST /runtime/streams/{id}/run-once
      POST /runtime/api-test/connector-auth
      POST /runtime/preview/format
      POST /runtime/format-preview

Suggested workflow::

  diff -u app/main.py scripts/pending-merge-after-db-pr/app_main.py.bak
  diff -u app/runtime/router.py scripts/pending-merge-after-db-pr/runtime_router.py.bak

Or restore from backup and merge carefully with any newer stabilization edits.
