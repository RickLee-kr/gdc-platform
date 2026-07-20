# Mutation Audit M01–M24

| ID | Legacy | Subject | Product | Harness | Class | Replace |
|----|--------|---------|---------|---------|-------|---------|
| M01 | `authenticateSource.bearer` | Y | `BearerAuthStrategy.apply` | `-` | SUBJECT_ONLY | REAL_PRODUCT_PATH |
| M02 | `authenticateSource.api_key_header` | Y | `ApiKeyAuthStrategy.apply` | `-` | SUBJECT_ONLY | REAL_PRODUCT_PATH |
| M03 | `sourceFetchOutcome` | Y | `HttpPoller.fetch.status>=400` | `-` | SUBJECT_ONLY | REAL_PRODUCT_PATH |
| M04 | `normalizeTimestamp` | Y | `_normalize_value` | `-` | SUBJECT_ONLY | REAL_PRODUCT_PATH |
| M05 | `normalizeTimestamp.invalid` | Y | `_normalize_value` | `-` | SUBJECT_ONLY | REAL_PRODUCT_PATH |
| M06 | `applyTransforms.jsonata` | Y | `apply_full_event_jsonata_mapping` | `-` | SUBJECT_ONLY | REAL_PRODUCT_PATH |
| M07 | `applyTransforms.jsonata.drop` | Y | `apply_full_event_jsonata_mapping` | `-` | SUBJECT_ONLY | REAL_PRODUCT_PATH |
| M08 | `applyTransforms.regex` | Y | `apply_full_event_regex_mapping` | `-` | SUBJECT_ONLY | REAL_PRODUCT_PATH |
| M09 | `applyGovernance.unknown_drop` | Y | `get_unmapped_fields_policy` | `-` | SUBJECT_ONLY | REAL_PRODUCT_PATH |
| M10 | `applyGovernance.unknown_block` | Y | `load_schema_drift_policy` | `-` | SUBJECT_ONLY | REAL_PRODUCT_PATH |
| M11 | `applyGovernance.schema_drift` | Y | `_normalize_normal` | `-` | SUBJECT_ONLY | REAL_PRODUCT_PATH |
| M12 | `applyGovernance.detection` | Y | `detect_sensitive_fields` | `-` | SUBJECT_ONLY | REAL_PRODUCT_PATH |
| M13 | `applyGovernance.mask` | Y | `partial_mask_value` | `-` | SUBJECT_ONLY | REAL_PRODUCT_PATH |
| M14 | `applyGovernance.hash` | Y | `hash_mask_value` | `-` | SUBJECT_ONLY | REAL_PRODUCT_PATH |
| M15 | `applyGovernance.tokenize` | Y | `tokenize_value` | `-` | SUBJECT_ONLY | REAL_PRODUCT_PATH |
| M16 | `mergeRouteConfig.transform` | Y | `resolve_route_transform_config` | `-` | SUBJECT_ONLY | REAL_PRODUCT_PATH |
| M17 | `mergeRouteConfig.destination` | Y | `resolve_route_transform_config` | `-` | SUBJECT_ONLY | REAL_PRODUCT_PATH |
| M18 | `runPipeline.block_adapter` | Y | `delivery_allowed_for_decision` | `-` | SUBJECT_ONLY | REAL_PRODUCT_PATH |
| M19 | `assertDeliveryCollectorContract` | Y | `-` | `executeCrossProductScenario.collector_zero_guard` | SUBJECT_ONLY | REAL_HARNESS_PATH |
| M20 | `listCollector` | Y | `-` | `getWebhookByCorrelation` | SUBJECT_ONLY | REAL_HARNESS_PATH |
| M21 | `applyDedup` | Y | `-` | `executeScenario.dedup_assert` | SUBJECT_ONLY | REAL_HARNESS_PATH |
| M22 | `advanceCheckpoint` | Y | `StreamRunner._update_checkpoint_after_success` | `-` | SUBJECT_ONLY | REAL_PRODUCT_PATH |
| M23 | `recordRetry` | Y | `StreamRunner._apply_failure_policy` | `-` | SUBJECT_ONLY | REAL_PRODUCT_PATH |
| M24 | `recordDelivery.status` | Y | `StreamRunner._log` | `-` | SUBJECT_ONLY | REAL_PRODUCT_PATH |

- Subject-only Critical: **24/24**
- Legacy 34/34 KILLED는 `legacy_subject_validation`만 기록
