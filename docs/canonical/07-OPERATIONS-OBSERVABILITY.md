# Data Relay Operations & Observability

**Document Version:** 2.0  
**Last Updated:** 2026-08-25  
**Status:** CANONICAL

## 1. Operational objective

Operators should be able to determine platform and data-flow health quickly, then drill down to evidence and corrective action.

Day-2 operations are a primary product workflow.

## 2. Operational hierarchy

```text
Fleet
→ Source Product / Stream Group
→ Stream
→ Route
→ Processing Stage / Destination
→ Evidence
→ Action
```

## 3. Dashboard scope

Dashboard is the fleet health entry point.

It should emphasize:

- Healthy / Warning / Critical
- incoming/outgoing events
- delivery success rate
- no data / low volume
- destination capacity
- confirmed schema drift
- source-product group health

It should not become a dense runtime log console.

## 4. Runtime evidence

**Status:** `PARTIAL` foundation `IMPLEMENTED`; operator Troubleshooter UX `TARGET`

Operational evidence should correlate:

- run
- stream
- route
- destination
- attempt/retry
- checkpoint decision

Useful events include:

- source fetch started/succeeded/failed
- route processing stage result
- delivery attempt/result
- retry/recovery
- queue state
- checkpoint advanced/held

## 5. Failure semantics

A product-visible failure should answer:

```text
What failed?
At which stage?
Why?
How much data is affected?
Is data retained?
Did checkpoint move?
Is recovery automatic?
What can the operator do?
```

## 6. Data Flow Troubleshooter

**Status: `TARGET`**

Troubleshooting should be generated from existing structured evidence rather than a new parallel logging engine.

Example:

```text
Stream: CrowdStrike Alerts
Health: Degraded

Problem
Destination returned HTTP 503

Impact
12,481 events pending

Safety
Checkpoint held
No confirmed data loss

Recovery
Circuit open
Next probe scheduled

Actions
Test Destination
View Evidence
Replay / Retry when applicable
```

## 7. Connector/API Health

**Status: `TARGET`**

Connector health should combine:

- connection success
- auth state
- credential expiration
- API error rate
- throttling
- vendor API compatibility/deprecation
- package verification age/version
- recent sample/API validation

This is not a replacement for Stream health.

## 8. Replay and recovery

**Status:** runtime recovery `PARTIAL`; unified Replay Center UX `TARGET`

Replay operations must preserve evidence of:

- selected replay scope
- source of retained data
- target route/destination
- replay run ID
- success/failure counts
- checkpoint behavior

Recovery evidence should prove both failure and recovery outcomes without requiring GUI observation.

## 9. Destination operations

Destination detail should expose:

- health
- capacity / configured rate limit
- connected routes/streams
- recent failures
- circuit state where applicable
- queue/backpressure state where applicable
- delivery latency/retry signals

## 10. Marketplace operational boundary

Operational Dashboard remains focused on **data-flow health**.

Marketplace Administration owns:

- package lifecycle
- signatures/trust
- registry
- package validation
- publisher/provenance

Stream/Connector detail may show package version/compatibility context when useful.

## 11. Administration/runbooks

Detailed runbooks remain separate supporting documentation for:

- install/upgrade
- offline installation
- TLS/reverse proxy
- backup/restore
- maintenance
- support bundle
- password recovery
- auth session operations
- migration integrity/recovery
- retention

These runbooks are operational references, not product architecture authority.

## 12. Air-gapped operation

| Capability | Status |
|---|---|
| Local product operation without remote Marketplace dependency | `IMPLEMENTED` |
| Offline package upload/install | `IMPLEMENTED` (local `.tar.gz`) |
| Local/private package source where configured | `PARTIAL` / private registry `TARGET` |
| Support/diagnostic export without leaking secrets | `IMPLEMENTED` (support bundle path) |

## 13. Observability non-goals

Do not turn Data Relay into:

- SIEM;
- general log analytics platform;
- incident case management platform.

Observability exists to operate Data Relay and prove data-delivery/control outcomes.
