# Core Architecture

## Entities
- Connector
- Source
- Stream (execution unit)
- Mapping
- Enrichment
- Route
- Destination
- Checkpoint

## Rules
- Connector ≠ Stream
- Source ≠ Destination
- Stream is execution unit
- Multi Destination required
- Route connects Stream → Destination
- Mapping and Enrichment separated
- Checkpoint only after successful delivery

## Runtime Reliability (architecture policy)

GDC is lightweight by default. Durability and buffering are **selectable per Stream** (`specs/048-runtime-reliability/spec.md`).

### Reliability modes

| Mode | Role |
|------|------|
| `DIRECT` | Default lightweight path: no persistent platform buffer |
| `MEMORY_BUFFER` | In-memory burst/backpressure; not durable across restart |
| `PERSISTENT_QUEUE` | Future DB/disk-backed delivery queue with retry/recovery |
| `EXTERNAL_BUFFER` | Durability delegated to external systems (Vector, Kafka, etc.) |

### Architecture principles

- Persistent buffering must never be globally mandatory.
- Polling sources (`HTTP_API_POLLING`, `DATABASE_QUERY`, …) may use `DIRECT` safely when upstream has persistence.
- Push sources (`WEBHOOK_RECEIVER`, future `SYSLOG_RECEIVER`) may recommend `MEMORY_BUFFER` or stronger modes; recommendation is not a global platform requirement.
- Destination failure must not automatically imply Source failure.
- Future optional **Delivery Worker** path decouples enqueue from route retry; not required for all Streams.

### Product scope boundary

GDC is not a generic distributed stream processing platform. It remains a lightweight operational collection, transform, enrich, and multi-destination delivery platform. Competitive patterns (Vector, Cribl, Fluent Bit, Benthos, NiFi) inform optional reliability features only.

---

# PLUGIN_ADAPTER_EXTENSION_ARCHITECTURE

## Core Rule

New connector capabilities must be added through plugin-style adapters, not by modifying runtime orchestration logic.

Runtime Core includes:

~~~text
StreamRunner
Scheduler
Checkpoint pipeline
Mapping pipeline
Enrichment pipeline
Routing pipeline
Delivery transaction flow
~~~

Runtime Core must remain source-agnostic, auth-agnostic, destination-agnostic, and vendor-agnostic.

## Source Adapter Model

~~~text
app/sources/adapters/
  base.py
  registry.py
  http_api.py
  s3.py
  database.py
  webhook_receiver.py
~~~

Expected dispatch:

~~~text
adapter = SourceAdapterRegistry.get(source_type)
events = adapter.fetch(stream, source, checkpoint)
~~~

## Auth Strategy Model

~~~text
app/connectors/auth/
  base.py
  registry.py
  basic.py
  bearer.py
  api_key.py
  vendor_jwt_exchange.py
  s3_access_key.py
  s3_iam_role.py
~~~

Expected dispatch:

~~~text
strategy = AuthStrategyRegistry.get(auth_type)
prepared_request = strategy.apply(request, connector_auth)
~~~

## Destination Adapter Model

~~~text
app/destinations/adapters/
  base.py
  registry.py
  syslog_udp.py
  syslog_tcp.py
  webhook_post.py
~~~

Expected dispatch:

~~~text
adapter = DestinationAdapterRegistry.get(destination_type)
result = adapter.send(destination, formatted_event)
~~~

## Extension Rule

Adding a new Source/Auth/Destination type must not require changes to:

~~~text
- StreamRunner business flow
- checkpoint update rules
- mapping/enrichment order
- route failure policy semantics
- existing HTTP API polling behavior
- existing Basic/Bearer/Vendor JWT auth behavior
~~~

Only the following changes are normally allowed:

~~~text
- new adapter/strategy file
- registry registration
- schema enum/type addition if required
- migration if persistence model requires it
- focused tests
- UI option addition if required
~~~

---

## DATA RELAY MARKETPLACE ADDENDUM v1.0 — Core Architecture Invariant

Status: Architecture Direction / Implementation Pending
Authority: Additive only. Existing Product Charter, Runtime Is Truth, Stream/Route, Credential, Governance, and Checkpoint invariants remain authoritative.
Reference: `docs/architecture/DATA-RELAY-CONNECTOR-MARKETPLACE-ARCHITECTURE-CHARTER-v1.0-DRAFT.md`


Marketplace packages are configuration/distribution artifacts, not runtime entities.
Connector ≠ Stream, Source ≠ Destination, Stream remains execution unit, Route remains destination-specific processing unit.
Built-in and installed packages MUST materialize/refer to the same core entities and MUST NOT introduce vendor-specific runtime forks.
