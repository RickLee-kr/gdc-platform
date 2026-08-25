#!/usr/bin/env python3
"""Append-only Marketplace documentation updater for Data Relay.

Design goals:
- Read the repository's CURRENT documents in place.
- Never rewrite/remove original content: every update is appended after EOF.
- Create one new Marketplace architecture charter.
- Skip historical/archive documents.
- Produce a SHA256/prefix-preservation report.
- No git commit/push.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path
from datetime import datetime, timezone

MARK = "DATA RELAY MARKETPLACE ADDENDUM v1.0"

COMMON_STATUS = """Status: Architecture Direction / Implementation Pending
Authority: Additive only. Existing Product Charter, Runtime Is Truth, Stream/Route, Credential, Governance, and Checkpoint invariants remain authoritative.
Reference: `docs/history/architecture/marketplace/DATA-RELAY-CONNECTOR-MARKETPLACE-ARCHITECTURE-CHARTER-v1.0-DRAFT.md`
"""

ADDENDA: dict[str, str] = {
"docs/history/source-of-truth/PRODUCT-CHARTER-Version-1.2.1-FINAL.txt": f"""
==================================================
{MARK}
Product Scope Extension — Connector Marketplace & Integration Ecosystem
==================================================

{COMMON_STATUS}

Data Relay Connector Marketplace는 Data Relay의 Data Collection / Data Delivery 통합 생태계를 확장하기 위한 제품 기능이다.

Marketplace의 목적:

- Source Pack / integration package를 검색·검증·설치·업데이트·롤백·제거한다.
- Built-in과 외부 설치 integration을 동일한 package contract로 관리한다.
- 사용자가 ChatGPT, Claude Code, Cursor 또는 향후 Data Relay Builder를 사용해 vendor API 문서, OpenAPI, sample payload, 기존 script를 기반으로 draft package를 만들 수 있게 한다.
- 라이선스와 provenance가 허용되는 외부 open-source connector 지식을 Data Relay package 규격으로 변환할 수 있게 한다.

Marketplace는 Data Relay Core Runtime을 대체하지 않는다.

Installed package는 기존 Connector / Source / Stream / Mapping / Enrichment / Route / Destination 모델과 기존 runtime을 사용해야 한다.

다음은 금지한다.

- Parallel Connector Runtime
- Parallel Authentication Engine
- Parallel Retry / Delivery / Checkpoint Engine
- Package 내부 credential/secret 저장
- Marketplace V1 package의 arbitrary Python / JavaScript / shell 실행

기존 Source Pack (`specs/049`)을 Marketplace package content의 foundation으로 사용한다.

Marketplace Package 종류:

- Source Pack (Connector Pack은 UX synonym이며 새로운 runtime entity가 아님)
- Stream Extension Pack
- Future Destination Pack

AI-assisted package authoring은 integration authoring tooling이며, PRODUCT-CHARTER에서 Out Of Scope로 정의한 AI Gateway / AI Agent Platform / LLM Hosting Platform을 제품 범위로 다시 포함시키지 않는다.

Marketplace trust/support tier는 package가 self-assert할 수 없고 platform validation/review 결과로 관리한다.

- Local Draft
- Private
- Imported
- Community
- Verified
- Official

Remote public registry는 optional이며 air-gapped operation을 위해 default OFF 방향을 따른다.
""",

"docs/history/source-of-truth/MASTER-WBS-Version-1.2.1-FINAL.txt": f"""
==================================================
{MARK}
Phase G — Connector Marketplace & Ecosystem
==================================================

{COMMON_STATUS}

본 Workstream은 기존 Phase A~D의 historical completion percentage를 변경하지 않는다.
Enterprise Edition Backlog Phase F/M25~M28의 하위 항목이 아니다.

M29
Connector Marketplace & Ecosystem

--------------------------------------------------

M29.0
Marketplace / Source Pack Specification Consolidation

- `specs/049` Source Pack model을 canonical package content foundation으로 사용
- Marketplace Package / Source Pack / Stream Extension Pack 용어 및 dependency 확정
- Marketplace V1 declarative-only rule 확정

--------------------------------------------------

M29.0a
License & Provenance Specification

- Upstream URL / commit / path / license / NOTICE provenance
- License gate: AUTO_PORT_CANDIDATE / REVIEW_ADAPT / REFERENCE_ONLY
- Unknown/no-license direct import 금지

--------------------------------------------------

M29.0b
External Connector Import Specification

- Open-source Connector Harvester
- Runtime code 복사보다 endpoint/auth/pagination/cursor/schema/fixture 지식 추출 우선
- Data Relay runtime/security/reliability 재사용

--------------------------------------------------

M29.1
Manifest v2 + Backward Compatibility

--------------------------------------------------

M29.2
Unified Built-in / Installed Multi-root Registry

--------------------------------------------------

M29.3
Package Lifecycle

- Safe Acquire / Upload
- Install
- Upgrade
- Rollback
- Uninstall / dependency protection

--------------------------------------------------

M29.4
Data Relay Package Validator

- schema/dependency
- archive safety
- secret scan
- auth/pagination/cursor/checkpoint
- fixture/mapping/expected output
- registry cache/version/invalidation

--------------------------------------------------

M29.5
Marketplace Security

- Ed25519-style package signature direction
- trusted keys/publishers
- RBAC
- SSRF/network policy
- license/provenance policy

--------------------------------------------------

M29.6
Connector Harvester / External Import Pipeline

Initial candidates after per-artifact license review:

- Meltano / Singer
- OpenTelemetry Collector Contrib
- Fluent Bit
- Telegraf

--------------------------------------------------

M29.7
AI Connector Translator / Builder Contract

- ChatGPT / Claude Code / Cursor authoring
- vendor docs/OpenAPI/sample/script → draft Source Pack / Stream Extension Pack
- AI auto-publish/auto-Verified 금지

--------------------------------------------------

M29.8
Marketplace UI

- Browse / Search / Trust / Version / License / Compatibility
- Install / Upgrade / Rollback / Uninstall
- Upload / Git / Create with AI
- 기존 Data Sources → Connectors UX에 우선 통합

--------------------------------------------------

M29.9
Remote / Private Registry

- Remote public registry optional
- default OFF
- offline signed bundle / private registry 지원 방향

--------------------------------------------------

M29 Integration Gates

- Existing built-in connector normalization
- Missing connector/stream content는 Marketplace package path로 편입
- Targeted integration regression
- Final 32,184 Full Matrix acceptance
- 7 Human Acceptance scenarios

Full Matrix는 M29 주요 통합 완료 후 최종 integration gate에서 수행한다.
""",

"docs/history/source-of-truth/DATA-RELAY-UX-CHARTER-v1.2.1-FINAL.txt": f"""
==================================================
{MARK}
Marketplace UX Extension
==================================================

{COMMON_STATUS}

Marketplace는 우선 기존 primary navigation의 `Data Sources → Connectors` 안에서 integration discovery/install UX로 제공한다.
새로운 top-level navigation은 UX evidence 없이 추가하지 않는다.

사용자는 다음 질문에 답할 수 있어야 한다.

- 이 integration은 무엇을 수집하는가?
- 어떤 Stream이 제공되는가?
- 누가 만들었고 어디에서 왔는가?
- 어떤 version/API version인가?
- Official / Verified / Community / Imported / Private / Draft 중 어떤 상태인가?
- 설치/업데이트가 기존 Stream에 어떤 영향을 주는가?

Missing integration UX:

- Upload Package
- Install from Git
- Create with AI

Install은 자동 Stream enable이 아니다.
설치 후 기존 Stream Wizard에서 Credential과 Stream을 명시적으로 구성한다.

Built-in package와 installed package는 동일 catalog UX를 사용하되 origin/provenance를 표시한다.
Remote registry는 optional/default OFF이며 offline upload UX를 보장한다.
""",

"docs/history/source-of-truth/DATA-RELAY-STREAM-WIZARD-UX-CHARTER-v5.2-FINAL.txt": f"""
==================================================
{MARK}
Stream Wizard Marketplace Integration
==================================================

{COMMON_STATUS}

Stream Wizard의 Connect 단계는 Unified Registry가 제공하는 installed/built-in Source Pack을 선택할 수 있어야 한다.

Integration이 없을 경우 사용자는 Wizard를 복잡하게 만들지 않고 다음 보조 흐름으로 이동할 수 있다.

- Browse Marketplace
- Upload Package
- Install from Git
- Create with AI

설치/생성 완료 후 Wizard의 Connect 단계로 돌아온다.

Stream Extension Pack은 기존 connector family에 새로운 Stream 선택지를 추가한다.
Connector와 Stream은 계속 분리된다.

Package에는 secret이 없으며 Credential은 기존 Connected Credential/runtime auth flow를 사용한다.

Marketplace는 Wizard step을 추가하지 않는다.
기존 Destination First 및 Route Processing 순서를 변경하지 않는다.
""",

"docs/ux/DATA-RELAY-ROUTE-PROCESSING-UX-SPEC.md": f"""

---

## {MARK} — Route Processing Boundary

{COMMON_STATUS}

Marketplace는 integration acquisition/configuration layer이며 Route Processing engine이 아니다.

Package가 mapping/enrichment/formatter/reliability recommendation을 제공할 수 있으나 materialization 후에는 기존 Data Relay configuration이 된다.

Route Processing 순서는 변경하지 않는다:

`Transform → Protection → Classification → Policy → Delivery`

One Stream → Many Routes → Many Destinations, route isolation, delivery success 이후 checkpoint advance 원칙을 그대로 유지한다.
""",

"docs/history/source-of-truth/GOVERNANCE-UX-CHARTER-v1.1-FINAL.txt": f"""
==================================================
{MARK}
Package Governance Boundary
==================================================

{COMMON_STATUS}

Marketplace package governance와 기존 Data Governance는 분리한다.

Marketplace Administration에서 다룰 수 있는 항목:

- install/publish permission
- trusted publisher/key
- package signature status
- package origin/provenance
- license decision
- validation status
- package lifecycle audit

기존 Governance UX는 Protection / Classification / Policy / Violation / Quarantine / Replay와 같은 데이터 통제를 계속 담당한다.
Marketplace security를 Stream Governance step으로 노출하지 않는다.
""",

"docs/history/source-of-truth/DATA-RELAY-GOVERNANCE-WORKSPACE-UX-CHARTER-v1.1-FINAL.txt": f"""
==================================================
{MARK}
Governance Workspace Separation Rule
==================================================

{COMMON_STATUS}

Marketplace package approval/signing/license governance는 Governance Workspace의 새로운 기본 기능이 아니다.

Governance Workspace는 materialized Stream/Route 데이터에 대한 기존 protection/classification/policy intent를 유지한다.
Package lifecycle/trust 관리는 Administration / Marketplace 영역에서 수행한다.

Package가 제공하는 policy/transform recommendation은 자동 강제되지 않으며 기존 operator intent와 Governance rule이 우선한다.
""",

"docs/reference/governance/DATA-RELAY-GOVERNANCE-WORKSPACE-v1.1-FINAL.txt": f"""
==================================================
{MARK}
Marketplace Implementation Boundary
==================================================

{COMMON_STATUS}

Marketplace package metadata, signature, license, install/version state는 별도 Marketplace/Registry persistence concern이다.
Governance Workspace persistence와 합치지 않는다.

Package에는 credential/token/secret을 저장하지 않는다.
Materialized Stream/Route는 기존 Governance Workspace와 동일한 persisted intent/effective behavior를 사용한다.

Friend/fork marketplace migration을 현재 migration chain에 cherry-pick하지 않는다. Marketplace schema가 필요하면 current Alembic head 이후 새 migration으로 작성한다.
""",

"docs/reference/governance/DATA-RELAY-GOVERNANCE-AND-TRANSFORM-POLICY-DRAFT-v1.1-FINAL.txt": f"""
==================================================
{MARK}
Marketplace Transform Policy
==================================================

{COMMON_STATUS}

Source Pack / Stream Extension Pack이 제공하는 Mapping/Enrichment/Transform definition은 기존 Data Relay declarative transform contract를 따라야 한다.

Marketplace V1 package는 arbitrary Python / JavaScript / shell transform을 실행할 수 없다.

Package content는 기존 processing order와 policy enforcement를 우회할 수 없다.
Package recommendation보다 operator configuration과 Governance policy가 우선한다.
""",

"docs/reference/ux/DATA-RELAY-UNION-SCHEMA-UX-SPEC-v1.1-FINAL.txt": f"""
==================================================
{MARK}
Package Schema Evidence Rule
==================================================

{COMMON_STATUS}

Package의 schema/sample/mapping은 onboarding evidence 및 preview input이다.
Union Schema의 runtime authority를 대체하지 않는다.

- Live/API Test payload가 stale package sample보다 우선한다.
- Package schema는 initial preview/compatibility check에 사용할 수 있다.
- Union Schema는 계속 Stream scope이다.
- Stream Extension Pack 추가 때문에 기존 Union Schema baseline을 silent rewrite하지 않는다.
- Package upgrade로 field/type drift가 예상되면 명시적 compatibility warning을 제공한다.
""",

"docs/ux/DATA-RELAY-SCHEMA-DRIFT-POLICY-RUNTIME-SPEC.md": f"""

---

## {MARK} — Package Schema / Drift Boundary

{COMMON_STATUS}

Package-provided schema/sample은 evidence이며 confirmed runtime baseline이 아니다.
Package install/upgrade 자체는 Schema Drift baseline을 변경하지 않는다.

Live sample/runtime observation과 기존 Schema Drift state machine이 authoritative하다.
Package version 변화로 schema incompatibility가 예상되면 apply 전에 compatibility warning/block을 제공해야 한다.
""",

"docs/history/source-of-truth/CHATGPT-DATA-RELAY-GUARDRAIL.txt": f"""
==================================================
{MARK}
AI Marketplace Authoring Guardrail
==================================================

{COMMON_STATUS}

ChatGPT / Claude Code / Cursor가 Marketplace integration을 작성할 때:

- 새 vendor runtime을 core에 직접 추가하기보다 Source Pack / Stream Extension Pack을 우선한다.
- `specs/049`와 Marketplace Charter를 먼저 따른다.
- Package에 secret을 기록하지 않는다.
- Foreign auth/retry/delivery/checkpoint engine을 복사하지 않는다.
- AI output은 Local Draft/untrusted로 시작한다.
- Vendor API live test가 없으면 Verified/Official이라고 표현하지 않는다.
- External source를 사용하면 upstream URL/commit/path/license/provenance를 기록한다.
- Unknown/no-license content는 직접 port하지 않는다.
- Marketplace가 구현되기 전에는 문서의 target architecture를 현재 제품 기능으로 주장하지 않는다.
""",

"docs/architecture/OSS-v1-ARCHITECTURE.md": f"""

---

## {MARK} — Marketplace Architecture Extension

{COMMON_STATUS}

Marketplace adds a package/control plane above the existing OSS runtime:

```text
Source Pack / Stream Extension Pack
            ↓
     Unified Registry
            ↓
 Validate / Install / Configure
            ↓
 Connector / Source / Stream
            ↓
 Existing StreamRunner / Route Runtime
```

Built-in and installed integrations use one logical package contract. Package origin does not create a new execution engine.
Marketplace V1 packages are declarative and contain no arbitrary executable code or secrets.
Remote registry is optional; offline upload/built-in operation remains supported.
""",

"docs/ux/dashboard-operational-monitoring.md": f"""

---

## {MARK} — Operational Visibility

{COMMON_STATUS}

Dashboard/runtime monitoring remains focused on operational data flow health, not Marketplace administration.

Where useful, source/connector detail may show package context such as package version, vendor API version, origin, and update/compatibility warning.
Install/signing/license administration belongs in Marketplace/Administration, not the operational dashboard.
""",

"docs/README.md": f"""

---

## {MARK} — Documentation Entry Point

{COMMON_STATUS}

Marketplace target architecture is defined in:

`docs/history/architecture/marketplace/DATA-RELAY-CONNECTOR-MARKETPLACE-ARCHITECTURE-CHARTER-v1.0-DRAFT.md`

It extends the existing `specs/049-template-registry` Source Pack model with package distribution, trust, install/upgrade/rollback/uninstall, external import, AI authoring, and optional registry concepts.

Do not treat Marketplace as implemented until runtime/API/UI/tests prove the relevant M29 phase complete.
""",

"docs/getting-started/GETTING-STARTED.md": f"""

---

## {MARK} — Future Integration Onboarding

{COMMON_STATUS}

When Marketplace phases are implemented, Getting Started may offer built-in or installed Source Packs as a faster Connect path.
Installation will not automatically create credentials or enable Streams; the user still explicitly configures Credential/Stream/Destination and deploys through the existing Wizard.

Until implementation is complete, the current documented onboarding flow remains authoritative.
""",

"docs/release/KNOWN-LIMITATIONS.md": f"""

---

## {MARK} — Marketplace Implementation Status

{COMMON_STATUS}

At `wave2-marketplace-baseline` the Marketplace target architecture is documented but final Marketplace lifecycle/UI/remote registry implementation is not yet complete.

Do not claim support for package install/upgrade/rollback/uninstall, public remote registry, AI auto-generation, or bulk external connector import until the corresponding M29 implementation and tests land.

Marketplace V1 target explicitly excludes arbitrary executable package code.
""",

"docs/architecture/route-processing-persist-roadmap.md": f"""

---

## {MARK} — Marketplace/Persist Boundary

{COMMON_STATUS}

Package install is not Stream Deploy and does not alter Route Processing persist state.
Materialization/apply must use the same existing persist/readiness contracts as manually configured Streams/Routes.
Package upgrade MUST NOT silently convert `intent_only`, advance checkpoint, or bypass deploy blockers.
""",

"docs/architecture/source-of-truth-index.md": f"""

---

## {MARK} — Source-of-Truth Extension

Status: Proposed architecture extension; implementation pending.

New Marketplace architecture document:

- `docs/history/architecture/marketplace/DATA-RELAY-CONNECTOR-MARKETPLACE-ARCHITECTURE-CHARTER-v1.0-DRAFT.md`

Marketplace hierarchy:

```text
PRODUCT
  PRODUCT-CHARTER v1.2.1 + Marketplace additive scope

INTEGRATION ECOSYSTEM
  Source Pack (`specs/049`) — canonical integration content model
  Marketplace Charter — distribution/trust/lifecycle/import/AI authoring model

RUNTIME
  Existing Stream / Route / Credential / Reliability architecture remains authoritative
```

Reading rule for Marketplace work:

1. PRODUCT-CHARTER.
2. This Source-of-Truth Index.
3. Marketplace Charter.
4. `specs/049-template-registry`.
5. Current Connector/Registry/Credential runtime code and tests.
6. Historical/fork Marketplace work is reference only unless re-audited and adapted.

Marketplace documentation MUST NOT be interpreted as proof that implementation is complete.
""",

"specs/049-template-registry/spec.md": f"""

---

## {MARK} — Relationship to Connector Marketplace

{COMMON_STATUS}

This specification's **Source Pack** remains the canonical source-integration content model for Marketplace.
Marketplace does not introduce a competing runtime entity called Connector Pack; `Connector Pack` may be used as a UX synonym only.

Marketplace extends Source Pack with outer-layer concerns:

- distribution origin: builtin/upload/git/registry
- validation and package integrity
- signatures/trusted publishers
- license/provenance
- install/upgrade/rollback/uninstall
- trust/support tiers
- Stream Extension Pack dependency model
- external open-source import
- AI-assisted draft generation

The original `Not in scope` statements in this spec remain correct for **spec 049 itself**. M29 Marketplace is a separate outer workstream that may implement those capabilities while preserving every Source Pack runtime/materialization invariant here.

AI-generated packs remain `draft` until validation/review; no AI auto-publish to Verified/Official.
""",

"specs/013-template-connector-system/spec.md": f"""

---

## {MARK} — Marketplace Transition

{COMMON_STATUS}

Phase-1 template connector files remain supported as legacy package shapes during Marketplace migration.
They SHOULD be normalized through `specs/049` Source Pack compatibility rather than replaced by a parallel Marketplace runtime.

Existing instantiate semantics remain unchanged until an approved Marketplace phase explicitly evolves them.
""",

"specs/001-core-architecture/spec.md": f"""

---

## {MARK} — Core Architecture Invariant

{COMMON_STATUS}

Marketplace packages are configuration/distribution artifacts, not runtime entities.
Connector ≠ Stream, Source ≠ Destination, Stream remains execution unit, Route remains destination-specific processing unit.
Built-in and installed packages MUST materialize/refer to the same core entities and MUST NOT introduce vendor-specific runtime forks.
""",

"specs/002-runtime-pipeline/spec.md": f"""

---

## {MARK} — Runtime Pipeline Invariant

{COMMON_STATUS}

Package origin/version MUST NOT change runtime pipeline ordering or checkpoint semantics.
Marketplace-supplied request/pagination/mapping definitions execute through existing source adapters, mapping/enrichment, fan-out, delivery, and checkpoint behavior.
""",

"specs/003-db-model/spec.md": f"""

---

## {MARK} — Persistence Boundary

{COMMON_STATUS}

Marketplace may add registry/install/version/provenance persistence, but MUST NOT collapse Connector/Source/Stream relationships or remove Connected Credential relationships.
Marketplace migrations are new revisions from the current Alembic head; historical/fork migration chains are not cherry-picked.
""",

"specs/004-delivery-routing/spec.md": f"""

---

## {MARK} — Delivery Boundary

{COMMON_STATUS}

Source/Stream packages do not own delivery runtime. Any destination/reliability recommendation is advisory until materialized into existing Destination/Route configuration.
Route failure, retry, queue, checkpoint, failover, replay, and destination rate-limit semantics remain authoritative.
""",

"specs/048-runtime-reliability/spec.md": f"""

---

## {MARK} — Package Reliability Hints

{COMMON_STATUS}

A package may declare compatibility/runtime hints only for reliability modes the platform supports.
Package content MUST NOT ship a custom retry/queue/circuit/checkpoint implementation.
Runtime configuration and current reliability policy remain authoritative over package recommendations.
""",

"specs/091-route-processing-architecture/spec.md": f"""

---

## {MARK} — Marketplace Compatibility

{COMMON_STATUS}

Marketplace materialization MUST preserve the Route Processing foundation and One Stream → Many Routes → Many Destinations model. Package installation itself does not create a new route-processing path.
""",

"specs/092-per-route-transform/spec.md": f"""

---

## {MARK} — Marketplace Compatibility

{COMMON_STATUS}

Package mapping/enrichment/transform presets are declarative inputs only. Per-route Transform remains governed by this spec; package content cannot execute arbitrary code or bypass persisted transform configuration.
""",

"specs/093-per-route-protection/spec.md": f"""

---

## {MARK} — Marketplace Compatibility

{COMMON_STATUS}

Package presets cannot disable or bypass required Protection behavior. Materialized configuration remains subject to existing per-route Protection/inheritance rules.
""",

"specs/094-per-route-classification/spec.md": f"""

---

## {MARK} — Marketplace Compatibility

{COMMON_STATUS}

Package metadata/recommendations do not replace Classification runtime or route inheritance/override semantics. Current Classification engine remains authoritative.
""",

"specs/095-per-route-policy/spec.md": f"""

---

## {MARK} — Marketplace Compatibility

{COMMON_STATUS}

Marketplace packages cannot self-authorize policy bypass. Existing per-route Policy evaluation/enforcement and Governance decisions always win over package recommendations.
""",

"specs/096-route-runtime-delivery/spec.md": f"""

---

## {MARK} — Marketplace Compatibility

{COMMON_STATUS}

Package origin/version does not alter Route delivery, checkpoint, queue, failover, replay, circuit-breaker, backpressure, or adaptive-concurrency invariants. Destination runtime remains core-owned.
""",

"specs/097-route-processing-ux/spec.md": f"""

---

## {MARK} — Marketplace Compatibility

{COMMON_STATUS}

Marketplace discovery/install belongs before or alongside Connect onboarding, not inside Route Processing stages. Existing Destination First and five-stage Route Processing UX remains unchanged.
""",

".specify/memory/constitution.md": f"""

---

## {MARK} — Integration Package Invariants

{COMMON_STATUS}

Marketplace/Source Pack work MUST obey these additional invariants:

1. Source Pack/Marketplace Package is not a runtime execution entity.
2. Built-in and installed integrations share one package contract and existing runtime.
3. Package files contain no credentials/secrets.
4. Marketplace V1 executes no arbitrary package Python/JavaScript/shell/native code.
5. Package origin cannot bypass Credential, HTTP resilience, rate-limit, queue, route, governance, or checkpoint rules.
6. External imports preserve license/provenance and do not replace Data Relay runtime with foreign runtime code.
7. Package install/upgrade does not silently enable Streams or advance checkpoints.
8. Runtime Is Truth.
""",

".specify/specs-index.md": f"""

---

## {MARK} — Marketplace Architecture Direction

{COMMON_STATUS}

Architecture authority:
`docs/history/architecture/marketplace/DATA-RELAY-CONNECTOR-MARKETPLACE-ARCHITECTURE-CHARTER-v1.0-DRAFT.md`

Existing `specs/049-template-registry` Source Pack is the content foundation.
M29 Marketplace adds distribution, trust, validation, lifecycle, external import, and AI authoring around that model without changing Stream/Route runtime invariants.

Planned workstream:
M29.0 specification → M29.1 Manifest v2 → M29.2 unified registry → M29.3 lifecycle → M29.4 validator/cache → M29.5 security → M29.6 harvester → M29.7 AI builder → M29.8 UI → M29.9 optional remote registry.
""",

"specs/035-rbac-lite/spec.md": f"""

---

## {MARK} — Marketplace RBAC Direction

{COMMON_STATUS}

Marketplace authorization MUST reuse the platform RBAC evaluator rather than reintroduce friend/fork platform auth.
Target policy direction: Administrator manages trusted keys/publish policy and high-risk package administration; Operator may install/use packages when policy permits; Viewer remains read-only. Exact endpoint matrix is defined in M29.5 before implementation.
""",

"docs/architecture/credential-encryption-at-rest.md": f"""

---

## {MARK} — Package Secret Boundary

{COMMON_STATUS}

Marketplace packages MUST NOT contain passwords, bearer tokens, API keys, OAuth client secrets, access tokens, or refresh tokens.
Installed Source Packs reference the existing Connected Credential/runtime secret resolution path. AES-256-GCM encryption-at-rest and fail-closed secret handling remain authoritative regardless of package origin.
""",
}

NEW_CHARTER_REPO_PATH = Path("docs/history/architecture/marketplace/DATA-RELAY-CONNECTOR-MARKETPLACE-ARCHITECTURE-CHARTER-v1.0-DRAFT.md")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".", help="Data Relay repository root")
    ap.add_argument("--apply", action="store_true", help="Apply append-only updates. Without this, dry-run only.")
    ap.add_argument("--charter", default=str(Path(__file__).with_name("DATA-RELAY-CONNECTOR-MARKETPLACE-ARCHITECTURE-CHARTER-v1.0-DRAFT.md")))
    ap.add_argument("--report", default="marketplace-document-update-report.json")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    charter_src = Path(args.charter).resolve()
    if not charter_src.is_file():
        raise SystemExit(f"Missing charter source: {charter_src}")

    missing = [p for p in ADDENDA if not (root / p).is_file()]
    if missing:
        print("Missing required CURRENT documents:")
        for p in missing:
            print(" -", p)
        return 2

    preflight = []
    for rel, addendum in ADDENDA.items():
        p = root / rel
        before = p.read_bytes()
        if MARK.encode() in before:
            state = "ALREADY_UPDATED"
        else:
            state = "READY"
        preflight.append({"path": rel, "state": state, "size": len(before), "sha256": sha256(before)})

    charter_dst = root / NEW_CHARTER_REPO_PATH
    charter_state = "EXISTS" if charter_dst.exists() else "READY"

    if not args.apply:
        report = {
            "mode": "DRY_RUN",
            "root": str(root),
            "charter": {"path": str(NEW_CHARTER_REPO_PATH), "state": charter_state},
            "targets": preflight,
            "target_count": len(preflight),
            "historical_documents_modified": False,
        }
        Path(args.report).write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 0

    already = [x["path"] for x in preflight if x["state"] == "ALREADY_UPDATED"]
    if already:
        print("Refusing partial/repeated application; marker already exists:")
        for p in already:
            print(" -", p)
        return 3

    # Create charter first; never overwrite a different existing file.
    charter_bytes = charter_src.read_bytes()
    if charter_dst.exists():
        existing = charter_dst.read_bytes()
        if existing != charter_bytes:
            print(f"Refusing to overwrite existing different charter: {charter_dst}")
            return 4
    else:
        charter_dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(charter_src, charter_dst)

    results = []
    for rel, addendum in ADDENDA.items():
        p = root / rel
        before = p.read_bytes()
        # Preserve exact original bytes, then append UTF-8 text.
        separator = b"" if before.endswith(b"\n\n") else (b"\n" if before.endswith(b"\n") else b"\n\n")
        addition = addendum.strip("\n").encode("utf-8") + b"\n"
        after = before + separator + addition
        p.write_bytes(after)
        reread = p.read_bytes()
        prefix_ok = reread[: len(before)] == before
        marker_count = reread.count(MARK.encode("utf-8"))
        results.append({
            "path": rel,
            "original_size": len(before),
            "new_size": len(reread),
            "original_sha256": sha256(before),
            "new_sha256": sha256(reread),
            "original_prefix_preserved": prefix_ok,
            "marker_count": marker_count,
        })
        if not prefix_ok or marker_count != 1:
            raise RuntimeError(f"Append-only verification failed: {rel}")

    report = {
        "mode": "APPLY",
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "root": str(root),
        "charter": {
            "path": str(NEW_CHARTER_REPO_PATH),
            "sha256": sha256(charter_dst.read_bytes()),
        },
        "updated_documents": results,
        "updated_count": len(results),
        "all_original_prefixes_preserved": all(x["original_prefix_preserved"] for x in results),
        "historical_documents_modified": False,
    }
    report_path = root / args.report
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
