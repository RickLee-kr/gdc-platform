# Data Relay User Experience

**Document Version:** 2.0  
**Last Updated:** 2026-08-25  
**Status:** CANONICAL

## 1. UX objective

Data Relay is an operational data-delivery product.

The UX should minimize engine terminology and maximize operator confidence.

Primary questions:

```text
Is data coming in?
Is data going out?
Is there a problem?
Where is the problem?
Why?
What is the impact?
What should I do?
Did the action fix it?
```

## 2. Primary navigation

Recommended primary navigation:

```text
Dashboard

Data Sources
├ Connectors
└ Streams

Delivery
└ Destinations

Administration
```

Do not create top-level navigation solely for internal engines such as:

- Mapping
- Enrichment
- Replay engine
- Policy engine
- Classification engine
- Schema Drift engine
- Runtime internals

Marketplace discovery belongs primarily under `Data Sources → Connectors`.

## 3. Stream grouping

Stream Group is a UX grouping by source product.

It is not:

- a new database entity;
- a top-level navigation item;
- an execution unit.

Example:

```text
Microsoft 365
├ Audit
├ Sign-in
└ Mail

Okta
├ System Log
└ Users
```

## 4. Stream Wizard

Canonical workflow (**Status: `IMPLEMENTED`**):

```text
1. Connect
2. Sample & Record Selection
3. Destinations
4. Route Processing
5. Deploy
```

Older four-step or six-step wizard descriptions in historical governance/UX documents are superseded.

### Connect

User question: **Can I connect?**

Includes:

- connector
- credential/auth
- request settings
- Test Connection

Marketplace is a supporting flow, not a new wizard step.

If the integration is missing:

```text
Browse Marketplace        (TARGET)
Upload Package            (PARTIAL / API IMPLEMENTED; full UI TARGET)
Install from Git          (TARGET)
Create with AI            (PARTIAL — Builder Core IMPLEMENTED; UI TARGET / M29.8)
```

Create with AI (service path):

```text
Vendor Docs / OpenAPI / Sample / Script
→ Builder
→ Draft
→ Validate
→ Review
→ Install
```

AI drafts are untrusted. Install is always explicit. Marketplace UI remains M29.8.

Then return to Connect.

### Sample & Record Selection

User question: **Can I retrieve and identify the events?**

Workflow:

```text
Run Test
→ View Response
→ Select Record Path
→ Select Event Root
→ Build/Review Union Schema
→ Configure Checkpoint
→ Continue
```

The system may suggest. The user confirms.

### Destinations

User question: **Where should the data go?**

Selecting destinations establishes Route context.

### Route Processing

User question: **Does a destination require different processing?**

Order:

```text
Transform
→ Protection
→ Classification
→ Policy
→ Delivery
```

UX may present Mapping + Enrichment as Transform while internal persistence remains separate.

### Deploy

Deploy is a readiness decision, not a configuration dump.

Status:

- Ready
- Ready with Warnings
- Needs Attention

## 5. Dashboard

Dashboard answers **What happened?**

Primary information:

- overall health
- incoming/outgoing traffic
- delivery success
- problem Stream Groups
- no-data / low-volume issues
- destination capacity warnings
- confirmed schema-drift issues

Root-cause detail belongs after drill-down.

## 6. Drill-down model

```text
Dashboard
→ Stream Group
→ Stream
→ Route / Stage
→ Evidence
→ Action
```

## 7. P0 target: Data Flow Troubleshooter

**Status: `TARGET`**

A Stream/Route troubleshooting surface should answer:

```text
Current issue: HTTP 429
Stage: Source Fetch
Impact: 1,382 records delayed
Checkpoint: Safe / unchanged
Recovery: retry scheduled
```

Diagnosis stages:

- source connection/fetch
- extraction
- transform
- protection
- classification
- policy
- destination
- checkpoint

The user should not need to correlate raw logs manually for common failures.

## 8. P0 target: Safe Change Management

**Status: `TARGET`**

High-impact changes should support:

```text
Test
→ Preview Impact
→ Canary
→ Apply
→ Verify
→ Rollback when supported
```

Applies especially to:

- package upgrades
- mapping/schema changes
- auth/API version changes
- route-processing configuration

## 9. Marketplace UX

**Status: `TARGET`**

Recommended:

```text
Data Sources
→ Connectors
   ├ Installed
   └ Marketplace
```

Marketplace detail should show:

- package version
- vendor API version
- trust
- verification evidence
- compatibility
- streams
- changelog/deprecation
- install/update state

## 10. P0 target: Test Before Apply

**Status: `TARGET`**

After package install:

```text
Select Credential
→ Test Connection
→ Fetch Sample
→ Validate
→ Preview
→ Explicitly Create/Update Stream
```

Install alone never starts polling.

## 11. P0 target: Update Impact Preview

**Status: `TARGET`**

Before package/config changes affect runtime, show:

- changed endpoints/auth
- changed fields/schema
- affected streams/routes
- deprecated streams
- compatibility blockers
- recommended test/canary

## 12. Connector health target

**Status: `TARGET` / foundation `PARTIAL`**

Existing runtime health/monitoring provides a foundation.

The user-facing Connector/API health experience should add:

- credential expiration
- auth failures
- API deprecation
- schema incompatibility
- repeated rate limiting
- package update availability
- last successful verification

## 13. Replay experience target

**Status: `TARGET` expansion (runtime recovery foundation `PARTIAL`)**

Existing Replay/runtime recovery capabilities should converge into a clear operator workflow:

```text
Failed records only
Time range
Checkpoint/source range where supported
Destination
Preview
Replay
Verify completion
```

The UI must distinguish replay from checkpoint mutation.

## 14. Environment promotion target

**Status: `TARGET`**

Enterprise users should be able to promote non-secret configuration:

```text
Development
→ Staging
→ Production
```

Promotion bundles must exclude credentials/secrets by default.

Existing backup/export/import capabilities may be reused, but environment promotion is a separate operator workflow and should not be claimed implemented until specifically verified.
