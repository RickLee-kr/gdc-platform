# Generic Data Connector Platform

외부 시스템(HTTP API, 향후 DB·Webhook 수신)에서 데이터를 수집·파싱하고, Mapping과 Enrichment를 적용한 뒤 Syslog·Webhook 등 **여러 Destination**으로 전달하기 위한 경량 커넥터 플랫폼입니다.

Single source of truth는 [`docs/master-design.md`](docs/master-design.md)입니다.

로컬 백엔드/프론트 분리 실행 가이드는 [`docs/operator-runbook.md`](docs/operator-runbook.md)를 참고하세요.

## Runtime Management 프론트엔드 (`frontend/`)

운영자용 **Runtime Management MVP UI**는 저장소 루트가 아니라 **`frontend/`** 아래의 **별도 Vite + React + TypeScript 앱**입니다. 이 태스크 범위에서는 FastAPI가 정적 프론트를 호스팅하지 않으며, 개발 시에는 Vite 개발 서버로 실행합니다.

상세한 화면 구역·API 베이스 URL(`VITE_API_BASE_URL`)·브라우저 `localStorage` 오버라이드·로컬 설정은 **`frontend/README.md`**를 참고하세요.

### 요구 사항

- **Node.js 20 이상** (검증은 보통 Node 22 사용)

이 호스트처럼 시스템 기본 `PATH`의 Node가 오래된 경우(예: Node 12), **nvm으로 설치한 Node 22를 PATH 앞에 두고** 실행합니다:

```bash
export PATH=$HOME/.nvm/versions/node/v22.18.0/bin:$PATH
```

### 명령어 (`frontend/` 디렉터리에서)

```bash
cd frontend
npm install
npm run dev          # 로컬 개발 서버
npm run validate     # 테스트 + 프로덕션 빌드 + ESLint (릴리스 전 점검)
npm run build        # 타입체크 및 `frontend/dist` 생성만 필요할 때
```

한 줄 예시:

```bash
cd /path/to/gdc-platform/frontend
PATH=$HOME/.nvm/versions/node/v22.18.0/bin:$PATH npm run validate
```

백엔드 API는 기본적으로 `http://localhost:8000` 등 별도 프로세스에서 띄우며, 프론트는 문서화된 방식으로 그 베이스 URL을 맞춥니다 (환경 변수 및 UI 오버라이드).

## 현재 단계: Backend Skeleton

- FastAPI 앱, 라우터·스키마·서비스·모델 **자리표시자**
- 실제 DB CRUD, 인증, 폴링, 전송 로직 **미구현**
- Alembic·React UI·Docker Compose는 이 단계에서 제외

## 아키텍처 핵심 원칙 (요약)

1. **Connector**와 **Stream**은 분리한다.
2. **Source**와 **Destination**은 분리한다.
3. 실행 단위는 항상 **Stream**이다.
4. Stream과 Destination은 **Route**로 연결한다(Multi Destination 전제).
5. **Mapping**과 **Enrichment**는 분리한다.
6. **Checkpoint**는 Destination 전송 성공 후에만 갱신한다.
7. **Source Rate Limit**과 **Destination Rate Limit**은 별도 구성 요소로 유지한다.
8. 실패 로그는 **stage·error_code** 중심으로 구조화 저장한다.
9. MVP는 HTTP Polling이지만 **DB Source·Webhook Receiver** 확장을 구조적으로 허용한다.

## 요구 사항

- Python 3.11+
- (선택) 가상환경

## 설치

```bash
cd /path/to/gdc-platform
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

## 실행

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- API 문서: `http://localhost:8000/docs`
- 헬스 체크: `GET http://localhost:8000/health`
- API 베이스: `http://localhost:8000/api/v1/...`

## PostgreSQL 운영/개발 실행 (EXPLAIN ANALYZE)

PostgreSQL이 공식 개발/운영 DB입니다. SQLite는 지원하지 않습니다.

```bash
# 1) PostgreSQL 실행
docker compose up -d postgres

# 2) PostgreSQL URL 지정
export DATABASE_URL=postgresql://gdc:gdc@localhost:5432/gdc

# 3) 마이그레이션 적용
venv/bin/alembic upgrade head

# 4) 시드 데이터 입력
venv/bin/python scripts/seed.py

# 5) 쿼리 플랜 프로파일링 (EXPLAIN ANALYZE)
venv/bin/python scripts/profile_query_plan.py --stream-id 1 --route-id 1 --destination-id 1 --limit 50
```

## 다음 단계 제안

1. **DB 모델 상세화 및 마이그레이션(Alembic)** — `docs/master-design.md` §19 컬럼을 반영한 완전한 ORM 모델과 초기 스키마.
2. **CRUD 구현** — Connector / Source / Stream / Mapping / Enrichment / Destination / Route / Checkpoint / DeliveryLog.
3. 테이블 생성 후 **관계(FK)·인덱스** 정리 및 시드(단일 관리자 계정 등) 검토.
