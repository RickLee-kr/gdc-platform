# M30.1 — Operations & Streams UX Redesign (Design Spec)

**Status:** Design only — no code changes in M30.1  
**Baseline:** [M30.0 UX Audit Report](agent-transcript:51912447-780f-412f-b57a-89e09bd95340)  
**Charter:** DATA-RELAY-UX-CHARTER v1.1  
**Date:** 2026-06-09  
**Scope:** `/monitoring`, `/streams`, sidebar + top navigation

---

## 1. Design Goals

| Critical # | Problem (M30.0) | M30.1 Design Response |
|------------|-------------------|------------------------|
| #1 | Operator vocabulary ≠ engine vocabulary | Unified copy map; engine terms relegated to Administration > System health |
| #2 | No What / Why / Action structure | 3-tier shell on Operations Center; Streams issue hero strip |
| #3 | 15+ widgets — 5-second comprehension fails | ≤6 above-the-fold modules; progressive disclosure |
| #4 | Source Product Group UX missing | Product-centric grouping on Streams console (frontend mapping layer) |
| #5 | Engine / Runtime exposed | Remove engine widget from ops surface; collapse topology links |

**Non-goals (M30.1):** Wizard relabel, stream detail tab refactor, Governance drawer parity, AI Stream wizard — deferred to M30.2 / M30.3.

---

## 2. New Operations Center Layout (`/monitoring`)

### 2.1 Information Architecture

Replace flat widget grid with **Governance Operations-style 3-tier frame**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Operations Center                    [Window ▾] [Refresh ▾] [↻ Now]    │
│ Answer: What happened · Why · What should I do?                         │
├─────────────────────────────────────────────────────────────────────────┤
│ TIER 1 — INCIDENT SUMMARY (above the fold, always visible)              │
├─────────────────────────────────────────────────────────────────────────┤
│ TIER 2 — WHY PANEL (context for top incident)                         │
├─────────────────────────────────────────────────────────────────────────┤
│ TIER 3 — ACTION PANEL (prioritized CTAs)                                │
├─────────────────────────────────────────────────────────────────────────┤
│ TIER 4 — KPI STRIP (6 cards max, operator labels)                       │
├─────────────────────────────────────────────────────────────────────────┤
│ TIER 5 — PROGRESSIVE DISCLOSURE (collapsed by default)                  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Tier 1 — Incident Summary

**Purpose:** Answer “What happened?” in ≤5 seconds.

| Element | Content | Data source (existing) |
|---------|---------|------------------------|
| Platform posture badge | `Healthy` / `Degraded` / `Critical` — single derived state | `health` + `dashboard.summary` |
| Primary headline | e.g. “3 streams need attention · 2 delivery failures in 1h” | `health.worst_streams`, `dashboard.recent_problem_routes` |
| Incident chips (max 4) | Stream name + severity; governance queue counts if >0 | `worst_streams`, `GovernanceOperationsSummary` |
| Active streams pill | “12 streams active” (retain current pulse badge) | `dashboard.summary.running_streams` |

**Rules:**
- No per-widget scrolling above fold on 1440×900.
- If zero streams configured → retain welcome empty state (no tiers).
- Governance counts appear only when `governance_read` and count > 0.

### 2.3 Tier 2 — Why Panel

**Purpose:** Answer “Why?” for the **selected incident** (default: highest severity).

| Section | Operator copy | Source |
|---------|---------------|--------|
| Affected stream | Stream name, source product, last successful delivery | `stats-health`, connector name |
| Root cause summary | Plain language: rate limit / destination timeout / mapping error / policy block | `delivery_logs` stage + `health` route/stream reason fields |
| Timeline snippet | Last 3 delivery outcomes (ok / failed / retry) | `recent_problem_routes`, logs page items |
| Related risk | Open violation / quarantine link if stream implicated | Governance APIs |

**Interaction:** Clicking an incident chip in Tier 1 updates Why Panel (client-side, no new API required for MVP — compose from existing bundle).

**Pattern reference:** Quarantine drawer “Why blocked?” (`quarantine-center-page.tsx`).

### 2.4 Tier 3 — Action Panel

**Purpose:** Answer “What should I do?”

| Priority | Action card | CTA target | Condition |
|----------|-------------|------------|-----------|
| P0 | Review delivery failures | `/logs?stream_id={id}&status=failed` | failures > 0 |
| P0 | Open governance action | `/governance/operations` | pending approvals / quarantine > 0 |
| P1 | Inspect unhealthy stream | `/streams?focus={id}&issue=open` | degraded/error stream |
| P1 | Pause / resume stream | inline control or `/streams` focus | operator role |
| P2 | View delivery analytics | `/monitoring/analytics?stream_id={id}` | optional drill-down |

**Rules:**
- Max 3 visible action cards; overflow → “View all actions” → Governance Operations.
- CTAs must **not** default to `/routes`, `/connectors`, `/destinations` (engine config surfaces).
- Reuse `GovernanceOperationsActionRequiredItem` card styling where governance items present.

### 2.5 Tier 4 — KPI Strip (6 cards maximum)

| # | Label (operator) | Replaces | Link target |
|---|------------------|----------|-------------|
| 1 | Active streams | Active Streams | `/streams?status=RUNNING` |
| 2 | Healthy streams | Healthy Streams (live) | `/streams?health=healthy` |
| 3 | Delivery issues | Route Posture (Live) | `/logs?status=failed` (not `/routes`) |
| 4 | Retrying deliveries | Retrying Deliveries | `/monitoring/analytics?focus=retries` |
| 5 | Delivery activity | Delivery activity rows | `/logs` |
| 6 | Risk & governance | *(new composite)* | `/governance` or `/governance/operations` |

**Removed from Operations Center:**
- `OpsRuntimeEngineWidget` (Platform status & host) → **Administration > System health**
- `Destinations` KPI card → Administration hub
- Quick links bar (Routes, Connectors, Destinations) → replaced by Action Panel

**Copy rules:** All KPI `sub` text through `sanitizeOperatorDisplayText()`; ban `delivery_logs`, `lifecycle rows`, `run_complete` in operator view.

### 2.6 Tier 5 — Progressive Disclosure

Collapsed accordion sections (default **closed**):

| Section | Former widgets bundled |
|---------|------------------------|
| Delivery trends | `RuntimeVolumeWidget` + `EventsOutcomePanel` |
| Top problems | `TopFailingRoutesWidget`, `TopUnhealthyStreamsWidget`, `DestinationHealthWidget` |
| Recent activity | `RecentDeliveriesWidget`, `ActiveAlertsWidget`, `OpsRecentFailuresWidget` |
| Platform maintenance | `OpsRetentionSummaryWidget`, `ValidationOperationalWidget` (internal only) |
| Advanced metrics | Retries, rate limits, latency cards (moved here from above-the-fold) |

**Retain below fold only:** UTC footer with simplified copy — remove raw `runtime_engine_status` and worker count from Operations Center footer.

### 2.7 `/monitoring/streams` (Stream monitoring sub-route)

**Role clarification:** Deep stream topology view for power users — **not** the default Operations landing.

| Change | Detail |
|--------|--------|
| Breadcrumb | Operations Center → Stream monitoring |
| Entry | Linked from Action Panel / KPI, not sidebar duplicate |
| Rename labels | `Connector #N` → connector **display name**; `Group by: Connector` → `Group by: Source product` |
| Default group mode | `health` (not `none`) |
| Hide | `ProblemInsightPanel` engine jargon → operator “Issue insight” with Why summary |

---

## 3. New Streams Console Layout (`/streams`)

### 3.1 Information Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Streams Console                          [Search] [Product ▾] [Status ▾]│
│ Manage data streams by source product and health                        │
├─────────────────────────────────────────────────────────────────────────┤
│ KPI STRIP (4 cards)                                                     │
├─────────────────────────────────────────────────────────────────────────┤
│ GROUPED STREAM LIST (default: Source Product Group)                     │
│   ▼ CrowdStrike Falcon (3 streams · 1 issue)                          │
│   ▼ Okta System Log (2 streams · healthy)                               │
│   ▼ Amazon S3 — Security Lake (1 stream · degraded)                     │
├─────────────────────────────────────────────────────────────────────────┤
│ ISSUE DETAIL PANEL (right rail — What / Why / Action for selected)      │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Source Product Group

**Definition:** Operator-facing grouping key derived from connector/product metadata — **not** a new backend entity in M30.1.

| Mapping layer | Implementation (M30.1) |
|---------------|-------------------------|
| Primary key | `connector_id` → `product_group_label` |
| Label source (priority) | 1) Connector `display_name` / template registry product name 2) Heuristic on connector name 3) Fallback: “Other sources” |
| Icon | Reuse `sourceTypePresentation` icons per dominant source type in group |

**Filter rename:**

| Current | Target |
|---------|--------|
| Connector filter | **Source product** |
| `HTTP API POLLING` etc. | **Ingest method** (secondary filter, collapsed) |
| `All Connectors` | **All products** |

**Grouping UX:** Port `buildStreamVirtualItems` pattern from `runtime-stream-selectors.ts` with new mode `product` (frontend-only). Reuse collapse/expand from `VirtualizedStreamGrid`.

**Group header shows:** Product label · stream count · aggregate health (worst status in group) · issue count badge.

### 3.3 Group Health

Per product group header:

| Indicator | Rule |
|-----------|------|
| Group status | Worst stream status in group (ERROR > DEGRADED > RUNNING > STOPPED) |
| Issue badge | Count of streams with `ERROR` or `DEGRADED` |
| Sparkline | Aggregated delivery success rate (optional M30.1.1 — can defer) |

### 3.4 Stream Status (row simplification)

**Visible columns (default):**

| Column | Operator label | Hide engine detail |
|--------|----------------|-------------------|
| Stream name | Stream | — |
| Status | Status badge | — |
| Delivery health | Last hour success % | Replace route fan-out dots |
| Issue | Single chip: None / Retrying / Failed / Rate limited | — |
| Actions | Run now · View issue | Hide Mapping/Enrichment/API Test from default row |

**Advanced columns** (toggle “Show setup details”): ingest method, last checkpoint **→ relabel “Last sync position”**, route count **→ “Delivery targets”**.

### 3.5 Stream Issue Display

**Right rail** replaces 8-tab detail panel as **default** when stream selected:

| Section | Content |
|---------|---------|
| What happened | Status, last run, delivery outcome summary |
| Why | Top failure reason from `stats-health` / recent log stage |
| What to do | CTAs: View logs (filtered), Open delivery analytics, Edit stream setup (admin) |

**Tab consolidation (M30.1 scope — navigation only, full tab refactor in M30.2):**

| Current 8 tabs | M30.1 default view |
|----------------|-------------------|
| Configuration, Run History, Delivery, Checkpoint, Routes, Logs, Errors, Metrics | **Issues** (new default) + **Setup** (links to edit/mapping) + **History** (run + delivery timeline) |

### 3.6 Streams KPI Strip (4 cards)

| Card | Metric |
|------|--------|
| Total streams | Count |
| Need attention | ERROR + DEGRADED count |
| Deliveries (1h) | Success / failed |
| Setup incomplete | Workflow checklist incomplete count |

Reduce from 6 KPIs — remove connector-centric and engine-centric cards.

---

## 4. Navigation Redesign

### 4.1 Sidebar Top-Level (target)

| Order | Label | Path | Role |
|-------|-------|------|------|
| 1 | **Operations** | `/monitoring` | **What happened / Why / Action** — daily operator home |
| 2 | **Streams** | `/streams` | Configure and monitor data streams by source product |
| 3 | **Governance** | `/governance` | Policies, violations, risk, quarantine, replay, audit |
| 4 | **AI Gateway** | `/ai-gateway/traffic` | AI traffic, providers, AI streams (feature-flagged) |
| 5 | **Administration** | `/admin` | Connectors, destinations, routes, system health, settings |

### 4.2 Menu Role Definitions

#### Operations (renamed from Monitoring)
- **Primary user:** Operator, Viewer
- **Answers:** Platform health, delivery incidents, governance urgency
- **Includes:** `/monitoring`, `/monitoring/analytics`, `/monitoring/streams` (sub-routes)
- **Excludes:** Engine topology as landing experience

#### Streams
- **Primary user:** Operator, Administrator
- **Answers:** Which sources are connected, which streams need setup or have issues
- **Includes:** `/streams`, `/streams/new`, stream sub-routes (setup)
- **Excludes:** Raw checkpoint/route engine vocabulary in default view

#### Governance
- **Primary user:** Governance role, Operator (read)
- **Answers:** Policy risk, violations, quarantine, approvals, replay
- **Unchanged** hub structure; Operations Center **surfaces** governance urgency via Tier 1/3

#### AI Gateway
- **Primary user:** Operator (AI traffic), Administrator (providers)
- **Answers:** AI request volume, blocks, provider health
- **Default landing:** Traffic (not Providers) — Charter operator-first
- **Visibility:** Sidebar entry when `VITE_AI_GATEWAY_FOUNDATION=true`; OSS may hide

#### Administration
- **Primary user:** Administrator
- **Answers:** Platform configuration — connectors, destinations, routes, mappings, **system health**
- **Absorbs:** Engine/runtime widgets removed from Operations Center
- **Sub-hub cards renamed:** “Connectors” → “Source connections”, “Routes” → “Delivery paths”, “Destinations” → “Delivery targets”

### 4.3 Logs Placement

**Decision:** Logs remains **reachable** but not top-level sidebar.

| Access path | Rationale |
|-------------|-----------|
| Operations Action Panel → “View delivery failures” | Primary operator path |
| Streams issue rail → “View logs” | Stream-scoped |
| Top header search / command palette (future) | M30.2 |
| Administration → Observability (optional link) | Admin drill-down |

### 4.4 Top Navigation (header)

| Element | Change |
|---------|--------|
| Page title | Sync with sidebar label (Operations, not Monitoring) |
| Breadcrumb | Operations → Stream monitoring / Analytics |
| Logo home link | `/monitoring` (Operations home) — **not** `/streams` |
| Environment badge | Unchanged |

### 4.5 RBAC

| Menu | Hide when |
|------|-----------|
| Governance | `!governance_read` (existing) |
| AI Gateway | `!isAiGatewayFoundationEnabled()` |
| Administration | Viewer role — read-only banner (existing) |

---

## 5. Before / After Wireframes (ASCII)

### 5.1 Operations Center — BEFORE (current)

```
+------------------------------------------------------------------+
| Operations Center                    [window] [refresh] [active] |
| What happened: stream health, incidents, alerts, retries...    |
+------------------------------------------------------------------+
| [KPI][KPI][KPI][KPI][KPI][KPI]                                   |
+------------------------------------------------------------------+
| Quick: Stream monitoring | Logs | Routes | Analytics | Connectors|
+------------------------------------------------------------------+
| Pipeline Health Strip                                            |
+------------------------------------------------------------------+
| Route Health Summary                                             |
+------------------------------------------------------------------+
| [Retries][Rate Limits][Latency][PLATFORM STATUS & HOST/WORKERS]  |
+------------------------------------------------------------------+
| [Volume Chart          ][Outcome Panel           ]               |
+------------------------------------------------------------------+
| [Top Routes][Top Streams][Top Destinations]                      |
+------------------------------------------------------------------+
| Recent Failures (full width)                                     |
+------------------------------------------------------------------+
| [Recent Deliveries    ][Active Alerts         ]                   |
+------------------------------------------------------------------+
| [Retention            ][Validation            ]                   |
+------------------------------------------------------------------+
| Footer: Platform status: RUNNING · 4 active workers              |
+------------------------------------------------------------------+
   ^ 15+ widgets — no Why / Action structure
```

### 5.2 Operations Center — AFTER (M30.1 target)

```
+------------------------------------------------------------------+
| Operations Center                    [window] [refresh]          |
| What happened · Why · What should I do?                          |
+------------------------------------------------------------------+
| [!] DEGRADED  "3 streams need attention · 2 failures (1h)"       |
| Chips: [malop-api ERR] [okta-log DEG] [2 governance actions]     |
+------------------------------------------------------------------+
| WHY — malop-api                                                  |
| Source: CrowdStrike · Last ok: 12m ago                           |
| Cause: Destination timeout (route → Splunk HEC)                  |
| Recent: ok · ok · FAILED                                         |
+------------------------------------------------------------------+
| ACTION                                                           |
| [View failed deliveries] [Open stream issue] [Pause stream]      |
+------------------------------------------------------------------+
| [Active][Healthy][Issues][Retries][Activity][Risk/Gov]  (6 KPI) |
+------------------------------------------------------------------+
| > Delivery trends (collapsed)                                    |
| > Top problems (collapsed)                                       |
| > Recent activity (collapsed)                                    |
+------------------------------------------------------------------+
| All times UTC.                                                   |
+------------------------------------------------------------------+
   ^ ≤6 modules above fold — 5-second comprehension YES
```

### 5.3 Streams Console — BEFORE (current)

```
+------------------------------------------------------------------+
| Streams KPI x6                                                   |
+------------------------------------------------------------------+
| Filters: [Connector v] [Source: HTTP_API_POLLING v] [Status v]   |
+------------------------------------------------------------------+
| FLAT TABLE                                                       |
| Name | Connector | Source enum | Routes dots | CP | Delivery %   |
+------------------------------------------------------------------+
| Detail: [Config|Run|Delivery|Checkpoint|Routes|Logs|Err|Metrics] |
+------------------------------------------------------------------+
   ^ No product grouping · engine columns default visible
```

### 5.4 Streams Console — AFTER (M30.1 target)

```
+------------------------------------------------------------------+
| [Total][Need attention][Deliveries 1h][Setup incomplete]         |
+------------------------------------------------------------------+
| [Search........] [Source product v] [Status v] [Ingest method v] |
+------------------------------------------------------------------+
| GROUP BY: Source product (default)                               |
|                                                                  |
| v CrowdStrike Falcon (3) ======================= 1 issue         |
|     malop-detect    ERROR   Failed    [View issue] [Run now]     |
|     malop-api       OK      98%       [View issue] [Run now]     |
|                                                                  |
| v Okta System Log (2) =========================== healthy        |
|     okta-auth       OK      100%      ...                        |
+----------------------------------------+-------------------------+
|                                        | ISSUE — malop-detect    |
|                                        | What: Delivery failing  |
|                                        | Why: Mapping field null |
|                                        | Do: [Logs] [Fix mapping]|
+----------------------------------------+-------------------------+
```

### 5.5 Navigation — BEFORE

```
Sidebar:
  Streams          -> /streams  (logo also links here)
  Monitoring       -> /monitoring
  Logs             -> /logs
  Governance       -> /governance
  Administration   -> /admin
  (no AI Gateway)
```

### 5.6 Navigation — AFTER

```
Sidebar:
  Operations       -> /monitoring   (logo links here)
  Streams          -> /streams
  Governance       -> /governance
  AI Gateway       -> /ai-gateway/traffic  (flagged)
  Administration   -> /admin

Logs: via Operations / Streams actions (not sidebar)
```

---

## 6. UX Charter Compliance Matrix

| Charter rule | Current (M30.0) | Target (M30.1) | Improvement |
|--------------|-----------------|----------------|-------------|
| User sees Streams, not StreamRunner | △ Runtime links everywhere | Default views hide pipeline internals | Operator-first stream list |
| User sees Operations, not runtime_engine | ✗ Widget + footer expose engine | Engine widget → Administration | Engine hidden from ops home |
| What happened? | △ Label only on header | Tier 1 Incident Summary | Single glance posture |
| Why? | ✗ Not on Monitoring/Streams | Tier 2 Why Panel + stream issue rail | Quarantine pattern adopted |
| What should I do? | ✗ Quick links to engine paths | Tier 3 Action Panel | Actionable CTAs |
| ≤5 second comprehension | ✗ 15+ widgets | ≤6 above fold | Progressive disclosure |
| Source Product Group | ✗ Flat table + enum filters | Product grouping + renamed filters | Operator domain language |
| Hide Routes/Connectors/Checkpoint | ✗ Default columns & links | Advanced toggle only | Vocabulary gate |
| Governance integrated into ops | △ Separate surfaces | Incident chips + Risk KPI | Unified urgency |
| AI Gateway operator surface | ✗ Hidden / provider-first | Sidebar + traffic-first | Nav role defined (implement M30.1 nav, detail M30.3) |

---

## 7. M30.1 Implementation Difficulty

| Area | Effort | Complexity | Notes |
|------|--------|------------|-------|
| **Frontend** | **L** (4–6 weeks) | Medium–High | New layout components; reuse existing data hooks (`useDashboardOverviewData`, streams console loaders) |
| Operations 3-tier shell | M | Compose existing APIs | No new endpoints required for MVP |
| Widget relocation / accordion | S–M | Mechanical | Move widgets to disclosure sections |
| KPI relabel + link retarget | S | Copy + `dashboardKpi.ts` |
| Streams product grouping | M | Port `VirtualizedStreamGrid` pattern | New `product` group mode |
| Product label mapping | S | Frontend map connector → product | Until backend metadata (M30.2) |
| Streams issue rail | M | Partial tab restructure | Full tab merge deferred M30.2 |
| Navigation rename | S | `app-navigation.tsx`, sidebar, tests |
| AI Gateway sidebar entry | S | Feature flag + route order |
| **Backend** | **S** (optional enhancements) | Low | M30.1 achievable frontend-only |
| `product_group` on connector | — (optional) | — | Defer; frontend heuristic sufficient |
| Incident root-cause aggregation | — (optional) | — | MVP uses existing `worst_streams` reasons |
| Governance summary on dashboard bundle | S | Add to existing dashboard snapshot if latency OK |
| **Migration** | **S** | Low | No DB migration |
| URL changes | None | `/monitoring` canonical (already) |
| Bookmark redirects | S | `/runtime` → `/monitoring` (exists) |
| User training | Copy change | Monitoring → Operations |

---

## 8. M30.2 / M30.3 Impact

### M30.2 — Wizard & Stream Detail (depends on M30.1)

| M30.1 delivers | M30.2 builds on |
|----------------|---------------|
| Streams issue rail (default) | Full tab merge: Overview / Delivery / Issues / Settings |
| Product group filter labels | Backend `product_group` metadata on connectors |
| Ingest method secondary filter | Wizard stepper Charter relabel |
| Hide engine columns (toggle) | Remove Checkpoint/Routes from operator default entirely |
| Operations Why Panel | Per-stream Why on `/streams/:id` hero |

**Risk if M30.1 skipped:** M30.2 stream detail work lacks grouping context and consistent vocabulary.

### M30.3 — Governance & AI Gateway (parallel after M30.1)

| M30.1 delivers | M30.3 builds on |
|----------------|---------------|
| Governance chips on Operations | Full Violations/Replay drawer W/W/W |
| AI Gateway nav slot + traffic-first | AI Stream wizard, dedicated AI detail page |
| Risk & governance KPI | Live policy enforcement badge |
| Logs demoted from sidebar | Command palette / global log search |

**Risk if M30.1 skipped:** AI Gateway remains orphaned; Operations/Governance stay disconnected.

---

## 9. Pre-Implementation Checklist

- [ ] Approve sidebar rename Monitoring → Operations
- [ ] Approve Logs removal from top-level sidebar
- [ ] Confirm product label heuristic acceptable until connector metadata ships
- [ ] Confirm `OpsRuntimeEngineWidget` destination: Administration > System health
- [ ] OSS build: verify AI Gateway sidebar hidden per flag
- [ ] Update `operator-vocabulary.ts` with Tier labels (`whyPanel`, `actionPanel`, `sourceProduct`)
- [ ] Test plan: 5-second comprehension user test on Operations mock

---

## 10. Final Verdict

### **Ready For Implementation**

M30.1 design is sufficiently specified to begin frontend implementation without additional UX design cycles for the scoped surfaces (Operations Center, Streams Console, Navigation).

**Conditions:**
1. Product group label mapping uses **frontend heuristic** in M30.1; formal connector metadata is a **nice-to-have**, not a blocker.
2. Streams 8-tab panel **default switch** to issue rail is in scope; full tab consolidation remains **M30.2**.
3. AI Gateway sidebar entry is **nav-only** in M30.1; wizard and detail pages remain **M30.3**.

**Not required before implementation:**
- Additional wireframes for mobile breakpoints (follow existing responsive grid patterns)
- New backend incident aggregation service (compose from existing dashboard bundle)

---

*References: `frontend/src/components/dashboard/dashboard-overview.tsx`, `frontend/src/components/streams/streams-console.tsx`, `frontend/src/config/app-navigation.tsx`, `frontend/src/lib/runtime-stream-selectors.ts`, `frontend/src/lib/operator-vocabulary.ts`, M30.0 UX Audit Report.*
