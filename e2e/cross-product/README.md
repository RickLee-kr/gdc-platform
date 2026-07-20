# Full Cross-Product E2E

Cartesian-product suite for Data Relay. **Does not replace** the existing 332-scenario matrix.

## Commands

```bash
# From repo root
./e2e/run-full-e2e-lab.sh generate-cross-product
./e2e/run-full-e2e-lab.sh validate-cross-product
./e2e/run-full-e2e-lab.sh run-cross-product
GDC_XP_SHARD=xp-normal-000 ./e2e/run-full-e2e-lab.sh run-cross-product-shard
./e2e/run-full-e2e-lab.sh merge-cross-product-results
./e2e/run-full-e2e-lab.sh validate-cross-product-results
./e2e/run-full-e2e-lab.sh cleanup-cross-product
./e2e/run-full-e2e-lab.sh report-cross-product
```

Or via npm in `e2e/`:

- `npm run generate-cross-product`
- `npm run validate-cross-product`
- `npm run plan-cross-product-shards`
- `npm run run-cross-product` / `run-cross-product-shard`
- `npm run merge-cross-product-results`
- `npm run validate-cross-product-results`
- `npm run report-cross-product`
- `npm run cleanup-cross-product` (reuses existing cleanup-cli)

## Artifacts

| File | Purpose |
|------|---------|
| `cross-product-axes.yaml` | Axis registry (Runtime-backed values only) |
| `applicability-rules.ts` | Declarative Rule IDs R001–R029 |
| `generated/valid-combinations.jsonl` | Streaming valid tuples |
| `generated/not-applicable.jsonl` | Rejected tuples with rule_id + evidence |
| `generated/generation-summary.json` | Counts + hashes |
| `baseline/cross-product-baseline.json` | Static reviewed baseline (never auto-overwritten) |
| `generated/shard-plan.json` | Weighted bin-packing shards |

## Cleanup

All scenarios use `finalizeTestContext` → existing `resource-registry` / `resource-cleanup`. Cleanup is **not** reimplemented here.

## Gates

1. Existing Capability Coverage Gate (332) — unchanged
2. Cross-Axis Coverage Gate — every `combination_id` must execute; capability-once is insufficient
