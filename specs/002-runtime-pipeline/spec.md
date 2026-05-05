# Runtime Pipeline

Source
→ Rate Limit
→ Event Extractor
→ Mapping
→ Enrichment
→ Formatter
→ Router (Fan-out)
→ Destination Rate Limit
→ Send
→ Checkpoint
→ Logs

---

# PostgreSQL Runtime Query Performance Rule

Delivery logs queries must be optimized for PostgreSQL index usage.

Runtime queries that read delivery logs, stream state, route state, destination state, or checkpoints must be validated with PostgreSQL EXPLAIN ANALYZE when performance-sensitive.
