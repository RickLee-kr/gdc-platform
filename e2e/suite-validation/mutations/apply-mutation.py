#!/usr/bin/env python3
"""Apply a suite-validation mutation patch. Never touches recovery worktree."""
from __future__ import annotations
import argparse, json, shutil, sys
from pathlib import Path

SUITE = Path(__file__).resolve().parents[1]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mutation-id", required=True)
    ap.add_argument("--work-root", default=str(SUITE), help="suite-validation root to mutate")
    args = ap.parse_args()
    root = Path(args.work_root)
    patch_path = SUITE / "mutations" / "patches" / f"{args.mutation_id}.json"
    if not patch_path.exists():
        print(json.dumps({"ok": False, "error": "patch_not_found", "mutation_id": args.mutation_id}))
        return 2
    patch = json.loads(patch_path.read_text())
    target = root / patch["file"]
    if not target.exists():
        print(json.dumps({"ok": False, "error": "target_missing", "file": str(target)}))
        return 2
    backup = root / ".mutation-backup" / f"{args.mutation_id}.bak"
    backup.parent.mkdir(parents=True, exist_ok=True)
    if not backup.exists():
        shutil.copy2(target, backup)
    text = target.read_text()
    if patch["find"] not in text:
        print(json.dumps({"ok": False, "error": "INVALID_MUTATION", "reason": "find_not_found", "file": patch["file"]}))
        return 3
    if text.count(patch["find"]) != 1:
        print(json.dumps({"ok": False, "error": "INVALID_MUTATION", "reason": "ambiguous_find", "file": patch["file"]}))
        return 3
    target.write_text(text.replace(patch["find"], patch["replace"], 1))
    print(json.dumps({"ok": True, "mutation_id": args.mutation_id, "file": patch["file"], "backup": str(backup)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
