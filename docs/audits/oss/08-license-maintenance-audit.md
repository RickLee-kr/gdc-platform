# 08 — OSS License, Maintenance, and Supply-Chain Audit

> **Closure (2026-08-29):** Scheduled OSS Fit implementation is complete. License grades in this file still apply (Base UI MIT; Kumo/Radix/vaul REJECT; Airbyte/AGPL taps/Connect DO_NOT_USE). See [DATA-RELAY-OSS-IMPLEMENTATION-WORKPLAN.md](./DATA-RELAY-OSS-IMPLEMENTATION-WORKPLAN.md).

**Product:** Data Relay (GDC Platform)
**Audit date:** 2026-08-28
**Correct-branch reconcile:** 2026-08-29 — license grades **not re-cloned**. SPDX conclusions below still apply to remaining work (Base UI MIT SAFE_DIRECT; Kumo MIT but product REJECT; Airbyte ELv2 / singer-io AGPL / Connect DO_NOT_USE). Implementation-status of Data Relay modules is owned by `01`–`07` / `09` against HEAD `99dd3ba`, not this file.
**Auditor:** Agent 8 (license / maintenance / supply chain)
**Scope branch (requested):** `feature/post-m29-development`
**Evidence cutoff:** GitHub API + shallow clones under `/tmp/oss-audit-clones/` as of 2026-08-28

This audit evaluates candidate open-source projects that other Data Relay OSS-audit tracks may recommend for UI, ops UI, schema tooling, connectors, validation, PII, or runtime reference. It does **not** change Data Relay source.

**Hard rule used throughout:** root `LICENSE` / README claims are not treated as sufficient when file-level headers, package `license` fields, `NOTICE` / `COPYING`, or sibling license texts disagree.

---

## 1. Grade rubric

| Grade | Meaning for Data Relay |
| --- | --- |
| **SAFE_DIRECT** | OSI-approved permissive license (typically MIT / BSD / Apache-2.0 without extra product restrictions). Commercial use and redistribution are straightforward. Maintenance and security posture are acceptable for a direct dependency. |
| **SAFE_WITH_NOTICE** | Same as SAFE_DIRECT for commercial use, but redistribution requires Apache NOTICE, dual-license choice, third-party notices, copy-into-tree attribution, or similar compliance work. |
| **REVIEW_REQUIRED** | License is usable in principle, but file-level mix, weak copyleft, bus factor, stale releases, or vendor strategy needs legal + engineering review before embedding. |
| **REFERENCE_ONLY** | Use as architecture / protocol / UX reference. Do not vendor, fork, or ship as a Data Relay runtime or connector. |
| **DO_NOT_USE** | License is incompatible with Data Relay as a commercial data-movement / streaming product, or copyleft / source-available terms create unacceptable source-disclosure or SaaS-restriction risk. |

Data Relay is a commercial data-integration and streaming product. That fact is decisive for Airbyte (ELv2 hosted-service ban), Redpanda Connect (RCL / BSL streaming-service restrictions), and Singer-io AGPL taps (network copyleft).

---

## 2. Executive grades

| Area | Project | SPDX (effective) | Grade |
| --- | --- | --- | --- |
| UI | [mui/base-ui](https://github.com/mui/base-ui) | MIT | **SAFE_DIRECT** |
| UI | [cloudflare/kumo](https://github.com/cloudflare/kumo) | MIT | **SAFE_DIRECT** |
| UI | [shadcn-ui/ui](https://github.com/shadcn-ui/ui) | MIT | **SAFE_WITH_NOTICE** |
| Ops UI | [xyflow/xyflow](https://github.com/xyflow/xyflow) | MIT | **SAFE_DIRECT** |
| Ops UI | [dagrejs/dagre](https://github.com/dagrejs/dagre) | MIT | **REVIEW_REQUIRED** |
| Ops UI | [tt-a1i/archify](https://github.com/tt-a1i/archify) | MIT | **REVIEW_REQUIRED** |
| Ops UI | [TanStack/table](https://github.com/TanStack/table) | MIT | **SAFE_DIRECT** |
| Ops UI | [TanStack/virtual](https://github.com/TanStack/virtual) | MIT | **SAFE_DIRECT** |
| Schema | [react-component/tree](https://github.com/react-component/tree) | MIT | **SAFE_WITH_NOTICE** |
| Schema | [microsoft/monaco-editor](https://github.com/microsoft/monaco-editor) | MIT | **SAFE_WITH_NOTICE** |
| Schema | [wolverdude/genson](https://github.com/wolverdude/genson) | MIT | **REVIEW_REQUIRED** |
| Schema | [jsonata-js/jsonata](https://github.com/jsonata-js/jsonata) | MIT | **SAFE_DIRECT** |
| Connectors | [meltano/sdk](https://github.com/meltano/sdk) | Apache-2.0 | **SAFE_WITH_NOTICE** |
| Connectors | Singer spec (`singer-io/getting-started`) | **No license file** | **REFERENCE_ONLY** |
| Connectors | [singer-io/singer-python](https://github.com/singer-io/singer-python) | Apache-2.0 | **SAFE_WITH_NOTICE** |
| Connectors | Official `singer-io/tap-*` connectors | **AGPL-3.0-only** | **DO_NOT_USE** |
| Connectors | [influxdata/telegraf](https://github.com/influxdata/telegraf) | MIT | **SAFE_DIRECT** |
| Connectors | [open-telemetry/opentelemetry-collector-contrib](https://github.com/open-telemetry/opentelemetry-collector-contrib) | Apache-2.0 | **SAFE_WITH_NOTICE** |
| Connectors | [fluent/fluent-bit](https://github.com/fluent/fluent-bit) | Apache-2.0 | **SAFE_WITH_NOTICE** |
| Connectors | [dlt-hub/dlt](https://github.com/dlt-hub/dlt) | Apache-2.0 | **SAFE_WITH_NOTICE** |
| Connectors | [apache/camel](https://github.com/apache/camel) | Apache-2.0 | **SAFE_WITH_NOTICE** |
| Validation | [python-openapi/openapi-spec-validator](https://github.com/python-openapi/openapi-spec-validator) | Apache-2.0 | **SAFE_WITH_NOTICE** |
| Validation | [python-jsonschema/jsonschema](https://github.com/python-jsonschema/jsonschema) | MIT | **SAFE_DIRECT** |
| Validation | [Yelp/detect-secrets](https://github.com/Yelp/detect-secrets) | Apache-2.0 | **REVIEW_REQUIRED** |
| Validation | [pyca/cryptography](https://github.com/pyca/cryptography) | Apache-2.0 OR BSD-3-Clause | **SAFE_WITH_NOTICE** |
| PII | [microsoft/presidio](https://github.com/microsoft/presidio) | MIT | **SAFE_WITH_NOTICE** |
| Runtime | [open-telemetry/opentelemetry-collector](https://github.com/open-telemetry/opentelemetry-collector) | Apache-2.0 | **SAFE_WITH_NOTICE** |
| Runtime | [vectordotdev/vector](https://github.com/vectordotdev/vector) | **MPL-2.0** | **REVIEW_REQUIRED** |
| Runtime | [redpanda-data/connect](https://github.com/redpanda-data/connect) | **Apache-2.0 + LicenseRef-RCL** (and BSL language in RCL text) | **DO_NOT_USE** |
| Runtime | [redpanda-data/benthos](https://github.com/redpanda-data/benthos) | MIT | **REVIEW_REQUIRED** |
| Flagged | [airbytehq/airbyte](https://github.com/airbytehq/airbyte) | **Elastic-2.0** (connectors mostly ELv2; protocol MIT) | **DO_NOT_USE** |

### 2.1 Non-simple licenses (must not be treated as “just MIT/Apache”)

| Project | Why it is not simple |
| --- | --- |
| **Airbyte** | Root `LICENSE` is Elastic License 2.0 (not OSI). `LICENSE_SHORT` says “all rights reserved.” Connector `metadata.yaml` is mostly `license: ELv2`, with a minority `MIT`. Protocol is MIT. Hosted/managed-service use is prohibited. GitHub SPDX is `NOASSERTION`. |
| **Vector** | Root and `Cargo.toml` are **MPL-2.0** (weak file-level copyleft). `NOTICE` plus `LICENSE-3rdparty.csv` (~105 KB) impose redistribution notices. Modified MPL files must be disclosed if distributed. |
| **Redpanda Connect** | **No root LICENSE.** `licenses/README.md` splits **Apache-2.0** (majority) vs **Redpanda Community License (RCL)** (enterprise). Sampled Go headers: **735 Apache / 470 RCL / 13 neither**. RCL text also points Community Edition at **BUSL-1.1**. Enterprise connectors require a paid key. GitHub license field is empty. |
| **Singer-io taps** | Meltano SDK and `singer-python` are Apache-2.0, but official Stitch/Qlik taps (`tap-github`, `tap-salesforce`, `tap-mysql`, `tap-stripe`, …) are **AGPL-3.0**. Do not infer tap license from the SDK. |

---

## 3. Method and evidence

- Reused existing clones in `/tmp/oss-audit-clones/` and shallow-cloned missing repos (`--depth 80`).
- Inspected `LICENSE*`, `COPYING*`, `NOTICE*`, `licenses/`, `SECURITY.md`, `package.json` / `pyproject.toml` / `Cargo.toml` license fields, and sampled SPDX / copyright headers.
- GitHub API (authenticated, 2026-08-28): stars, issues, releases, license metadata, recent commits.
- Shallow-clone `git log` is **not** used as a commit-volume source of truth (several clones were depth-1). Activity numbers below come from GitHub unless noted.

This is not legal advice. Counsel should review any DO_NOT_USE / REVIEW_REQUIRED decision before product embedding.

---

## 4. Cross-cutting findings

1. **Data Relay vs source-available “anti-SaaS” licenses.** ELv2 (Airbyte) and RCL/BSL (Redpanda Connect / Redpanda generally) restrict offering the software as a hosted data-movement or streaming service. That is Data Relay’s product category. Embedding those codebases, wrapping their UI/API, or shipping their connector runtime as “Data Relay connectors” is a license conflict, not a paperwork exercise.
2. **AGPL is in the Singer *connector* layer, not the SDK.** Using Meltano SDK to write original taps is Apache-2.0. Shipping or network-serving official `singer-io/tap-*` code is AGPL-3.0.
3. **Apache-2.0 is not “no notice.”** Camel, OTel, Fluent Bit, dlt, Meltano SDK, detect-secrets, and openapi-spec-validator require license + NOTICE retention on redistribution.
4. **Copy-into-tree UI (shadcn) is a supply-chain, not just a license, event.** MIT allows it; every copied file still needs copyright notice retention and ongoing vuln tracking because it is no longer a versioned npm dependency.
5. **Vendored C/Go runtimes (Fluent Bit, librdkafka, Vector crates) dominate third-party notice burden**, not the root SPDX string.

---

## 5. UI candidates

### 5.1 mui/base-ui — **SAFE_DIRECT**

| Field | Finding |
| --- | --- |
| **License (SPDX)** | MIT. Root `LICENSE`; GitHub `MIT`. Copyright © 2019 Material-UI SAS. |
| **Source file / package differences** | Monorepo `package.json` is private (`@base-ui/monorepo`). Published packages follow the same MIT root license. No conflicting SPDX sample. MUI also sells commercial Material UI / Base UI support; that is **not** a license restriction on this repo. |
| **Commercial usage** | Permitted (MIT). |
| **Redistribution** | Keep copyright + permission notice. |
| **Copyleft** | None. |
| **Source disclosure risk** | None from license. |
| **NOTICE requirement** | No project NOTICE. MIT notice only. |
| **Package distribution risk** | Low. Standard npm packages (`@base-ui/react`). |
| **Release frequency** | High. `v1.7.0` (2026-08-04), `v1.6.0` (2026-06-18), monthly-ish 1.x. |
| **Recent commits** | Active 2026-08-28 (component work by MUI maintainers). |
| **Issue activity** | 424 open; health 100. |
| **Maintainer activity** | MUI / ex-Radix maintainers; multiple authors in recent PRs. |
| **Bus factor** | Low risk (company-backed). |
| **Security policy** | `SECURITY.md`: 1.x supported; report `security@mui.com`. Pre-1.0 unsupported. |
| **Dependency risk** | Normal React/TS ecosystem. Prefer locking `@base-ui/react` and not the docs/playground packages. |
| **Project maturity** | Created 2024-02; 10.7k stars. Production 1.x in 2025–2026. |
| **Grade** | **SAFE_DIRECT** |

### 5.2 cloudflare/kumo — **SAFE_DIRECT**

| Field | Finding |
| --- | --- |
| **License (SPDX)** | MIT. Root `LICENSE` (Cloudflare, Inc. 2026). |
| **Source file / package differences** | `@cloudflare/kumo` `package.json` `"license": "MIT"`; `kumo-screenshot-worker` and `kumo-figma` also MIT. Docs package `kumo-docs-astro` is private and omits a license field — **do not publish that package**; root MIT still covers the repo. |
| **Commercial usage** | Permitted. |
| **Redistribution** | MIT notice. |
| **Copyleft** | None. |
| **Source disclosure risk** | None. |
| **NOTICE requirement** | None. |
| **Package distribution risk** | Engines pin **Node `^24.12.0`** and **pnpm ≥ 10.26**. That is an operational constraint, not a license issue. |
| **Release frequency** | Very high (`@cloudflare/kumo@2.12.0` 2026-08-20; multiple 2.x in August 2026). |
| **Recent commits** | Daily (Cloudflare staff). |
| **Issue activity** | 49 open; 3.7k stars. |
| **Maintainer activity** | Cloudflare-backed; recent commits concentrated on a small staff set. |
| **Bus factor** | Medium-low (corporate, but young repo). |
| **Security policy** | No `SECURITY.md`. Community profile: CoC + contributing, no security file. Use Cloudflare’s corporate disclosure channel if adopted. |
| **Dependency risk** | Heavy workspace (pnpm catalogs, Figma/screenshot workers). Adopt **only** `@cloudflare/kumo`. |
| **Project maturity** | Created **2025-10-30**. Fast-moving; treat as young for API stability. |
| **Grade** | **SAFE_DIRECT** (license). Track API stability separately. |

### 5.3 shadcn-ui/ui — **SAFE_WITH_NOTICE**

| Field | Finding |
| --- | --- |
| **License (SPDX)** | MIT. `LICENSE.md`; GitHub MIT. Copyright © 2023 shadcn. `package.json` license MIT. |
| **Source file / package differences** | This is a **code registry**, not a conventional component library. The `shadcn` CLI copies components into the consumer repo. Registry entries (e.g. third-party `@onchain-ui`) may carry **their own** licenses — do not assume every registry item is MIT. |
| **Commercial usage** | Permitted for MIT registry items. |
| **Redistribution** | Retain MIT notice on copied files. If Data Relay vendors copied components, those files become first-party for SBOM and CVE tracking. |
| **Copyleft** | None for the core registry (MIT). |
| **Source disclosure risk** | None from MIT. Copied code is already in your tree. |
| **NOTICE requirement** | MIT attribution; no Apache NOTICE. |
| **Package distribution risk** | Medium: copied source + optional paid shadcn registry/hosting is a product, not a license wall. 2.2k open issues. |
| **Release frequency** | High (`shadcn@4.19.0` 2026-08-21). |
| **Recent commits** | Active (shadcn + community). |
| **Issue activity** | Very high (2251 open). |
| **Maintainer activity** | Strong; founder-led plus large community. |
| **Bus factor** | Medium (founder concentration) but huge community. |
| **Security policy** | `SECURITY.md`: GitHub private vulnerability reporting. |
| **Dependency risk** | Tailwind / Radix-style primitives in copied files; supply chain is **your** repo after `shadcn add`. |
| **Project maturity** | Created 2023-01; 122k stars. Mature distribution model. |
| **Grade** | **SAFE_WITH_NOTICE** |

---

## 6. Ops UI candidates

### 6.1 xyflow/xyflow (React Flow / Svelte Flow) — **SAFE_DIRECT**

| Field | Finding |
| --- | --- |
| **License (SPDX)** | MIT. Root `LICENSE`; packages `@xyflow/react`, `@xyflow/svelte`, `@xyflow/system` all `"license": "MIT"`. Copyright © 2019–2025 webkid GmbH. |
| **Source file / package differences** | Playwright test helper `package.json` is ISC (dev-only). Example apps omit license fields (not published). **React Flow Pro is paid support / examples, not a second license on `@xyflow/react`.** README asks commercial users to sponsor; that is not a license condition. |
| **Commercial usage** | Permitted. Pro subscription is optional. |
| **Redistribution** | MIT notice. |
| **Copyleft** | None. |
| **Source disclosure risk** | None. |
| **NOTICE requirement** | None. |
| **Package distribution risk** | Low for `@xyflow/react`. |
| **Release frequency** | High (`@xyflow/react@12.11.5` 2026-08-25). |
| **Recent commits** | Active (webkid). |
| **Issue activity** | 129 open; 38k stars. |
| **Maintainer activity** | Company-backed (webkid GmbH). |
| **Bus factor** | Medium-low (small company, healthy releases). |
| **Security policy** | `SECURITY.md`: private GitHub advisory; 1-week ack / 4-week plan targets. |
| **Dependency risk** | Layout often paired with dagre/elk — license those separately (see dagre). |
| **Project maturity** | Created 2019; industry-standard node graph UI. |
| **Grade** | **SAFE_DIRECT** |

### 6.2 dagrejs/dagre — **REVIEW_REQUIRED**

| Field | Finding |
| --- | --- |
| **License (SPDX)** | MIT. `LICENSE` and `package.json` `"license": "MIT"`. |
| **Source file / package differences** | Copyright line is still **“Copyright (c) 2012-2014 Chris Pettitt”** despite 2025–2026 maintenance. SPDX is MIT; copyright year is stale — retain original notice plus any new copyright if you vendor. |
| **Commercial usage** | Permitted. |
| **Redistribution** | MIT notice (original Pettitt copyright). |
| **Copyleft** | None. |
| **Source disclosure risk** | None. |
| **NOTICE requirement** | None. |
| **Package distribution risk** | npm `dagre` historically fragmented (old vs `dagrejs` org). Pin the GitHub-aligned package. |
| **Release frequency** | Uneven. `v2.0.0` 2025-11-23 after years of quiet; `v1.0.4` 2023-11; 0.7.x from 2015. |
| **Recent commits** | Some 2026-08 activity (David Newell). |
| **Issue activity** | 174 open; community health **37**. No CONTRIBUTING, no SECURITY.md. |
| **Maintainer activity** | Thin. |
| **Bus factor** | High risk (few maintainers). |
| **Security policy** | None in-repo. |
| **Dependency risk** | Graph layout algorithms; low npm fan-in but abandoned-fork history. |
| **Project maturity** | Old and proven algorithmically; maintenance is the issue. |
| **Grade** | **REVIEW_REQUIRED** (license OK; stewardship weak). Prefer ELK or a well-pinned dagrejs release if layout is required. |

### 6.3 tt-a1i/archify — **REVIEW_REQUIRED**

| Field | Finding |
| --- | --- |
| **License (SPDX)** | MIT. Dual copyright: **2026 tt-a1i (Archify)** and **2025 Cocoon AI** (original “architecture-diagram-generator”). |
| **Source file / package differences** | Derived-work copyright must be preserved. Viral 2026 project; confirm no remaining Cocoon-only assets with a different license if vendoring HTML/CSS. |
| **Commercial usage** | Permitted under MIT. |
| **Redistribution** | Both copyright lines. |
| **Copyleft** | None. |
| **Source disclosure risk** | None. |
| **NOTICE requirement** | Dual copyright notice. |
| **Package distribution risk** | This is an **agent skill / HTML generator**, not a React library. Shipping it inside Data Relay UI is a product-fit question. |
| **Release frequency** | High for a new project (`v2.15.0` 2026-08-17). |
| **Recent commits** | Active, almost entirely `tt-a1i`. |
| **Issue activity** | 54 open; 25.9k stars (viral). Recent security-related issue traffic (ReDoS mention). |
| **Maintainer activity** | Single-primary-author. |
| **Bus factor** | **Very high risk (1).** |
| **Security policy** | No SECURITY.md. |
| **Dependency risk** | Client-side HTML/JS; XSS and supply-chain of generated diagrams matter more than npm CVEs. |
| **Project maturity** | Created **2026-04-15**. Too new for a platform dependency. |
| **Grade** | **REVIEW_REQUIRED** — MIT is clean; do not treat as a mature platform library. |

### 6.4 TanStack/table — **SAFE_DIRECT**

| Field | Finding |
| --- | --- |
| **License (SPDX)** | MIT. Copyright © 2016 Tanner Linsley. |
| **Source file / package differences** | Framework adapters (`@tanstack/react-table`, vue, solid, svelte, …) share MIT. Use the React adapter only. |
| **Commercial usage** | Permitted. |
| **Redistribution** | MIT notice. |
| **Copyleft** | None. |
| **Source disclosure risk** | None. |
| **NOTICE requirement** | None. |
| **Package distribution risk** | Low. Headless — you own rendering. |
| **Release frequency** | High (`@tanstack/react-table@9.2.3` 2026-08-26). |
| **Recent commits** | Active. |
| **Issue activity** | 59 open; 28k stars. |
| **Maintainer activity** | TanStack org; healthy. |
| **Bus factor** | Medium (founder-led org, strong community). |
| **Security policy** | No dedicated SECURITY.md in clone; community contributing + CoC present. |
| **Dependency risk** | Low (headless). |
| **Project maturity** | Created 2016; successor to React Table. Mature. |
| **Grade** | **SAFE_DIRECT** |

### 6.5 TanStack/virtual — **SAFE_DIRECT**

| Field | Finding |
| --- | --- |
| **License (SPDX)** | MIT. Copyright © 2021-present Tanner Linsley. |
| **Source file / package differences** | `@tanstack/react-virtual` and `@tanstack/virtual-core` MIT. Align versions with table if both are used. |
| **Commercial usage** | Permitted. |
| **Redistribution** | MIT notice. |
| **Copyleft** | None. |
| **Source disclosure risk** | None. |
| **NOTICE requirement** | None. |
| **Package distribution risk** | Low. |
| **Release frequency** | High (`@tanstack/react-virtual@3.14.10` 2026-08-18). |
| **Recent commits** | Active. |
| **Issue activity** | 114 open; 7.1k stars. |
| **Maintainer activity** | TanStack org. |
| **Bus factor** | Medium. |
| **Security policy** | Contributing present; no SECURITY.md in clone. |
| **Dependency risk** | Low. |
| **Project maturity** | Created 2020; widely used. |
| **Grade** | **SAFE_DIRECT** |

---

## 7. Schema / mapping candidates

### 7.1 react-component/tree (`rc-tree`) — **SAFE_WITH_NOTICE**

| Field | Finding |
| --- | --- |
| **License (SPDX)** | MIT. |
| **Source file / package differences** | **Two MIT files with different copyright holders:** `LICENSE` © 2019-present **react-component**; `LICENSE.md` © 2015-present **Alipay.com**. `package.json` `"license": "MIT"`. Redistribution should retain **both** copyright notices. |
| **Commercial usage** | Permitted. |
| **Redistribution** | Dual copyright MIT notices. |
| **Copyleft** | None. |
| **Source disclosure risk** | None. |
| **NOTICE requirement** | Copyright retention (both files). |
| **Package distribution risk** | Ant Design ecosystem coupling (`rc-tree` is a primitive for Ant Design Tree). |
| **Release frequency** | Ongoing (commit 2026-08-28). |
| **Recent commits** | Active in Ant Design / react-component org. |
| **Issue activity** | 164 open; 1.3k stars. |
| **Maintainer activity** | Ant Design org. |
| **Bus factor** | Low-medium (large org). |
| **Security policy** | None in clone. |
| **Dependency risk** | React 16–19 peer ranges typical of rc-* ; verify against Data Relay React version. |
| **Project maturity** | Created 2015. Mature. |
| **Grade** | **SAFE_WITH_NOTICE** |

### 7.2 microsoft/monaco-editor — **SAFE_WITH_NOTICE**

| Field | Finding |
| --- | --- |
| **License (SPDX)** | MIT. `LICENSE.txt` © 2016–present Microsoft. `webpack-plugin/LICENSE` also MIT (Microsoft). |
| **Source file / package differences** | **`ThirdPartyNotices.txt` is mandatory for redistribution.** Bundled TypeScript and other components include **Apache-2.0** (e.g. TypeScript 4.4.4 excerpt in ThirdPartyNotices). Do not ship Monaco without that notices file. Monaco is a stripped VS Code editor; VS Code’s product license is **not** this repo’s license — this repo is MIT + third-party notices. |
| **Commercial usage** | Permitted. |
| **Redistribution** | MIT + ThirdPartyNotices (+ Apache notices for bundled TS). |
| **Copyleft** | None on Monaco itself. |
| **Source disclosure risk** | None. |
| **NOTICE requirement** | **Yes** — `ThirdPartyNotices.txt`. |
| **Package distribution risk** | Large browser bundle; CDN vs npm. Medium operational risk, low license risk if notices are kept. |
| **Release frequency** | Moderate (`v0.56.0` 2026-07-20). |
| **Recent commits** | Active (often dependabot on samples). |
| **Issue activity** | 848 open; 46.6k stars. |
| **Maintainer activity** | Microsoft. |
| **Bus factor** | Low risk. |
| **Security policy** | Microsoft standard disclosure (repo uses GH security features). |
| **Dependency risk** | Heavy; pin monaco version; watch bundled TS/security advisories. |
| **Project maturity** | Created 2016. Mature. |
| **Grade** | **SAFE_WITH_NOTICE** |

### 7.3 wolverdude/genson — **REVIEW_REQUIRED**

| Field | Finding |
| --- | --- |
| **License (SPDX)** | MIT. `LICENSE` © 2014 Jon Wolverton. |
| **Source file / package differences** | Root LICENSE matches. Small Python package; no NOTICE. |
| **Commercial usage** | Permitted. |
| **Redistribution** | MIT notice. |
| **Copyleft** | None. |
| **Source disclosure risk** | None. |
| **NOTICE requirement** | None. |
| **Package distribution risk** | PyPI `genson`; confirm you are not pulling a different “genson” Java library (different project). |
| **Release frequency** | Low. GitHub Releases empty; commit “Release 1.4.0” on 2026-07-06. |
| **Recent commits** | Burst in 2026-07 (author only). |
| **Issue activity** | 18 open; 728 stars. |
| **Maintainer activity** | Single author. |
| **Bus factor** | **High (1).** |
| **Security policy** | None. |
| **Dependency risk** | JSON Schema inference — validate output; do not treat generated schemas as security boundaries. |
| **Project maturity** | Created 2014; long-lived but hobby-scale. |
| **Grade** | **REVIEW_REQUIRED** (license fine; stewardship). |

### 7.4 jsonata-js/jsonata — **SAFE_DIRECT**

| Field | Finding |
| --- | --- |
| **License (SPDX)** | MIT. `package.json` `"license": "MIT"`. |
| **Source file / package differences** | Root `LICENSE` is MIT text **without a copyright holder line**. npm package is MIT. Historical IBM / Andrew Coleman authorship should still be attributed in NOTICE if legal asks for a holder; SPDX remains MIT. |
| **Commercial usage** | Permitted. |
| **Redistribution** | MIT notice (add copyright holder if known from npm/authors). |
| **Copyleft** | None. |
| **Source disclosure risk** | None. |
| **NOTICE requirement** | None required; attribution recommended. |
| **Package distribution risk** | Low. JS implementation; JSONata has ports in other languages — license those ports separately. |
| **Release frequency** | Healthy (`v2.2.2` 2026-07-16; `v1.8.9` 2026-07-30 still maintained). |
| **Recent commits** | Andrew Coleman 2026-07. |
| **Issue activity** | 174 open; 2.7k stars. |
| **Maintainer activity** | Long-term single primary maintainer with IBM heritage. |
| **Bus factor** | Medium. |
| **Security policy** | None in clone. Expression engines can be ReDoS / resource-exhaustion vectors — sandbox if user-supplied expressions. |
| **Dependency risk** | Low npm deps for runtime; `request` still in **devDependencies** (maintenance smell only). |
| **Project maturity** | Created 2016. Mature query language. |
| **Grade** | **SAFE_DIRECT** |

---

## 8. Connector candidates

### 8.1 meltano/sdk (Singer SDK) — **SAFE_WITH_NOTICE**

| Field | Finding |
| --- | --- |
| **License (SPDX)** | Apache-2.0. `LICENSE`; `pyproject.toml` `license = "Apache-2.0"`. |
| **Source file / package differences** | SDK is Apache-2.0. **This does not license Singer taps.** Community taps may be MIT, Apache-2.0, or AGPL. |
| **Commercial usage** | Permitted. |
| **Redistribution** | Apache-2.0 license text + attribution. No NOTICE file in clone; still keep LICENSE. |
| **Copyleft** | None (Apache). |
| **Source disclosure risk** | None. |
| **NOTICE requirement** | Standard Apache attribution; no NOTICE file present. |
| **Package distribution risk** | PyPI `singer-sdk`. |
| **Release frequency** | High (`v0.54.5` 2026-06-16; 0.55.0 alphas tagged). |
| **Recent commits** | Very active (Edgar Ramírez Mondragón dominant). |
| **Issue activity** | 160 open; only 118 stars (small but serious project). |
| **Maintainer activity** | Meltano core. |
| **Bus factor** | Medium (one dominant committer + bots). |
| **Security policy** | No SECURITY.md in clone. |
| **Dependency risk** | Python 3.10+; JSON Schema stack. |
| **Project maturity** | Created 2021. Production SDK. |
| **Grade** | **SAFE_WITH_NOTICE** |

### 8.2 Singer specification (`singer-io/getting-started`) — **REFERENCE_ONLY**

| Field | Finding |
| --- | --- |
| **License (SPDX)** | **None.** GitHub `license: null`. No `LICENSE` / `COPYING`. README copyright line “© 2018 Stitch.” |
| **Source file / package differences** | Spec markdown only. Cannot treat the spec repo as Apache/MIT. |
| **Commercial usage** | Implementing a compatible protocol is generally fine; **copying spec text** needs a license that is not present. |
| **Redistribution** | Do not vendor this repo. Cite singer.io and write original docs. |
| **Copyleft** | Unknown / unspecified. |
| **Source disclosure risk** | N/A (no code). |
| **NOTICE requirement** | N/A. |
| **Package distribution risk** | N/A. |
| **Release frequency** | None. Last push **2025-08-08**. |
| **Recent commits** | Sparse; Qlik/Stitch policy mentions in 2024–2025. |
| **Issue activity** | 29 open. |
| **Maintainer activity** | Low. Spec is effectively frozen under Stitch/Qlik. |
| **Bus factor** | High for spec evolution. |
| **Security policy** | None. |
| **Dependency risk** | N/A. |
| **Project maturity** | Spec is old and widely used; **repo is not a licensed deliverable**. |
| **Grade** | **REFERENCE_ONLY** |

### 8.3 singer-io/singer-python — **SAFE_WITH_NOTICE**

| Field | Finding |
| --- | --- |
| **License (SPDX)** | Apache-2.0. |
| **Source file / package differences** | Library for writing Singer messages. Apache-2.0 does **not** change AGPL on official taps that depend on it. |
| **Commercial usage** | Permitted for this library. |
| **Redistribution** | Apache-2.0. |
| **Copyleft** | None. |
| **Source disclosure risk** | None. |
| **NOTICE requirement** | Apache attribution. |
| **Package distribution risk** | PyPI `singer-python`; last tag `v6.8.0`; last commit 2026-02-27. |
| **Release frequency** | Moderate historically; slower in 2026. |
| **Recent commits** | Qlik/Stitch ticket prefixes (`SAC-30196`). |
| **Issue activity** | 37 open. |
| **Maintainer activity** | Corporate (Qlik/Stitch), not community-driven. |
| **Bus factor** | Medium (corporate, but Singer is legacy). |
| **Security policy** | None in clone. |
| **Dependency risk** | Pairing with AGPL taps is the real risk (see 8.4). |
| **Project maturity** | Created 2016. Stable/legacy. |
| **Grade** | **SAFE_WITH_NOTICE** for the helper library only. |

### 8.4 Official Singer taps (`singer-io/tap-*`) — **DO_NOT_USE**

Checked via GitHub license API (2026-08-28):

| Repo | SPDX | Last push |
| --- | --- | --- |
| `singer-io/tap-github` | **AGPL-3.0** | 2026-08-24 |
| `singer-io/tap-salesforce` | **AGPL-3.0** | 2026-08-25 |
| `singer-io/tap-mysql` | **AGPL-3.0** | 2024-10-30 |
| `singer-io/tap-stripe` | **AGPL-3.0** | 2026-08-20 |

| Field | Finding |
| --- | --- |
| **License (SPDX)** | AGPL-3.0-only (typical Stitch tap). |
| **Source file / package differences** | **Do not infer MIT/Apache from Meltano Hub listings or SDK docs.** File-level LICENSE in those tap repos is AGPL. |
| **Commercial usage** | AGPL allows commercial use **if** you comply with network copyleft (offer corresponding source to users who interact over a network). |
| **Redistribution** | Full AGPL corresponding-source obligations. |
| **Copyleft** | **Strong, network-triggering (AGPL §13).** Running a tap as part of Data Relay SaaS/on-prem control plane likely forces source disclosure of the tap **and** may infect combined works if not cleanly separated. |
| **Source disclosure risk** | **High.** |
| **NOTICE requirement** | AGPL notices + license. |
| **Package distribution risk** | High. |
| **Maintenance** | Some taps still updated; others stale (`tap-mysql` 2024). |
| **Grade** | **DO_NOT_USE** as Data Relay connectors. Write original Apache/MIT taps with Meltano SDK, or use non-AGPL community taps after per-repo license check. |

### 8.5 influxdata/telegraf — **SAFE_DIRECT**

| Field | Finding |
| --- | --- |
| **License (SPDX)** | MIT. `LICENSE` © 2015–2025 InfluxData Inc. |
| **Source file / package differences** | Plugin-heavy tree; root MIT. Individual plugins generally inherit MIT; still scan any vendored proto/client if you vendor source. |
| **Commercial usage** | Permitted. |
| **Redistribution** | MIT notice. |
| **Copyleft** | None. |
| **Source disclosure risk** | None. |
| **NOTICE requirement** | None. |
| **Package distribution risk** | Shipping the Telegraf **binary** is easy; shipping a custom plugin set is still MIT. |
| **Release frequency** | High (`v1.39.3` 2026-08-10). |
| **Recent commits** | Active (InfluxData). |
| **Issue activity** | 427 open; 17.8k stars. |
| **Maintainer activity** | Company-backed. |
| **Bus factor** | Low. |
| **Security policy** | `SECURITY.md` → `security@influxdata.com`. |
| **Dependency risk** | Go module graph is large (many plugins). Build with plugin allow-list to shrink CVE surface. |
| **Project maturity** | Created 2015. Mature agent. |
| **Grade** | **SAFE_DIRECT** |

### 8.6 open-telemetry/opentelemetry-collector-contrib — **SAFE_WITH_NOTICE**

| Field | Finding |
| --- | --- |
| **License (SPDX)** | Apache-2.0. File-level `SPDX-License-Identifier: Apache-2.0` is widespread (300+ hits in a shallow source scan of the core collector; contrib matches). |
| **Source file / package differences** | **`NOTICE` includes BSD-3-Clause gopsutil-origin code** and gRPC-derived snippets. Components are separately versioned; a receiver can pull extra licenses. Do not assume every contrib component is “just Apache” without checking that component’s `NOTICE` / imported code. |
| **Commercial usage** | Permitted. |
| **Redistribution** | Apache-2.0 + NOTICE + any component extra notices. |
| **Copyleft** | None (Apache). BSD attribution for listed snippets. |
| **Source disclosure risk** | None. |
| **NOTICE requirement** | **Yes.** |
| **Package distribution risk** | High operational complexity (component stability levels, distro builder). License is the easy part. |
| **Release frequency** | Biweekly-ish (`v0.159.0` 2026-08-17, aligned with core). |
| **Recent commits** | Very high. |
| **Issue activity** | 917 open; 4.9k stars. |
| **Maintainer activity** | CNCF; many companies. |
| **Bus factor** | Low. |
| **Security policy** | OpenTelemetry security process (CNCF). |
| **Dependency risk** | **High** — contrib is a union of vendor receivers. Build a **custom distro** with an allow-list; do not ship all-contrib. |
| **Project maturity** | Created 2019. Mature. |
| **Grade** | **SAFE_WITH_NOTICE** |

### 8.7 fluent/fluent-bit — **SAFE_WITH_NOTICE**

| Field | Finding |
| --- | --- |
| **License (SPDX)** | Apache-2.0 root `LICENSE`. |
| **Source file / package differences** | **Heavy vendoring under `lib/`.** Examples: zstd **BSD** (Meta); Onigmo **BSD-2**; simdutf **Apache-2.0 OR MIT**; librdkafka **multi-license pack** (`LICENSE.lz4`, `LICENSE.snappy`, `LICENSE.nanopb`, …); Monkey HTTP `NOTICE`. Root Apache-2.0 is **not** the whole story for binary redistribution. |
| **Commercial usage** | Permitted. |
| **Redistribution** | Apache-2.0 + all bundled third-party licenses/NOTICES. |
| **Copyleft** | None at Fluent Bit layer; confirm no GPL-only object is linked (zstd’s COPYING mentions GPL as an alternate — the used LICENSE is BSD). |
| **Source disclosure risk** | None if staying on Apache/BSD/MIT bundled libs. |
| **NOTICE requirement** | **Yes** (root + `lib/*/NOTICE`). |
| **Package distribution risk** | Medium-high (native binary, plugins, WASM runtime WAMR). |
| **Release frequency** | High (`v5.1.1` 2026-08-16). |
| **Recent commits** | Active. |
| **Issue activity** | 785 open; 8.1k stars. |
| **Maintainer activity** | Fluent org / Chronosphere lineage; multiple core authors. |
| **Bus factor** | Low-medium. |
| **Security policy** | Strong `SECURITY.md`: supported 5.1.x / 5.0.x; EOL table; `fluentbit-security@googlegroups.com`. |
| **Dependency risk** | High (C + many `lib/` copies). Prefer distro packages or official images with SBOM. |
| **Project maturity** | Created 2015. Mature. |
| **Grade** | **SAFE_WITH_NOTICE** |

### 8.8 dlt-hub/dlt — **SAFE_WITH_NOTICE**

| Field | Finding |
| --- | --- |
| **License (SPDX)** | Apache-2.0. `LICENSE.txt`; `pyproject.toml` `license = "Apache-2.0"`. |
| **Source file / package differences** | Root Apache-2.0. Destination extras may pull vendor SDKs with their own licenses (AWS/GCP/Azure) — those are transitive, not dlt relicensing. |
| **Commercial usage** | Permitted. dltHub also sells commercial products; OSS library remains Apache-2.0. |
| **Redistribution** | Apache-2.0. |
| **Copyleft** | None. |
| **Source disclosure risk** | None. |
| **NOTICE requirement** | Apache attribution; no NOTICE file in clone. |
| **Package distribution risk** | PyPI `dlt`. |
| **Release frequency** | High (`1.30.0` 2026-08-11). |
| **Recent commits** | Very active (team + docs bots). |
| **Issue activity** | 416 open; 5.8k stars. |
| **Maintainer activity** | dltHub company. |
| **Bus factor** | Low-medium (one heavy author `rudolfix`, plus team). |
| **Security policy** | No SECURITY.md in clone. |
| **Dependency risk** | Python extras matrix; pin extras. |
| **Project maturity** | Created 2022. Rapidly maturing. |
| **Grade** | **SAFE_WITH_NOTICE** |

### 8.9 apache/camel — **SAFE_WITH_NOTICE**

| Field | Finding |
| --- | --- |
| **License (SPDX)** | Apache-2.0. `LICENSE.txt`. |
| **Source file / package differences** | `NOTICE.txt` (ASF). Additional NOTICE under Salesforce component and `buildingtools/META-INF/NOTICE`. Camel components may bundle third-party notices; ASF policy applies. |
| **Commercial usage** | Permitted. |
| **Redistribution** | Apache-2.0 + NOTICE. |
| **Copyleft** | None. |
| **Source disclosure risk** | None. |
| **NOTICE requirement** | **Yes (`NOTICE.txt`).** |
| **Package distribution risk** | Huge Java surface (350+ components). Use a **subset** of Camel modules. |
| **Release frequency** | ASF cadence (GitHub Releases list empty in API sample; development HEAD is active 2026-08-28). |
| **Recent commits** | Very active (Andrea Cosentino, Claus Ibsen, Dependabot). |
| **Issue activity** | 34 open (Jira-centric project); 6.3k stars. |
| **Maintainer activity** | Apache PMC. |
| **Bus factor** | Low. |
| **Security policy** | `SECURITY.md` → camel.apache.org/security + documented security model (what is *not* a Camel vuln). |
| **Dependency risk** | **Very high** if you depend on “all of Camel.” Low if you depend on a few components. |
| **Project maturity** | Created 2009. Very mature. |
| **Grade** | **SAFE_WITH_NOTICE** |

---

## 9. Validation / secrets / crypto

### 9.1 python-openapi/openapi-spec-validator — **SAFE_WITH_NOTICE**

| Field | Finding |
| --- | --- |
| **License (SPDX)** | Apache-2.0. `LICENSE` + **`NOTICE`** (© 2017–2021 Artur Maciag). |
| **Source file / package differences** | NOTICE copyright years lag (ends 2021) while code is 2026-active — retain NOTICE as-is plus LICENSE. |
| **Commercial usage** | Permitted. |
| **Redistribution** | Apache-2.0 + NOTICE. |
| **Copyleft** | None. |
| **Source disclosure risk** | None. |
| **NOTICE requirement** | **Yes.** |
| **Package distribution risk** | Low. Depends on jsonschema stack. |
| **Release frequency** | Moderate (`0.9.0` 2026-05-20). |
| **Recent commits** | Maintainer `p1c2u` / Artur Maciag. |
| **Issue activity** | 51 open; 407 stars. |
| **Maintainer activity** | Small-project but alive. |
| **Bus factor** | Medium. |
| **Security policy** | None in clone. Spec validation is not a security sanitizer. |
| **Dependency risk** | Transitive `jsonschema` / `jsonschema-path`. |
| **Project maturity** | Created 2017. Adequate. |
| **Grade** | **SAFE_WITH_NOTICE** |

### 9.2 python-jsonschema/jsonschema — **SAFE_DIRECT**

| Field | Finding |
| --- | --- |
| **License (SPDX)** | MIT. File is **`COPYING`**, not LICENSE. GitHub maps it to MIT. © 2013 Julian Berman. |
| **Source file / package differences** | Do not miss `COPYING` in source distributions. |
| **Commercial usage** | Permitted. |
| **Redistribution** | MIT notice. |
| **Copyleft** | None. |
| **Source disclosure risk** | None. |
| **NOTICE requirement** | None. |
| **Package distribution risk** | Low. De-facto standard. |
| **Release frequency** | Healthy (commits 2026-08-27). |
| **Recent commits** | Julian Berman + automation. |
| **Issue activity** | Moderate; 4.8k+ stars class project. |
| **Maintainer activity** | Strong single maintainer with excellent process. |
| **Bus factor** | Medium (single primary). |
| **Security policy** | `.github/SECURITY.md`: latest release only; `Julian+Security@GrayVines.com`. |
| **Dependency risk** | Low. |
| **Project maturity** | Very mature. |
| **Grade** | **SAFE_DIRECT** |

### 9.3 Yelp/detect-secrets — **REVIEW_REQUIRED**

| Field | Finding |
| --- | --- |
| **License (SPDX)** | Apache-2.0. |
| **Source file / package differences** | Root Apache-2.0. Plugins/heuristics are first-party. |
| **Commercial usage** | Permitted. |
| **Redistribution** | Apache-2.0. |
| **Copyleft** | None. |
| **Source disclosure risk** | None. |
| **NOTICE requirement** | Apache attribution. |
| **Package distribution risk** | Low technically; **stale release train**. |
| **Release frequency** | **Poor.** Latest GitHub release **v1.5.0 (2024-05-06)**; v1.4.0 in 2022. |
| **Recent commits** | 2026-04-02 “Add security review workflow”; 2025-01 Python 3.13 support. Not dead, but slow. |
| **Issue activity** | 177 open; 4.6k stars. |
| **Maintainer activity** | Yelp-internal (atlantis bot). Community PRs may lag. |
| **Bus factor** | Medium-high. |
| **Security policy** | No SECURITY.md found. |
| **Dependency risk** | False-positive/negative risk is a **product** risk. For a secrets scanner, slow CVE response is material. |
| **Project maturity** | Created 2017; historically important, currently under-released. |
| **Grade** | **REVIEW_REQUIRED** — prefer if Data Relay needs a scanner with a faster release SLA (or vendor a pin + own detectors). |

### 9.4 pyca/cryptography — **SAFE_WITH_NOTICE**

| Field | Finding |
| --- | --- |
| **License (SPDX)** | **Apache-2.0 OR BSD-3-Clause** (`pyproject.toml`, `Cargo.toml`). GitHub SPDX `NOASSERTION` because it is dual. |
| **Source file / package differences** | `LICENSE` states contributions are under **both** licenses. `LICENSE.APACHE` + `LICENSE.BSD` both ship. Rust extensions use the same dual SPDX. |
| **Commercial usage** | Permitted under either license. |
| **Redistribution** | Include dual-license files. If choosing Apache-2.0, Apache notice rules apply. |
| **Copyleft** | None. |
| **Source disclosure risk** | None. |
| **NOTICE requirement** | If distributing under Apache-2.0, retain Apache notices; BSD advertising clause is the 3-clause (no endorse). |
| **Package distribution risk** | Wheels include Rust crypto; rustc/OpenSSL/BoringSSL CI matrix is the supply-chain surface, and pyca handles it well. |
| **Release frequency** | Very high (dev `51.0.0-dev1` on main; frequent CPython/Rust bumps). GitHub “Releases” API sample was empty (they tag; verify PyPI). |
| **Recent commits** | Daily automation (`pyca-boringbot`). |
| **Issue activity** | 37 open; 7.7k stars. |
| **Maintainer activity** | Python Cryptographic Authority — best-in-class. |
| **Bus factor** | Low. |
| **Security policy** | `docs/security.rst` + GitHub advisories; reports via standard pyca process. |
| **Dependency risk** | Low for “should we use it?”; high impact if you pin an old wheel (see Presidio issue loosening `cryptography<49` vs CVEs). **Always take current pyca wheels.** |
| **Project maturity** | Created 2013. Gold standard. |
| **Grade** | **SAFE_WITH_NOTICE** |

---

## 10. PII

### 10.1 microsoft/presidio — **SAFE_WITH_NOTICE**

| Field | Finding |
| --- | --- |
| **License (SPDX)** | MIT. `LICENSE` © Presidio Contributors. |
| **Source file / package differences** | **`NOTICE` is 80 KB+ of third-party licenses** (Azure Form Recognizer MIT, opencv-python MIT, spaCy ecosystem, etc.). `docs/NOTICE` also present. Root MIT is **not** sufficient for binary/service redistribution of the full stack. |
| **Commercial usage** | Permitted. |
| **Redistribution** | MIT + full NOTICE third-party set for the components you actually ship (NLP models often have **separate** licenses — spaCy models, Hugging Face weights are **not** automatically MIT). |
| **Copyleft** | None on Presidio code. Model weights can differ. |
| **Source disclosure risk** | None for MIT code. |
| **NOTICE requirement** | **Yes.** |
| **Package distribution risk** | High if you pull OCR/NLP extras. `presidio-analyzer` vs `presidio-anonymizer` vs image path have different deps. |
| **Release frequency** | Regular (`2.2.364` 2026-07-22). |
| **Recent commits** | Active (2026-08-26 healthcare recognizer). |
| **Issue activity** | 107 open; 10.7k stars. Open issue to loosen cryptography pin blocking CVE upgrades — **watch that**. |
| **Maintainer activity** | Microsoft / data-privacy-stack. |
| **Bus factor** | Low. |
| **Security policy** | `SECURITY.md`: GitHub private reporting (link currently points at `data-privacy-stack/presidio`). 48h ack. |
| **Dependency risk** | **High** (NLP models, cryptography pins, OCR). Treat models as a separate license review. |
| **Project maturity** | Created 2018. Mature. |
| **Grade** | **SAFE_WITH_NOTICE** |

---

## 11. Runtime references (especially non-simple licenses)

### 11.1 open-telemetry/opentelemetry-collector — **SAFE_WITH_NOTICE**

| Field | Finding |
| --- | --- |
| **License (SPDX)** | Apache-2.0. Widespread file SPDX `Apache-2.0`. |
| **Source file / package differences** | Core is cleaner than contrib; still Apache NOTICE obligations. |
| **Commercial usage** | Permitted. |
| **Redistribution** | Apache-2.0 + NOTICE if present in the built distro. |
| **Copyleft** | None. |
| **Source disclosure risk** | None. |
| **NOTICE requirement** | Yes (ASF/CNCF style). |
| **Package distribution risk** | Custom Collector Builder (ocb) is the right distribution mechanism. |
| **Release frequency** | High (`v0.159.0` 2026-08-17). |
| **Recent commits** | Very high. |
| **Issue activity** | 698 open; 7.5k stars. |
| **Maintainer activity** | CNCF. |
| **Bus factor** | Low. |
| **Security policy** | OpenTelemetry security process. |
| **Dependency risk** | Medium in core; high only if you add contrib indiscriminately. |
| **Project maturity** | Created 2019. Mature. |
| **Grade** | **SAFE_WITH_NOTICE** |

### 11.2 vectordotdev/vector — **REVIEW_REQUIRED** (non-simple)

| Field | Finding |
| --- | --- |
| **License (SPDX)** | **MPL-2.0**. `LICENSE` is the MPL text (heuristic scanners may mis-tag GPL because MPL quotes GPL in compatibility clauses — **the license is MPL-2.0**). `Cargo.toml` `license = "MPL-2.0"`. GitHub SPDX MPL-2.0. |
| **Source file / package differences** | `NOTICE`: “Unless explicitly stated otherwise all files … MPL-2.0.” Object-form extra notices for **OpenSSL** and Eric Young crypto. `LICENSE-3rdparty.csv` enumerates crates (MIT, Apache-2.0, BSD, 0BSD, …). File-level MPL applies to Vector source files; crate licenses apply to dependencies. |
| **Commercial usage** | **Permitted.** MPL is OSI-approved. Datadog-backed. |
| **Redistribution** | MPL §3.1–3.2: source of **modified MPL-covered files** must be available under MPL. You may ship a Larger Work under another license. Must not remove notices. Ship NOTICE + 3rdparty CSV for binaries. |
| **Copyleft** | **Weak, file-level.** Not viral to all of Data Relay if Vector stays a separate binary and Data Relay code remains separate. **Forking Vector into the Data Relay process/tree and editing MPL files** triggers source disclosure of those files. |
| **Source disclosure risk** | **Medium if forked/modified; low if unmodified official binary/image.** |
| **NOTICE requirement** | **Yes** (`NOTICE`, OpenSSL, `LICENSE-3rdparty.csv`). |
| **Package distribution risk** | High artifact size; many native deps. |
| **Release frequency** | High (`v0.58.0` 2026-08-26). |
| **Recent commits** | Very active (Datadog). |
| **Issue activity** | 2518 open; 22.5k stars. |
| **Maintainer activity** | Datadog Vector team. |
| **Bus factor** | Low (corporate). |
| **Security policy** | Extensive `SECURITY.md` (signed commits, reviews, vuln reporting). |
| **Dependency risk** | High (Rust crate graph). Datadog publishes 3rdparty CSV — use it. |
| **Project maturity** | Created 2018. Mature. |
| **Grade** | **REVIEW_REQUIRED** — suitable as an **unmodified sidecar** after legal OK; **do not merge Vector source into Data Relay runtime** without MPL compliance plan. Not DO_NOT_USE: MPL is FOSS. Not SAFE_DIRECT: copyleft + notice burden. |

### 11.3 redpanda-data/connect (Redpanda Connect, formerly Benthos Connect) — **DO_NOT_USE** (non-simple)

| Field | Finding |
| --- | --- |
| **License (SPDX)** | **Mixed / no root SPDX.** GitHub `license: null`. |
| **Source file / package differences** | `licenses/README.md`: **Apache-2.0** for majority of connectors; **RCL** (`licenses/rcl.md`) for enterprise features. Sampled **1218** `.go` files: **735 Apache headers, 470 RCL/Enterprise headers, 13 neither**. Enterprise packages include CDC (postgres/mysql/mssql/mongodb/oracle), snowflake, iceberg, slack, splunk, openai, etc. `public/license/license.go` is **RCL**. RCL §2(a) also describes Community Edition as **Business Source License 1.1** “or such other license referenced in the relevant repository.” Redpanda product docs describe BSL conversion to Apache-2.0 after four years and a **Streaming or Queuing Service** restriction. **This is not a single OSI license.** |
| **Commercial usage** | Apache-2.0 files: yes. **RCL enterprise files: paid, and “Streaming or Queuing Service” use is restricted.** Data Relay offering pipelines-as-a-product is likely a restricted use. |
| **Redistribution** | Cannot redistribute a unified “Redpanda Connect” binary as if it were Apache-2.0. Free vs enterprise bundles are separate tags (`public/bundle/free` vs `enterprise`). |
| **Copyleft** | RCL/BSL are **source-available, not OSI copyleft**, with field-of-use limits. Apache parts are permissive. |
| **Source disclosure risk** | RCL is not AGPL, but **field-of-use + license-key terms** are worse for a competing commercial stream product than AGPL’s “share source.” |
| **NOTICE requirement** | `licenses/third_party.md` is a large Apache/MIT/BSD inventory — required for any binary ship. |
| **Package distribution risk** | **Critical.** Easy to accidentally import `public/components/all` and pull RCL. |
| **Release frequency** | Very high (`v4.107.0` 2026-08-27). |
| **Recent commits** | Very active (Redpanda). |
| **Issue activity** | 326 open; 8.7k stars. |
| **Maintainer activity** | Redpanda Data. |
| **Bus factor** | Low (corporate) / high **license-change** risk (already relicensed from MIT Benthos). |
| **Security policy** | `SECURITY.md` → security@redpanda.com; redpanda.com/security. |
| **Dependency risk** | High; wraps MIT `redpanda-data/benthos`. |
| **Project maturity** | Product-mature; license-mature in the wrong direction for Data Relay. |
| **Grade** | **DO_NOT_USE** as a Data Relay runtime or connector engine. **REFERENCE_ONLY** for pipeline UX ideas. If a future review considers Apache-2.0-only packages, it must be a **file-allow-list** with legal sign-off — not a clone of this repo. |

### 11.4 redpanda-data/benthos (library) — **REVIEW_REQUIRED**

| Field | Finding |
| --- | --- |
| **License (SPDX)** | MIT. `LICENSE` © 2025 Redpanda Data, Inc. GitHub MIT. |
| **Source file / package differences** | This is the **MIT library** extracted when Benthos was acquired. Connect **depends on** this module and then wraps enterprise bits in RCL. Using `github.com/redpanda-data/benthos/v4` as a library is license-different from shipping Connect. |
| **Commercial usage** | Permitted under MIT **for this repo**. |
| **Redistribution** | MIT notice. |
| **Copyleft** | None. |
| **Source disclosure risk** | None from MIT. |
| **NOTICE requirement** | None. |
| **Package distribution risk** | Strategic: Redpanda may keep Connect as the “product” and this as the engine. Relicense risk exists (already happened once). |
| **Release frequency** | Tags `v4.66.0`–`v4.78.0` in shallow clone; GitHub Releases API empty. Commits in 2026-08. |
| **Recent commits** | Active Redpanda engineers (same people as Connect). |
| **Issue activity** | 83 open; 566 stars (split from original Jeffail/benthos). |
| **Maintainer activity** | Redpanda. |
| **Bus factor** | Corporate; **license-policy bus factor is the issue.** |
| **Security policy** | Contributing present; security likely via Redpanda. |
| **Dependency risk** | Coupling to Connect ecosystem. |
| **Project maturity** | Benthos itself is mature; this GitHub fork dates 2024-05. |
| **Grade** | **REVIEW_REQUIRED** — MIT today, but embedding it as Data Relay’s runtime still needs a “what if they BSL the library” plan. Do not import Connect enterprise packages. |

### 11.5 apache/camel, influxdata/telegraf, fluent/fluent-bit (runtime lens)

Covered in §8. Grades unchanged: Camel / Fluent Bit **SAFE_WITH_NOTICE**; Telegraf **SAFE_DIRECT**. These are the **OSI-clean** runtime references. Prefer them over Vector/Connect/Airbyte when the question is “may we ship this engine inside Data Relay?”

---

## 12. Airbyte (flagged license-complex example) — **DO_NOT_USE**

Airbyte is included even if it is not a primary UI/connector pick, because it is the canonical “looks open source, is not simple” ELT license.

| Field | Finding |
| --- | --- |
| **License (SPDX)** | **Elastic-2.0** at repo root (`LICENSE`). GitHub `NOASSERTION` / “Other.” **Not OSI-approved.** |
| **Source file / package differences** | 1. `LICENSE_SHORT`: “Copyright (c) 2026 Airbyte, Inc., **all rights reserved.**” — **conflicts in tone with ELv2** and must not be ignored. 2. `docs/community/licenses/README.md`: connectors and public repos excluding protocol are **ELv2**; **Airbyte Protocol is MIT**; Cloud/Enterprise/Agents are **commercial**. 3. Sample of connector `metadata.yaml`: **79× `license: ELv2` vs 2× `license: MIT`**. 4. ELv2 effective **2021-09-27 / v0.30.0** (older git history is not MIT for current code). |
| **Commercial usage** | Internal use and many “build a product *on top of* Airbyte without exposing Airbyte UI/API” cases are described as allowed. **You may not** provide Airbyte as a hosted/managed ELT service or sell a product that directly exposes Airbyte’s UI or API. |
| **Redistribution** | ELv2 requires passing the license terms, keeping notices, not circumventing license keys. |
| **Copyleft** | None (ELv2 is source-available with **field-of-use** limits). |
| **Source disclosure risk** | Not AGPL. **Competitive-use risk is the issue.** |
| **NOTICE requirement** | Keep ELv2 text and copyright; do not remove license-key / watermark features. |
| **Package distribution risk** | **Unacceptable for Data Relay** if Data Relay is sold as data movement. Even “only connectors” is mostly ELv2 per metadata.yaml. |
| **Release frequency** | High code velocity; many bot commits. Platform releases: `v2.0.0` 2025-10-15. |
| **Recent commits** | Daily (bots + staff). |
| **Issue activity** | 2349 open; 22k stars. |
| **Maintainer activity** | Airbyte, Inc. |
| **Bus factor** | Low operationally; high **license** risk. |
| **Security policy** | Community health 87; CoC + contributing. |
| **Dependency risk** | Enormous monorepo. |
| **Project maturity** | Mature product, **wrong license class** for embedding. |
| **Grade** | **DO_NOT_USE** |

ELv2 limitations (from Airbyte’s own FAQ, consistent with the `LICENSE` text): no managed service that exposes Airbyte functionality; no license-key circumvention; no notice removal.

---

## 13. Recommended posture for Data Relay

**Prefer (license + maintenance):**

- UI: `@base-ui/react` (MIT), optional `@cloudflare/kumo` (MIT, young), `@xyflow/react` (MIT), `@tanstack/react-table` + `@tanstack/react-virtual` (MIT).
- Schema: `jsonata` (MIT), `monaco-editor` with ThirdPartyNotices, `rc-tree` with dual copyright.
- Connectors/runtime: **Telegraf (MIT)**, **OTel Collector + allow-listed contrib (Apache-2.0)**, **Fluent Bit or Camel** if a native/Java engine is required (Apache-2.0 + NOTICE), **dlt** or **Meltano SDK** for Python extractors (Apache-2.0).
- Validation: `jsonschema` (MIT), `openapi-spec-validator` (Apache-2.0 + NOTICE), `cryptography` (dual).
- PII: Presidio MIT **plus** model-license review.

**Copy-into-tree:** shadcn is fine with attribution and an SBOM of copied files.

**Do not embed:** Airbyte, Redpanda Connect, official Singer-io AGPL taps.

**Legal review before any fork/vendor:** Vector (MPL-2.0), Benthos MIT library (relicense trajectory), dagre (stewardship), genson/archify/detect-secrets (bus factor / stale releases).

---

## 14. Clone map (evidence)

| Directory under `/tmp/oss-audit-clones/` | Upstream |
| --- | --- |
| `base-ui` | github.com/mui/base-ui |
| `kumo` | github.com/cloudflare/kumo |
| `ui` | github.com/shadcn-ui/ui |
| `xyflow` | github.com/xyflow/xyflow |
| `dagre` | github.com/dagrejs/dagre |
| `archify` | github.com/tt-a1i/archify |
| `table` | github.com/TanStack/table |
| `virtual` | github.com/TanStack/virtual |
| `tree` | github.com/react-component/tree |
| `monaco-editor` | github.com/microsoft/monaco-editor |
| `genson` | github.com/wolverdude/genson |
| `jsonata` | github.com/jsonata-js/jsonata |
| `sdk` | github.com/meltano/sdk |
| `singer-getting-started` | github.com/singer-io/getting-started |
| `singer-python` | github.com/singer-io/singer-python |
| `telegraf` | github.com/influxdata/telegraf |
| `opentelemetry-collector-contrib` | github.com/open-telemetry/opentelemetry-collector-contrib |
| `fluent-bit` | github.com/fluent/fluent-bit |
| `dlt` | github.com/dlt-hub/dlt |
| `camel` | github.com/apache/camel |
| `openapi-spec-validator` | github.com/python-openapi/openapi-spec-validator |
| `jsonschema` | github.com/python-jsonschema/jsonschema |
| `detect-secrets` | github.com/Yelp/detect-secrets |
| `cryptography` | github.com/pyca/cryptography |
| `presidio` | github.com/microsoft/presidio |
| `opentelemetry-collector` | github.com/open-telemetry/opentelemetry-collector |
| `vector` | github.com/vectordotdev/vector |
| `connect` | github.com/redpanda-data/connect |
| `benthos` | github.com/redpanda-data/benthos |
| `airbyte` | github.com/airbytehq/airbyte |

---

## 15. Disclaimer

This document is an engineering license-and-maintenance survey from public repository artifacts. It is not a legal opinion. Field-of-use licenses (ELv2, RCL, BSL) and AGPL network clauses should be reviewed by counsel against Data Relay’s actual distribution model (on-prem, SaaS, managed, OEM).
