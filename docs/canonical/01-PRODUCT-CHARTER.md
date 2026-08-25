# Data Relay Product Charter

**Document Version:** 2.0  
**Last Updated:** 2026-08-25  
**Status:** CANONICAL

## 1. Product identity

**Product:** Data Relay  
**Category:** Enterprise Data Control Gateway  
**Vision:** The Control Plane for Enterprise Data

Data Relay is a **Data Delivery Gateway with optional Data Protection and Data Control capabilities**.

Its primary job is to connect operational data sources to one or more destinations safely, visibly, and reliably.

## 2. Primary user outcomes

A user should be able to:

1. connect to a data source;
2. retrieve and understand events;
3. transform the output when necessary;
4. select one or more destinations;
5. apply destination-specific processing and controls;
6. deliver data reliably;
7. understand whether data is flowing;
8. diagnose failures and recover delivery;
9. protect sensitive data when required.

## 3. Core topology

```text
One Stream
   ↓
Many Routes
   ↓
Many Destinations
```

A **Stream** is the execution unit.

A **Route** is the destination-specific processing and delivery unit.

Users must not create duplicate Streams only because destinations require different processing.

## 4. Core route processing model

Destination-specific processing follows:

```text
Transform
   ↓
Protection
   ↓
Classification
   ↓
Policy
   ↓
Delivery
```

Shared Stream-scoped observation may occur before route processing. Route processing must not create a parallel runtime.

## 5. Product workflow

The primary creation workflow is:

```text
Connect
→ Sample & Record Selection
→ Destinations
→ Route Processing
→ Deploy
```

The day-2 workflow is operational:

```text
Observe
→ Identify Impact
→ Diagnose
→ Act
→ Verify Recovery
```

Creation is a lower-frequency activity than operations.

## 6. In scope

### Data collection

- HTTP API polling
- supported database query sources
- supported object/file polling sources
- supported push/receiver paths when implemented
- Connector / Source Pack based integration definitions

### Data processing

- Mapping
- Enrichment
- Transform rules
- Union Schema based onboarding
- destination-specific Route Processing

### Data control

- Schema observation and drift policy
- Sensitive Detection
- Protection
- Classification
- Policy

### Delivery and reliability

- Routes
- Multi-destination fan-out
- Destination adapters
- Retry and resilience
- Failover
- supported durable delivery modes
- Backpressure
- Replay / re-delivery
- Checkpoint integrity

### Governance and operations

- Violations
- Quarantine
- Audit
- Notifications
- Runtime evidence
- Operational monitoring
- Troubleshooting and recovery

### Integration ecosystem

- Source Packs
- Stream Extension Packs
- Connector Marketplace
- package validation and lifecycle
- offline installation
- optional remote/private registries
- AI-assisted integration authoring as a tooling capability

## 7. Explicit non-goals

Data Relay is not:

- SIEM
- XDR
- SOAR
- case management
- ticketing platform
- general workflow engine
- data warehouse
- data lake
- BI platform
- general ETL platform
- enterprise IAM / identity provider
- SSO federation platform
- AI agent hosting platform
- LLM hosting platform
- AI Gateway / AI Proxy product
- general-purpose application marketplace
- generic distributed stream-processing platform

AI-assisted Connector/Source Pack creation does not make Data Relay an AI platform.

## 8. Product principles

### Runtime is implementation truth

Documentation must not claim functionality is shipped unless code and tests support it.

### Data delivery first

Governance and protection are valuable optional controls. They must not make the basic delivery workflow unnecessarily complex.

### Operational confidence

The product should answer:

```text
What happened?
Where?
Why?
What is the data impact?
What should I do?
Did recovery succeed?
```

### Safe change

Changes that can affect running data flows should be previewable, testable, and reversible where technically possible.

### No silent data behavior changes

Package upgrades, policy changes, and compatibility updates must not silently change a running Stream or advance a checkpoint.

### No parallel engines

New capabilities reuse the established:

- runtime
- authentication
- resilience
- delivery
- route
- governance
- checkpoint

architecture.

## 9. Marketplace boundary

Marketplace is an integration distribution and lifecycle layer.

It does not execute a separate connector runtime.

Installed packages resolve into existing Data Relay entities and runtime contracts.

## 10. Product success criteria

The product is successful when operators can:

- connect required systems quickly;
- verify real data before deployment;
- deliver to multiple destinations without Stream duplication;
- see and diagnose delivery health;
- recover failed data delivery without guesswork;
- add integrations without changing runtime core;
- operate in both connected and air-gapped environments.
