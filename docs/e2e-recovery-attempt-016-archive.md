# Recovery Attempt-016 Archive

**Branch:** `recovery/attempt-016-final`  
**Campaign verdict:** `ATTEMPT_016_P0_FIXED — RECOVERY_CAMPAIGN_CLOSED`  
**DEV_VALIDATION_RUNNING:** `19_EXPECTED`

## Preserved tip

Full attempt-016 lineage including stream stop/delete ownership fixes and prior recovery commits.

## Intentionally excluded from Git

- `e2e/reports/**`, Playwright traces, `test-results`
- generation directories, JSONL dumps, PID/lock files
- runtime dumps, secrets, `.env*`

Large local evidence remains only on disk under attempt worktrees / report paths; do not commit it.

## Related branches

- Stable product fixes: `recovery/stable-fixes-20260805`
- Parallel harness WIP: `recovery/parallel-harness-wip-20260805`
