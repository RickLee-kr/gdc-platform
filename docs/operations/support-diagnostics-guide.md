# 지원 번들·런타임 진단 운영 가이드

프로덕션 장애 분석 전 **관측 가능성 점검**과 **지원 번들(ZIP)** 사용을 정리합니다. 코드 변경 없이 API와 문서만으로도 수행할 수 있는 검증 흐름을 기준으로 합니다.

## 1. 엔드포인트 역할 (한눈에)

| 목적 | 메서드·경로 | 인증 | 비고 |
|------|-------------|------|------|
| 지원 번들(ZIP) | `GET /api/v1/admin/support-bundle` | Administrator | 마스킹된 JSON 스냅샷; DB 읽기 전용 |
| 유지보수 스냅샷 | `GET /api/v1/admin/maintenance/health` | Administrator | 패널별 OK/WARN/ERROR, 스케줄러·보존·TLS 등 **현재 시점** 집계 |
| 런타임 부팅 진단 | `GET /api/v1/runtime/status` | `REQUIRE_AUTH=true` 시 유효 Bearer 필요 | **앱 기동 시** `evaluate_startup_readiness` 결과 스냅샷 |
| 관리자 헬스 KPI | `GET /api/v1/admin/health-summary` | (라우트 정책에 따름) | `delivery_logs` 등 기반 1h 메트릭 |

자세한 번들 파일 목록은 `docs/admin/support-bundle.md`를 참고합니다.

## 2. 지원 번들에 **포함**되는 것

- `manifest.json`: 생성 시각(UTC), 포맷 id, 파일 목록, 행 제한.
- `app_version_config.json`: 앱/환경, `REQUIRE_AUTH`, `AUTH_DEV_HEADER_TRUST`, 마스킹된 `DATABASE_URL`, DB 연결·`version()` 요약.
- `runtime_health.json`: **`GET /api/v1/admin/health-summary`와 동일**한 `build_admin_health_summary` 페이로드(DB 지연, 스트림 체크포인트 지연, 목적지 p95 지연, 실패율 등).
- 엔터티 요약: 커넥터/소스/스트림/목적지/라우트/최근 `delivery_logs`·감사 로그·보존·설정 버전·체크포인트(각종 JSON은 `mask_secrets_and_pem` 등).
- `backend_frontend_metadata.json`: 설정 필드 스냅샷(민감 필드는 `********`), HTTPS·알림 채널 요약(웹훅 마스킹).

## 3. 지원 번들에 **기본 포함되지 않는** 것 (운영자가 별도 수집)

다음은 **의도적으로** 번들 밖에 있거나 다른 API에만 있습니다.

| 항목 | 권장 출처 | 이유 |
|------|-----------|------|
| `migration_integrity` 전체 블록 | `GET /api/v1/runtime/status`의 `migration_integrity`, 또는 `maintenance/health`의 `panels.migrations.migration_integrity` | 번들의 `runtime_health.json`은 헬스 KPI만 포함 |
| Alembic DB 리비전(라이브 재확인) | `maintenance/health` → `panels.migrations.database_revision` | 부팅 스냅샷과 다를 수 있음(아래 “스냅샷 신선도”) |
| 스트림 스케줄러·워커 수 | `maintenance/health` → `panels.scheduler` | 프로세스 내 런타임 상태 |
| 보존 스케줄러·디스크·목적지 1h 스파이크 | 동일 `panels.retention` / `storage` / `destinations` | 유지보수 집계 전용 |
| 인증·세션 **상태** (특정 사용자 토큰 등) | 번들에 없음. `REQUIRE_AUTH`·`AUTH_DEV_HEADER_TRUST`는 `app_version_config.json`에만 요약 | JWT/세션은 지원 자료에 넣지 않음 |
| 세션 동작 점검 | `docs/operations/auth-session-operations.md`, `GET /api/v1/auth/whoami` 등 | 운영 절차 문서 |

## 4. 스냅샷 신선도 (stale)

- **`/api/v1/runtime/status`**: 애플리케이션 lifespan에서 한 번 평가한 `StartupSnapshot`을 반환합니다. **DB 마이그레이션을 배포 후 재시작 없이 적용한 경우** 등, 부팅 이후 스키마/스탬프가 바뀌어도 응답이 갱신되지 않을 수 있습니다.
- **`/api/v1/admin/maintenance/health`**: 요청 시점에 DB 프로브·Alembic 스크립트 헤드·스케줄러·보존 등을 다시 계산합니다. **현재 프로세스·DB 정합성**을 보려면 여기를 우선합니다.
- **지원 번들**: ZIP을 만든 시각은 `manifest.json` / 각 JSON의 `generated_at_utc`로 확인합니다. 장시간 공유 전에 **재다운로드**하는 것이 안전합니다.

## 5. 민감 정보·마스킹 (감사 요약)

- 번들 파이프라인은 `mask_secrets_and_pem`, `redact_pem_literals`, DB URL 비밀번호 마스킹, 웹훅 URL 마스킹을 사용합니다.
- `backend_settings_metadata`에서 이름이 지정된 고위험 필드(예: `SECRET_KEY`, `JWT_SECRET_KEY`, `ENCRYPTION_KEY`, MinIO 키, 프록시 리로드 토큰, 검증용 시크릿, **개발용 SFTP/SSH 비밀번호**)는 값이 있으면 `********`로만 기록됩니다.
- **여전히 평문으로 나올 수 있는 것**: 비밀번호가 아닌 일반 설정 문자열, 호스트명·포트·경로, 마스킹 규칙에 없는 커스텀 키 이름 아래의 값. 커스텀 커넥터 설정은 키 이름 기반 마스킹에 의존합니다.
- 번들·감사 로그에는 **액세스/리프레시 JWT 본문**이 포함되지 않습니다.

## 6. 권장 수집 절차 (티켓 첨부용)

1. Administrator로 `GET /api/v1/admin/maintenance/health` 저장(JSON).
2. 동일 시각에 `GET /api/v1/admin/support-bundle` 다운로드(ZIP).
3. `REQUIRE_AUTH=true` 환경이면 `GET /api/v1/runtime/status` JSON 추가(부팅 진단·`migration_integrity`).
4. 인증 이슈 suspected 시 `docs/operations/auth-session-operations.md` 절차 및 필요 시 `GET /api/v1/auth/whoami` 결과(토큰 값은 마스킹해 공유).

## 7. 관측 갭 (로드맵 없이 현재 상태만)

- 번들 단일 아카이브에 **유지보수 패널 전체**가 들어가지는 않음 → 위 표대로 API 병행.
- `runtime/status`의 스냅샷은 **기동 시점** 중심 → 장기 실행 후 마이그레이션 드리프트는 `maintenance/health`로 교차 검증.
- 인증 관련은 **플래그 요약** 위주; 세션 디버깅은 auth API·감사 로그 UI가 주 경로.

관련 스펙: `specs/026-support-bundle/spec.md`, `specs/027-maintenance-center/spec.md`.
