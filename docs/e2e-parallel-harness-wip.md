# E2E Parallel Resume Harness — WIP

**Branch:** `recovery/parallel-harness-wip-20260805`  
**Status:** WIP — not a product-development release blocker

## Implementation status

Normal-shard parallel coordinator and worker fan-out are implemented
(`parallel-resume-coordinator.py`, worker isolation, Playwright artifact
isolation, connector-create throttling).

## 4-worker live run failure

Live 4-worker runs failed due to **Lab capacity** limits (API/scheduler/
stream concurrency), not due to missing coordinator code.

## Current safe parallelism

- Normal shards: **1** worker (safe default for shared Lab)
- Fault shards: **sequential** (fault workers = 1)

CLI still exposes `--normal-workers` (historical default 4); do not use
4 on a shared Lab until capacity is expanded or an isolated Lab exists.

## Follow-up work

- Isolated Lab environment **or** Lab resource expansion
- Re-validate coordinator under sustained multi-worker load
- Then graduate defaults only after capacity proof

## Product policy

This WIP is **not** a release blocker for ordinary product development.
Track under Weekly/Release validation alongside Full Resume / Final Merge.
