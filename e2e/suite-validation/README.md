# E2E Suite Trust Validation

Golden + Independent Oracle + Negative Control + **Real-path Mutation** + Generator Gate + Capability ID Direct Mapping.

## Safety

- Does **not** start Full Cross-Product Resume
- Does **not** modify recovery worktree `xp_full_on_20260717_101601-fixed`
- Writes reports under `e2e/reports/e2e_suite_validation_<timestamp>/`
- Ownership: `e2e-suite-validation`
- Critical trust score uses **Product/Harness real paths only** (`subject/*` is legacy-only)

## Run

```bash
bash e2e/suite-validation/run-suite-validation.sh --full --reports-root /home/aella/gdc-platform/e2e/reports
bash e2e/suite-validation/run-suite-validation.sh --real-path-only --reports-root /home/aella/gdc-platform/e2e/reports
bash e2e/suite-validation/run-suite-validation.sh --golden-only
bash e2e/suite-validation/run-suite-validation.sh --negative-only
python3 e2e/suite-validation/real-path/run-real-path-mutations.py --report-dir /tmp/rp
```

## Gates

1. Mutation Audit (legacy subject classification)
2. Oracle Independence
3. Capability ID Direct Mapping (no substring matching)
4. Golden Scenario
5. Negative Control
6. Legacy subject validation (recorded separately)
7. **Real-path Product + Harness Mutation (required for TRUSTED)**
8. Recovery Artifact Integrity

## Trust verdict

`E2E_SUITE_TRUSTED — READY_FOR_FULL_RESUME` only when:

- Product Real-path Mutation Score 100%
- Harness Real-path Mutation Score 100%
- subject-only Critical Mutation 0
- Target not executed 0 / Survived 0 / Mass 0 / Restore 0
- Capability Mapping Missing 0
- Trace Evidence Missing 0
- Recovery Artifact changes 0
