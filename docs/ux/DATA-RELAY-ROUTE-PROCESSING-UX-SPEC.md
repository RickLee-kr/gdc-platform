# DATA RELAY ROUTE PROCESSING UX SPEC

**Document:** `DATA-RELAY-ROUTE-PROCESSING-UX-SPEC.md`  
**Version:** 1.0  
**Status:** Draft — UX authority for Route Processing (Wizard, Stream Edit, Route Edit, Governance Workspace)  
**Date:** 2026-06-19  
**Related:** `specs/091-route-processing-architecture/spec.md`, `specs/092-per-route-transform/spec.md`, `specs/093-per-route-protection/spec.md`, `specs/094-per-route-classification/spec.md`, `specs/095-per-route-policy/spec.md`, `specs/096-route-runtime-delivery/spec.md`

---

## Purpose

이 문서는 Route Processing UX의 최종 설계 기준 문서이다.

기존 Charter에 정의된

```text
Route
=
Destination Specific Processing Unit
```

개념을 실제 UI로 구현하기 위한 문서이다.

본 문서는

* Wizard
* Stream Edit
* Route Edit
* Governance Workspace

모든 Route Processing UI의 기준이 된다.

---

# 1. Design Goal

현재 사용자는

```text
데이터를 가져온다
↓
변환한다
↓
보호한다
↓
전송한다
```

라고 생각한다.

하지만 실제 운영 환경에서는

같은 데이터를

```text
SIEM
XDR
Data Lake
Archive
```

등 여러 목적지로 동시에 보낸다.

각 목적지는

필요한 데이터가 다르다.

따라서 Route는

단순 Delivery 설정이 아니다.

---

Route는

```text
Destination Specific Processing Unit
```

이다.

즉

각 Route는

독립적인 Processing Chain을 가진다.

---

# 2. Mental Model

사용자가 이해해야 하는 모델

```text
Source
 ↓
Stream
 ↓
Global Processing
 ↓
Routes
```

---

예시

```text
Office365 Stream
```

↓

```text
Global Processing

Normalize Vendor
Normalize Product
Normalize Timestamp
```

↓

```text
Route A
(MSS Syslog)
```

↓

```text
Transform
Protection
Classification
Policy
Delivery
```

---

```text
Route B
(Stellar Cyber)
```

↓

```text
Transform
Protection
Classification
Policy
Delivery
```

---

```text
Route C
(Data Lake)
```

↓

```text
Transform
Protection
Classification
Policy
Delivery
```

---

# 3. Processing Model

각 Route는

아래 단계로 구성된다.

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

---

Route는

Global 설정을 상속한다.

필요 시 Override 한다.

---

# 4. Inheritance Model

모든 Route 설정은

기본적으로

```text
Inherit Global
```

이다.

---

예시

```text
Transform

☑ Inherit Global
```

---

의미

```text
Global Transform 사용
```

---

체크 해제

```text
Transform

☐ Inherit Global
```

↓

Route 전용 Transform 활성화

---

동일 규칙 적용

```text
Transform
Protection
Classification
Policy
```

---

# 5. Route Processing Layout

Wizard

Step 4

Route Processing

---

상단

```text
Global Processing
```

---

하단

```text
Routes
```

---

레이아웃

```text
+---------------------------------------------------+
| Global Processing                                 |
+---------------------------------------------------+

+---------------------------------------------------+
| Routes                                             |
|---------------------------------------------------|
| MSS Syslog                                         |
| Stellar Cyber                                      |
| Data Lake                                          |
+---------------------------------------------------+

+---------------------------------------------------+
| Route Details                                      |
+---------------------------------------------------+
```

---

# 6. Global Processing Section

Global Processing은

모든 Route의 기본값이다.

---

구성

```text
Transform
Protection
Classification
Policy
```

---

여기서 설정한 값은

모든 Route에 자동 적용된다.

---

# 7. Route List

Route 카드 표시

```text
MSS Syslog

Destination
Enabled

Processing Status
```

---

상태

```text
Inherited
Overridden
Mixed
```

---

예시

```text
Transform      Inherited
Protection     Overridden
Classification Inherited
Policy         Mixed
```

---

# 8. Route Detail Panel

Route 선택 시 표시

---

구성

```text
Transform
Protection
Classification
Policy
Delivery
```

---

각 섹션

```text
☑ Inherit Global
```

또는

```text
☐ Inherit Global
```

---

# 9. Transform Section

기존 Mapping UI 재사용

```text
Field Mapping

Transform Rules

Preview
```

---

Inherit Global

ON

↓

읽기 전용

---

OFF

↓

수정 가능

---

# 10. Protection Section

기존 Data Protection UI 재사용

---

구성

```text
Schema Drift Policy

Protection Rules
```

---

Inherit Global

ON

↓

읽기 전용

---

OFF

↓

Route 전용 정책

---

# 11. Classification Section

구성

```text
Classification Rules

Default Classification

Classification Floor
```

---

동작

Global 상속

또는

Route Override

---

# 12. Policy Section

구성

```text
Policy Rules

Delivery Behavior
```

---

지원

```text
Continue

Review

Quarantine

Block
```

---

Global 상속 가능

---

# 13. Delivery Section

Route 고유 설정

상속 없음

---

구성

```text
Destination

Failure Policy

Rate Limit

Burst Limit

Enable / Disable
```

---

항상 Route 전용

---

# 14. Unknown Field Handling

Global 기본 정책

```text
Unknown Field

Pass Through
```

---

Route Override 가능

---

예시

Route A

```text
Pass Through
```

---

Route B

```text
Drop
```

---

Route C

```text
Require Review
```

---

# 15. Protection Rule Actions

지원

```text
Audit

Mask Partial

Mask Full

Tokenize

Hash

Drop
```

---

Drop 의미

```text
필드 제거
```

---

예시

```json
{
  "email": "test@test.com",
  "user": "admin"
}
```

↓

```json
{
  "user": "admin"
}
```

---

# 16. Delivery Behaviors

지원

```text
Continue
Review
Quarantine
Block
```

---

Block 의미

```text
이벤트 전체 전송 중단
```

---

예시

```json
{
  "email":"a@a.com"
}
```

↓

전송 안함

---

Drop 과 차이

```text
Drop
=
필드 제거

Block
=
이벤트 제거
```

---

# 17. Design Principle

기본 목표

```text
90%

Global Processing 사용
```

---

예외

```text
10%

특정 Route만 Override
```

---

따라서 UX는

```text
Global First

Route Override Second
```

모델을 따른다.

---

# 18. Definition Of Done

Route Processing 구현 완료 기준

* Global Processing 존재
* Route List 존재
* Route Detail Panel 존재
* Inherit / Override 지원
* Transform Override 지원
* Protection Override 지원
* Classification Override 지원
* Policy Override 지원
* Delivery 설정 지원
* Unknown Field Override 지원
* Drop 지원
* Effective Preview 지원
* Wizard 지원
* Stream Edit 지원
* Route Edit 지원
* Governance Workspace 지원

위 조건을 모두 충족해야

Route Processing 구현 완료로 간주한다.
