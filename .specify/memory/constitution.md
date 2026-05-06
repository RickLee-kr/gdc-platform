# Generic Data Connector Platform Constitution

## Source of Truth

This project already uses Spec Kit style specs under:

- specs/001-core-architecture/spec.md
- specs/002-runtime-pipeline/spec.md
- specs/003-db-model/spec.md
- specs/004-delivery-routing/spec.md

These specs and this constitution are the implementation authority.

## Non-Negotiable Architecture Rules

1. Connector and Stream must remain separate.
2. Source and Destination must remain separate.
3. Stream is the runtime execution unit.
4. Stream and Destination are connected only through Route.
5. Multi Destination fan-out must be preserved.
6. Mapping and Enrichment must remain separate stages.
7. Checkpoint must be updated only after successful Destination delivery.
8. Source rate limit and Destination rate limit must both exist.
9. Delivery failure logs must be structured and persisted.
10. MVP focuses on HTTP API polling but must not block future DB Query or Webhook Receiver expansion.

## Required Runtime Pipeline

Source Fetch
→ Event Extraction
→ Mapping
→ Enrichment / Static Field Injection
→ Formatting
→ Route Fan-out
→ Destination Delivery
→ Checkpoint Update
→ Structured Logs / Runtime State

## Forbidden

- Do not collapse Connector, Source, Stream, Destination, and Route into one object.
- Do not make Connector the runtime unit.
- Do not update checkpoint after fetch/parse/mapping only.
- Do not bypass Route for Destination delivery.
- Do not merge Mapping and Enrichment into one unclear function.
- Do not change unrelated files.
- Do not introduce distributed queue/large pipeline architecture for MVP.

## Database Policy

DB is PostgreSQL only in production and development.
SQLite is not supported.
SQLite must not be used as a fallback, local development database, test shortcut, or compatibility layer.
All database migrations, indexes, queries, and performance validations must target PostgreSQL.

## Runtime Transaction Ownership

StreamRunner is the only transaction owner for runtime DB writes.

Runtime services and repositories must stage DB changes only.
They must not independently commit runtime DB writes.

Failure logs must be persisted for route-level delivery failures.
Exception-level `run_failed` logs are emitted to the application logger only and are not persisted because the active transaction is rolled back.

No commit is allowed after StreamRunner rollback.

---

# Mapping UI Rules (Phase 2 - Drag & Drop)

Drag & Drop은 Phase 2에서 구현한다.

필수 규칙:

- MVP 단계에서 Drag & Drop 구현 금지
- Drag & Drop 방향은 JSON Tree → Mapping Table만 허용
- 드롭 시 JSONPath 자동 생성 필수
- 드롭 시 신규 Mapping row 생성 또는 기존 row 업데이트를 지원한다
- 중복 mapping 발생 시 사용자에게 경고해야 한다
- 클릭 기반 JSONPath 생성 기능은 계속 유지해야 한다
- Mapping 엔진과 저장 구조는 기존 JSONPath 기반 구조를 유지해야 한다

금지사항:

- Drag & Drop 때문에 Mapping 데이터 구조 변경 금지
- 클릭 기반 Mapping 기능 제거 금지
- Mapping 엔진 로직 변경 금지

---

# Mapping UI Rules (Phase 2 - Drag & Drop)

- MVP 단계에서 Drag & Drop 구현 금지
- Drag & Drop 방향은 JSON Tree → Mapping Table만 허용
- 드롭 시 JSONPath 자동 생성 필수
- 중복 mapping 발생 시 사용자에게 경고해야 한다
- 클릭 기반 JSONPath 생성 기능은 계속 유지해야 한다
- Mapping 엔진과 저장 구조는 기존 JSONPath 기반 구조를 유지해야 한다

금지사항:

- Drag & Drop 때문에 Mapping 데이터 구조 변경 금지
- 클릭 기반 Mapping 기능 제거 금지
- Mapping 엔진 로직 변경 금지

# Mapping UI Rules (MVP)

Mapping UI는 비개발자도 사용할 수 있는 Preview-first UX를 따라야 한다.

필수 규칙:

- Raw Payload는 JSON Tree 형태로 렌더링해야 한다
- JSON 노드 클릭 시 JSONPath를 자동 생성해야 한다
- 생성된 JSONPath는 Mapping Table에 연결되어야 한다
- Mapping Table은 output_field, source_json_path, sample_value를 표시해야 한다
- Raw Event Preview, Mapped Event Preview, Enriched Final Event Preview를 모두 제공해야 한다
- Final Preview는 실제 Destination 전송 payload와 동일해야 한다
- Mapping과 Enrichment는 UI와 내부 로직 모두에서 분리해야 한다

금지사항:

- JSONPath 수동 입력 UI만 제공하는 것 금지
- Preview 없는 Mapping UI 금지
- Mapping 단계에서 Enrichment 필드를 섞어서 저장하는 것 금지
- Destination 전송 payload와 다른 Final Preview 표시 금지
