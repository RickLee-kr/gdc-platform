# Delivery Routing

## Destination Types
- SYSLOG_UDP
- SYSLOG_TCP
- SYSLOG_TLS (RFC5425-style TCP+TLS delivery; see `specs/024-syslog-tls-destination/spec.md`)
- WEBHOOK_POST

## Failure Policy
- LOG_AND_CONTINUE
- PAUSE_STREAM_ON_FAILURE
- DISABLE_ROUTE_ON_FAILURE
- RETRY_AND_BACKOFF

## Rules
- Fan-out required
- All routes success → checkpoint update
- Any failure → no checkpoint (except LOG_AND_CONTINUE)
