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
