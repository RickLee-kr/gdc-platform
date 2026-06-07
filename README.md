# Data Relay — Enterprise Data Control Gateway

**Version:** v1.0 Release Candidate (OSS)

Data Relay is an open-source **Enterprise Data Control Gateway**. It collects data from external systems (HTTP API polling, webhook receiver), applies Mapping and Enrichment, runs schema drift detection, sensitive-data detection, protection, classification, and policy enforcement, then delivers events to multiple Destinations with governance, RBAC, and audit controls.

Single source of truth for architecture: [`docs/master-design.md`](docs/master-design.md)

Release documentation: [`docs/release/`](docs/release/)

---

## What is Data Relay

Data Relay is a lightweight connector platform that:

- Separates **Connectors**, **Streams**, **Sources**, and **Destinations**
- Executes pipelines at the **Stream** level
- Connects streams to destinations via **Routes** (multi-destination)
- Applies **Mapping** before **Enrichment**
- Updates **Checkpoints** only after successful destination delivery
- Provides **Governance** (violations, quarantine, replay, approvals, audit, notifications)
- Enforces **RBAC** for operator and governance personas

---

## Architecture

```
Source
  ↓
Mapping
  ↓
Enrichment
  ↓
Schema Drift
  ↓
Sensitive Detection
  ↓
Protection
  ↓
Classification
  ↓
Policy
  ↓
Quarantine
  ↓
Replay
  ↓
Dynamic Routing
  ↓
Failover
  ↓
Destination
```

---

## Quick Start

### Requirements

- Docker Engine 24+ with Compose v2
- Ports **18080** (HTTP) and **18443** (HTTPS)

### Install and run

```bash
git clone <repository-url> data-relay
cd data-relay
cp .env.example .env
# Set JWT_SECRET_KEY, SECRET_KEY, ENCRYPTION_KEY, POSTGRES_PASSWORD before production use

docker compose -f docker-compose.platform.yml up -d
```

Or use the release installer:

```bash
./scripts/release/install.sh
```

Open **https://localhost:18443/** (accept self-signed cert) or **http://localhost:18080/**.

**Default login:** `admin` / `admin` — password change required on first login.

Override bootstrap password with `GDC_SEED_ADMIN_PASSWORD` in `.env`.

---

## First Stream

Use the stream wizard (**Streams → Create First Stream**):

| Step | Action |
|------|--------|
| **Connect** | Create connector + HTTP source (see `samples/http/example-api.json`) |
| **Mapping** | JSONPath field mappings (`samples/mappings/example-mapping.json`) |
| **Destination** | Webhook or Syslog (`samples/destinations/`) |
| **Review** | Enable stream and start delivery |

Sample JSON files are in the [`samples/`](samples/) directory.

---

## Governance

After streams are running, use **Governance** in the sidebar:

| Surface | Purpose |
|---------|---------|
| **Dashboard** | Executive KPIs, risk overview, compliance snapshot |
| **Operations** | Day-to-day governance actions |
| **Violations** | Policy violation triage |
| **Quarantine** | Held events review and release |
| **Replay** | Re-process quarantined or failed events |
| **Approvals** | Policy approval workflow |
| **Audit** | Immutable governance audit trail |
| **Notifications** | Email and webhook alert configuration |

RBAC controls who can view governance surfaces. Users without `governance_read` do not see the Governance menu.

---

## Administration

| Area | Path | Purpose |
|------|------|---------|
| **Users & Roles** | Settings | Platform users, roles, credentials |
| **Destinations** | Destinations | Reusable delivery endpoints |
| **Connectors** | Connectors | Source connectors |
| **Routes** | Routes | Stream-to-destination links |
| **Backup** | Backup & Import | Configuration export/import |

---

## Configuration

Key environment variables (see [`.env.example`](.env.example)):

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET_KEY` | Yes | JWT signing secret (`JWT_SECRET` in operator docs) |
| `SMTP_ENABLED` | Yes | Enable SMTP for governance email (`false` until configured) |
| `WEBHOOK_TIMEOUT` | Yes | Governance webhook timeout in seconds (default `10`) |
| `REQUIRE_AUTH` | Yes | Require login for API/UI |
| `ENABLE_DEV_VALIDATION_LAB` | No | Must be `false` in production |

Production checklist: [`docs/release/production-checklist.md`](docs/release/production-checklist.md)

---

## Development

### Backend (local)

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend (local)

```bash
cd frontend
npm install
npm run dev
```

Set `VITE_OSS_RELEASE_MODE=false` to expose internal validation lab UI during development.

### Tests

```bash
# Backend (isolated gdc_pytest catalog)
./scripts/test/run-backend-full.sh

# Frontend
cd frontend && npm run validate
```

---

## Documentation index

| Document | Description |
|----------|-------------|
| [`docs/master-design.md`](docs/master-design.md) | Architecture reference |
| [`docs/deployment/install-guide.md`](docs/deployment/install-guide.md) | Detailed install |
| [`docs/release/installation-validation.md`](docs/release/installation-validation.md) | Install verification steps |
| [`docs/release/production-checklist.md`](docs/release/production-checklist.md) | Production go-live checklist |
| [`docs/release/release-readiness-audit.md`](docs/release/release-readiness-audit.md) | M20.4 release audit |
| [`docs/operator-runbook.md`](docs/operator-runbook.md) | Operator procedures |

---

## License

See repository license file for OSS terms.
