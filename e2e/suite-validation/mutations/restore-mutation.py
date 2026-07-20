#!/usr/bin/env python3
"""Restore files after mutation. Cleans backup markers."""
from __future__ import annotations
import argparse, json, shutil, sys
from pathlib import Path

SUITE = Path(__file__).resolve().parents[1]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mutation-id", required=True)
    ap.add_argument("--work-root", default=str(SUITE))
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()
    root = Path(args.work_root)
    backup_dir = root / ".mutation-backup"
    restored = []
    if args.all:
        ids = [p.stem for p in backup_dir.glob("*.bak")] if backup_dir.exists() else []
    else:
        ids = [args.mutation_id]
    catalog = json.loads((SUITE / "mutations" / "mutation-catalog.json").read_text())
    by_id = {m["mutation_id"]: m for m in catalog["mutations"]}
    for mid in ids:
        bak = backup_dir / f"{mid}.bak"
        if not bak.exists():
            continue
        meta = by_id.get(mid) or {}
        patch_id = meta.get("patch_id") or mid
        patch_path = SUITE / "mutations" / "patches" / f"{patch_id}.json"
        if not patch_path.exists():
            continue
        patch = json.loads(patch_path.read_text())
        target = root / patch["file"]
        shutil.copy2(bak, target)
        bak.unlink()
        restored.append(str(target))
    if backup_dir.exists() and not any(backup_dir.iterdir()):
        backup_dir.rmdir()
    print(json.dumps({"ok": True, "restored": restored}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
