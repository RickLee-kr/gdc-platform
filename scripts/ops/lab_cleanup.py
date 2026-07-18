#!/usr/bin/env python3
"""Lab retention cleanup CLI wrapper (dry-run by default).

Usage:
  ./scripts/ops/lab_cleanup.py
  ./scripts/ops/lab_cleanup.py --execute
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.dev_validation_lab.lab_cleanup_cli import main

if __name__ == "__main__":
    raise SystemExit(main())
