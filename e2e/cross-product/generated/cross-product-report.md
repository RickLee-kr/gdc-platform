# Cross-Product Report

Generated: 2026-07-17T10:03:28.224Z

## Counts
- Candidates (unique): 40428
- Candidate emissions (raw): 42228
- Duplicate emissions: 1800
- Valid: 32184
- NOT_APPLICABLE: 8244
- NOT_IMPLEMENTED combinations: 0
- Equation OK (C = V + NA + NI): true
- Browser: 11970
- API: 20214
- route-off: 4818
- route-on: 27366
- combination_id_set_hash: `c890661d8b1cfe48a524468324fdcd2c7e1d8a1957a749ba6421beebbbe072fc`

## NOT_IMPLEMENTED suite IDs (frozen 20)
- auth__auth-destination-webhook-headers__status-partial
- dest__destination-ai-provider-post__partial
- governance__audit__review__api__route-off
- governance__audit__review__api__route-on
- governance__governance-delivery-require-review__partial
- governance__hash__review__api__route-off
- governance__hash__review__api__route-on
- governance__mask__review__api__route-off
- governance__mask__review__api__route-on
- governance__remove__review__api__route-off
- governance__remove__review__api__route-on
- governance__tokenize__review__api__route-off
- governance__tokenize__review__api__route-on
- processing__processing-enrichment-lookup__partial
- route__routes-per-route-protection-classification-policy__partial
- route__routes-per-route-transform__partial
- runtime__runtime-fault-injection-fixtures__partial
- runtime__runtime-rate-limit__partial
- source__source-ai-proxy-receiver__runtime_only
- wizard__wizard-step-route-processing__partial

## By source
- HTTP_API_POLLING: 20238
- S3_OBJECT_POLLING: 2092
- DATABASE_QUERY: 2092
- REMOTE_FILE_POLLING: 2092
- WEBHOOK_RECEIVER: 5670

## By destination
- WEBHOOK_POST: 6456
- SYSLOG_UDP: 6396
- SYSLOG_TCP: 6396
- SYSLOG_TLS: 12936

## By fault
- NONE: 28890
- http_401: 270
- http_403: 270
- http_429: 270
- http_500: 270
- http_timeout: 270
- malformed_response: 270
- syslog_destination_down: 288
- api_restart: 360
- runtime_restart: 360
- partial_route_failure: 360
- tls_certificate_error: 144
- webhook_destination_down: 72
- s3_unavailable: 30
- db_disconnect: 30
- sftp_unavailable: 30

## NA by rule
- R019d_BROWSER_TRANSFORM_UI: 1650
- R019f_BROWSER_ROUTE_OVERRIDE_UI: 4398
- R019g_BROWSER_FAULT_UI: 2196

## Shards
- Shard count: 32
- Total estimated cost: 1998786
