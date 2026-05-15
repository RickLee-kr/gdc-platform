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
