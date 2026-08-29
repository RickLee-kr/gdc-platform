# 01 — UI Foundation Audit (Data Relay vs OSS)

> **Closure (2026-08-29):** Scheduled OSS Fit implementation is complete (`OSS_FIT_SCHEDULED_IMPLEMENTATION_COMPLETE=YES`). W1 and W8 are COMPLETE on `oss-fit/integration-wave2`. This file remains the pre-implementation audit record. Final statuses and SHAs: [DATA-RELAY-OSS-IMPLEMENTATION-WORKPLAN.md](./DATA-RELAY-OSS-IMPLEMENTATION-WORKPLAN.md).

## Correct-branch reconciliation

**Re-verified:** `/home/aella/gdc-oss-reconcile` HEAD `99dd3bac886760460201f54deaaa282ec0e98bc1` (`audit/code-to-oss-fit-reconcile`) on 2026-08-29. Independent function-level re-check confirmed: `frontend/package.json` has no `@base-ui/react`; `frontend/src/components/ui` is still only `card.tsx`, `help-tooltip.tsx`, `resizable-split.tsx`; zero `focus-trap` / `inert` under `frontend/src`.  
**OSS research:** reused from the original 01 body below (Base UI / Kumo / shadcn were **not** re-cloned).  
**Canonical:** `docs/canonical/06-USER-EXPERIENCE.md` (v2.0, 2026-08-25) — operator IA, wizard, dashboard, marketplace **TARGET**s. It does **not** define a primitive kit, Dialog/Sheet a11y, or Button/Input/Menu/Tooltip, and does **not** supersede W1/W8.

Product code was not modified. This section only classifies workplan items against **this** HEAD.

### Workplan classification

| ID | Workplan item | Classification | Why on this HEAD |
| --- | --- | --- | --- |
| **W1** | Base UI Dialog + Sheet wrappers | **STILL_REQUIRED** | No `@base-ui/react`. No `components/ui/dialog.tsx` or `sheet.tsx`. Overlays remain ad-hoc `fixed inset-0` / `role="dialog"` with **no** focus trap, **no** `inert`, and almost no Escape. |
| **W8** | Button, Input, Menu, Tooltip | **PARTIAL** | Token head-start only: `gdcUi.primaryBtn` / `gdcUi.input` / `HelpTooltip`. **No** `button.tsx` / `input.tsx` / `dropdown-menu.tsx`. CVA declared and **unused**. Menus are click-outside except two wizard popovers. W8 still depends on W1 for Base UI. |

Neither item is `ALREADY_IMPLEMENTED` or `DELETE_FROM_WORKPLAN`. Original OSS verdict stands: Base UI + GDC Tailwind 3.4 wrappers; reject Kumo / Radix / vaul / Tailwind 4-for-Kumo.

### This-branch facts (spot-check)

| Surface | Finding |
| --- | --- |
| `frontend/package.json` | React 19, Vite 5, Tailwind **3.4.17**, CVA unused, lucide, recharts. **Still absent:** `@base-ui/react`, `@cloudflare/kumo`, `@radix-ui/*`, `vaul`, `react-hook-form`, `components.json`. |
| `frontend/src/components/ui` | Still only `card.tsx`, `help-tooltip.tsx` (+ copy/test), `resizable-split.tsx`. |
| Layout / shell | Unchanged product chrome: `AppShellLayout`, `Sidebar`, `TopHeader`, `PersonaSwitcher`, `AppShell`, `StatusBadge`, `DevValidationBadge`. **Keep.** |
| Tokens | `tailwind.config.js` `gdc.*` + `darkMode: 'class'`. `index.css` still has no CSS-variable token sheet. `gdcUi` tokens in `lib/gdc-ui-tokens.ts`. |
| Search | `TopHeader` native `<input type="search">`. **No** Search Dialog / command palette. |
| Dialog / Drawer / Sheet | Same pattern as original §2.5. Extra ad-hoc dialogs on this HEAD (still not primitives): `marketplace-upload-dialog.tsx`, `marketplace-package-detail.tsx`, `marketplace-ai-builder.tsx`. `GovernanceInvestigationDrawer` still has **no** `role="dialog"` on the panel. `StreamGovernanceDrawer` remains an in-page rail; mobile uses a bottom `role="dialog"` without trap/Escape — **do not** replace the desktop rail. |
| Button / Input | Native `<button>` / `<input>` + `gdcUi.primaryBtn` / `gdcUi.input`. No shared primitive. |
| Menu | Ad-hoc `role="menu"` (enrichment, mapping, logs, routes, connector row actions). Escape only in `metadata-mapping-menu.tsx` and `destination-field-chip.tsx`. |
| Tooltip | `HelpTooltip` CSS tooltip + native `title=`. No Floating UI. |
| Focus / Escape | **Zero** `focus-trap` / `FocusTrap` / `inert` under `frontend/src`. Escape handlers: **two files** (mapping menu, destination field chip). |

**W1 migrate list (this HEAD, ~22 overlays).** Do **not** replace `layout/sidebar.tsx`, KPI widgets, or the desktop `StreamGovernanceDrawer` rail. Preserve `data-testid`.

Center modals → Dialog: `template-draft-preview-modal.tsx`, `template-use-modal.tsx`, `wizard-governance-start-modal.tsx`, `stream-runtime-detail-page.tsx` (backfill), `stream-edit-wizard-page.tsx` (delete confirm), `admin-settings-page.tsx`, `admin-settings-operational.tsx`, `destinations-management-page.tsx` (create/edit + delete), `marketplace-upload-dialog.tsx`, `marketplace-package-detail.tsx`, `marketplace-ai-builder.tsx`.

End/side drawers → Sheet: `template-preview-panel.tsx`, `wizard-data-protection-drawer.tsx`, `request-preview-drawer.tsx`, `stream-governance-drawer.tsx` (mobile bottom sheet only), `policy-editor-drawer.tsx`, `governance-investigation-drawer.tsx`, `destination-detail-drawer.tsx`, `logs-explorer-page.tsx` / `log-detail-drawer.tsx`.

W8 (not W1): `destination-field-chip.tsx`, `connector-streams-popover.tsx`, `sensitive-findings-panel.tsx` (inline panel). Escape today only in `metadata-mapping-menu.tsx` and `destination-field-chip.tsx`.

---

**Original audit metadata (unchanged OSS research):**

**Agent:** 1 — UI Foundation  
**Product:** Data Relay (`/home/aella/gdc-platform`, branch `feature/post-m29-development`)  
**Date:** 2026-08-28  
**Scope:** Frontend primitives only. AI Gateway is out of scope. Runtime behavior is not in scope. Architecture remains **One Stream → Many Routes → Many Destinations**; this audit does not propose parallel runtimes or a second UI shell.

This document is an audit, not an implementation. No Data Relay source, tests, or configs were modified except this file.

---

## 1. Method and clones

Judgment is from **cloned source**, package manifests, tests, licenses, and recent commits — not README marketing copy.

| OSS | Clone path | Remote | Shallow HEAD | License |
| --- | --- | --- | --- | --- |
| MUI Base UI | `/tmp/oss-audit-clones/base-ui` | https://github.com/mui/base-ui | `3cb844b` (2026-08-28, `[all components] Use ESM metadata constants (#5248)`) | MIT (`LICENSE`, Copyright Material-UI SAS) |
| Cloudflare Kumo | `/tmp/oss-audit-clones/kumo` | https://github.com/cloudflare/kumo | `4066307` (2026-08-28, `feat(pagination): support unknown totals (#752)`) | MIT (`LICENSE`, Copyright 2026 Cloudflare, Inc.) |
| shadcn/ui | `/tmp/oss-audit-clones/ui` | https://github.com/shadcn-ui/ui | `683a5a9` (2026-08-26, `feat(registry): add @onchain-ui…`) | MIT (`LICENSE.md`, Copyright 2023 shadcn) |

Published package facts (npm, 2026-08-28):

- `@base-ui/react` **1.7.0** (released 2026-08-04). Peer: `react` / `react-dom` `^17 \|\| ^18 \|\| ^19`. ~10.8M weekly downloads. Headless/unstyled.
- `@cloudflare/kumo` **2.12.0** in clone (`packages/kumo/package.json`). Peer: `react` `^18 \|\| ^19`, plus `@phosphor-icons/react`. Depends on `@base-ui/react` `^1.6.0`.
- `shadcn` CLI **4.19.0** (`packages/shadcn/package.json`). Copy-into-app registry, not a runtime UI library.

All three licenses are MIT and usable for a commercial product if copyright notices are retained.

---

## 2. Data Relay current stack (evidence)

### 2.1 Manifest and toolchain

`frontend/package.json`:

| Item | Value |
| --- | --- |
| React | `^19.0.0` (`react`, `react-dom`, `@types/react`) |
| Bundler | Vite `^5.4.11` |
| CSS | Tailwind CSS **`^3.4.17`** + PostCSS + Autoprefixer (`frontend/postcss.config.js`: `tailwindcss` + `autoprefixer`) |
| Class merge | `clsx` `^2.1.1`, `tailwind-merge` `^3.5.0` via `frontend/src/lib/utils.ts` `cn()` |
| Variants | `class-variance-authority` `^0.7.1` **declared but unused** — zero `from 'class-variance-authority'` / `cva(` in `frontend/src` |
| Icons | `lucide-react` `^1.14.0` |
| Charts | `recharts` `^3.8.1` |
| Router | `react-router-dom` `^7.15.0` |

**Not present:** `@radix-ui/*`, `radix-ui`, `@base-ui/react`, `@cloudflare/kumo`, `vaul`, `react-hook-form`, `components.json` (no shadcn init).

### 2.2 Token architecture

Two cooperating layers:

1. **Tailwind theme extension** — `frontend/tailwind.config.js`  
   - `darkMode: 'class'`  
   - `theme.extend.colors.gdc.*` L0–L3 navy surfaces (`page`, `panel`, `section`, `card`, `elevated`), borders, `primary: '#7C3AED'`  
   - Shadows `gdc-card` / `gdc-elevated` / `gdc-control`  
   - Page glow `gdc-page-glow`

2. **Class-string tokens** — `frontend/src/lib/gdc-ui-tokens.ts` `gdcUi`  
   - `cardShell`, `innerWell`, `input`, `select`, `modalPanel`, `primaryBtn`, `secondaryBtn`, `textMuted`, `textTitle`, `formLabel`, `emptyPanel`  
   - Used in connector/admin/settings forms (e.g. `connector-detail-page.tsx`, `admin-settings-operational.tsx`, `new-connector-wizard-page.tsx`). Most other screens duplicate similar Tailwind strings inline.

`frontend/src/index.css` is minimal: Tailwind layers, Inter font, `box-sizing`, `.dark .gdc-app-workspace` page background. **No CSS variable design-token sheet**, no `@theme`, no component class namespace.

### 2.3 `frontend/src/components/ui` (only three primitives)

| File | Export | Role |
| --- | --- | --- |
| `card.tsx` | `Card`, `CardHeader`, `CardTitle`, `CardContent` | Styled `<div>`/`<h3>` with `cn()` + gdc dark surfaces |
| `help-tooltip.tsx` | `HelpTooltip` | CSS `group-hover` / `group-focus-within` tooltip; `role="tooltip"`; no Floating UI |
| `help-tooltip-copy.ts` | `HELP_COPY` | Product copy for checkpoints, mapping, protection — **not a primitive** |
| `help-tooltip.test.tsx` | tests | a11y: `aria-describedby`, `title` fallback |
| `resizable-split.tsx` | `ResizableSplit` | Pointer + **keyboard** separator (`role="separator"`, arrow keys, `aria-valuenow`) |

There is **no** shared `Button`, `Input`, `Select`, `Dialog`, `Drawer`, `Tabs`, `Badge`, `Checkbox`, `Radio`, `Popover`, `Menu`, or `Sidebar` under `components/ui`.

### 2.4 Layout / shell (product chrome — keep)

| File | Function | Notes |
| --- | --- | --- |
| `layout/app-shell-layout.tsx` | `AppShellLayout` | Dark class on `<main>`, breadcrumbs, titles, `Outlet` |
| `layout/sidebar.tsx` | `Sidebar`, `NavButton` | DataRelay logo, persona, RBAC-aware `sidebarStructureForRole`, collapse, sign-out |
| `layout/top-header.tsx` | `TopHeader` | Breadcrumb, **RUN** health chip, native search `<input>`, theme toggle |
| `layout/persona-switcher.tsx` | `PersonaSwitcher` | Connector vs governance; `role="group"` |
| `shell/app-shell.tsx` | `AppShell` | Sidebar + header + `.gdc-app-workspace` |
| `shell/status-badge.tsx` | `StatusBadge` | Generic tone badge (`success`/`warning`/`error`/`neutral`/`info`) |
| `shell/dev-validation-badge.tsx` | `DevValidationBadge` | **Product rule:** DEV VALIDATION / E2E visibility — never replace with a generic OSS badge |
| `shell/runtime-chart-card.tsx` | `RuntimeChartCard` | Wraps `ui/card.tsx` for operational charts |
| `shell/table-container.tsx` | `TableContainer` | Scroll + card chrome |

### 2.5 Where primitives actually live (scattered)

Controls are native HTML + duplicated class strings. Representative files:

**Button** — no component. Hundreds of `<button>` with one-off classes. Token aliases: `gdcUi.primaryBtn` / `gdcUi.secondaryBtn` (admin/connectors only).

**Input / Select / Checkbox / Radio** — native `<input>`, `<select>`, `<textarea>`. Shared-ish classes: `gdcUi.input`, `gdcUi.select`; also local `inputCls` in `connectors/schema-form/SchemaFormRenderer.tsx`; native checkboxes/radios in wizard and connector fields.

**Dialog (modal)** — ad-hoc `fixed inset-0` overlays, usually `role="dialog"` + `aria-modal="true"`, **no focus trap, no restore-focus, almost no Escape**. Examples:

- `streams/wizard/wizard-governance-start-modal.tsx` `WizardGovernanceStartModal`
- `templates/template-use-modal.tsx` `TemplateUseModal`
- `templates/template-draft-preview-modal.tsx`
- `settings/admin-settings-page.tsx` (two overlays ~L1015, L1088)
- `settings/admin-settings-operational.tsx` (~L899, L1079)
- `destinations/destinations-management-page.tsx` (~L1314, L1906)
- `streams/stream-edit-wizard-page.tsx` (~L833)
- `streams/stream-runtime-detail-page.tsx` (~L1558)

**Drawer / sheet** — same pattern, right-side `aside`/`div`. Examples:

- `governance/policy-editor-drawer.tsx` `PolicyEditorDrawer` (backdrop `<button>`, `role="dialog"`)
- `governance/governance-investigation-drawer.tsx` `GovernanceInvestigationDrawer` (**no `role="dialog"`** on panel)
- `streams/wizard/wizard-data-protection-drawer.tsx` `WizardDataProtectionDrawer`
- `streams/wizard/request-preview-drawer.tsx` `RequestPreviewDrawer` (uses `ResizableSplit`)
- `destinations/destination-detail-drawer.tsx` (hard-coded `#070f1c` colors, not `gdc-*` tokens)
- `logs/log-detail-drawer.tsx` `LogDetailDrawer` (in-page + overlay from `logs-explorer-page.tsx`)
- `templates/template-preview-panel.tsx`
- `streams/stream-governance-drawer.tsx` — **collapsible in-page rail**, not a modal sheet (keep)

**Popover / menu** — click-outside `mousedown` only:

- `connectors/connector-streams-popover.tsx` `ConnectorStreamsPopover` (`aria-haspopup="dialog"`)
- `streams/wizard/enrichment-add-field-menu.tsx` `EnrichmentAddFieldMenu`
- `streams/wizard/metadata-mapping-menu.tsx` (portal + Escape in this file)
- `streams/wizard/destination-field-chip.tsx` (portal combobox-like chip picker)

**Tooltip** — `HelpTooltip` plus native `title=` on many controls (`StreamRunControlSwitch`, `HealthBadge`).

**Tabs** — custom, incomplete ARIA:

- `streams/stream-detail-tab-nav.tsx` `StreamDetailTabNav` — `role="tab"` **without** `role="tablist"` / `aria-controls`
- `governance/governance-shell.tsx` — `NavLink` tabs (routing, not ARIA tabs)
- `destination-detail-drawer.tsx`, `log-detail-drawer.tsx`, mapping/wizard panels — local tab buttons; some files do use `role="tablist"`

**Badge** — many domain badges, not one primitive:

- `shell/status-badge.tsx` `StatusBadge` (closest generic)
- `runtime/operational-health/health-badge.tsx` `HealthBadge` (score + `HealthLevel`)
- `streams/route-processing/route-processing-status-badge.tsx` (Inherited/Overridden/Mixed + deploy mode)
- `logs/logs-level-badge.tsx` `LevelBadge`
- `connectors/package-completeness-badge.tsx`
- `validation/validation-severity-badge.tsx`
- `streams/wizard/field-importance-badge.tsx`
- `shell/dev-validation-badge.tsx`

**Form validation** — field-level strings, not a form library:

- `SchemaFormRenderer` + `schema-form-types.ts` (`SchemaFormValidationError[]`)
- `TemplateUseModal.onSubmit` required-field `setError`
- Policy editor / admin pages: local `error` state

**Switch** — `streams/stream-run-control-switch.tsx` `StreamRunControlSwitch` (`role="switch"`, scheduler semantics). Do not replace with a generic Switch without keeping start/stop runtime behavior.

**a11y / keyboard / focus (limits):**

- Repo-wide: **no** `focus-trap` / `FocusTrap` / `inert` usage in `frontend/src`.
- `Escape` handlers are rare (`metadata-mapping-menu.tsx`, `destination-field-chip.tsx`); most dialogs/drawers ignore Escape.
- `HelpTooltip` and `ResizableSplit` are the best-local a11y examples.
- `StreamDetailTabNav` is not a complete Tabs widget (no arrow-key roving tabindex).

---

## 3. OSS inventory (implementation-level)

### 3.1 Base UI (`@base-ui/react` 1.7.0)

**What it is:** Headless React components. No Tailwind requirement. Consumer owns CSS.

**Package:** `packages/react/package.json`

- Peers: React 17/18/19  
- Runtime deps: `@floating-ui/react-dom`, `@floating-ui/utils`, `@base-ui/utils`, `use-sync-external-store`, `@babel/runtime`  
- Tree-shakeable subpath exports: `./dialog`, `./drawer`, `./select`, `./menu`, `./tooltip`, `./tabs`, `./checkbox`, `./radio`, `./form`, `./field`, `./input`, `./button`, …

**Key modules (clone):**

| Area | Files / functions |
| --- | --- |
| Button | `packages/react/src/button/Button.tsx` `Button` + `useButton` |
| Input | `packages/react/src/input/` |
| Select | `packages/react/src/select/` (`SelectRoot`, `SelectPopup`, `SelectItem`, …) |
| Checkbox / Radio | `packages/react/src/checkbox/`, `radio/`, `radio-group/` |
| Dialog | `packages/react/src/dialog/root/DialogRoot.tsx` (`modal: true \| false \| 'trap-focus'`), `popup/DialogPopup.tsx` wraps **`FloatingFocusManager`** (initial focus, return focus, Escape tests in `DialogRoot.test.tsx`) |
| Drawer | `packages/react/src/drawer/` (swipe, snap points, `DrawerPopup`) |
| Popover / Menu / Tooltip | `popover/`, `menu/`, `tooltip/` (positioner + floating-ui) |
| Tabs | `packages/react/src/tabs/` |
| Form / Field | `form/Form.tsx` (`validationMode`, `focusFirstInvalid`), `field/` (`FieldRoot`, `FieldError`, `FieldValidity`) |
| Tests | Chromium/jsdom vitest, e2e, **screen-reader Playwright** (`test/screen-reader/`) |

**Tailwind:** Library is unstyled. Monorepo *docs* use Tailwind **4.2.4** (`base-ui/package.json` `devDependencies.tailwindcss`) — **not a consumer constraint**.

**React 19:** First-class (devDeps `react@19.2.8`, peer includes 19). Changelog v1.7.0 includes popup/focus work (Safari/Firefox restore-focus #5093).

### 3.2 Kumo (`@cloudflare/kumo` 2.12.0)

**What it is:** Cloudflare **styled** design system **on top of Base UI**. Not a headless kit.

**Package:** `packages/kumo/package.json`

- Deps: `@base-ui/react` `^1.6.0`, `motion`, `shiki`, `react-day-picker`, `cnfast`, `d3-geo`  
- Optional peers: `echarts` `^6`, `zod` `^4`  
- Required peer: `@phosphor-icons/react` (not lucide)  
- Styles: `./styles/tailwind` → `src/styles/kumo.css` + **`@theme` in `kumo-binding.css`** (Tailwind **v4 only**)  
- Catalog: `pnpm-workspace.yaml` `tailwindcss: ^4.1.17`  
- Dark mode: **`[data-mode="dark"]`**, not `class="dark"` (`kumo-binding.css`, README standalone CSS)  
- README: **must** `@import "tailwindcss"` (v4) **and** `@source` `node_modules/@cloudflare/kumo/dist/**`  
- Components use Tailwind v4 syntax, e.g. `bg-(--kumo-button-emphasis-bg)` in `components/button/button.tsx`  
- Primitives are **re-exports**: `src/primitives/dialog.ts` is `export * from "@base-ui/react/dialog"`  
- Sidebar: `components/sidebar/sidebar.tsx` (~2600 lines) — Cloudflare IA, Phosphor, Kumo tokens  
- Chart: `components/chart/EChart.tsx` / `TimeseriesChart.tsx` — **Apache ECharts**, conflicts with Data Relay **recharts**  
- Tests: `vp test` unit + browser (`button`, `dialog`, `sidebar`, `tabs`, …)

**Activity:** Very active (commits 2026-08-24–28 on pagination, dialog position, select popup, table rows).

### 3.3 shadcn/ui (registry + CLI 4.19.0)

**What it is:** Copy-paste generators. Two **bases** in `apps/v4/registry/`:

| Base | Path | Primitive engine |
| --- | --- | --- |
| Default New York v4 | `apps/v4/registry/new-york-v4/ui/` | **`radix-ui`** (`dialog.tsx` `Dialog as DialogPrimitive from "radix-ui"`), Drawer via **`vaul`**, Button `Slot` from radix, Form via **react-hook-form** |
| Base UI style | `apps/v4/registry/bases/base/ui/` | **`@base-ui/react/*`** (`dialog.tsx` `DialogPrimitive` from `@base-ui/react/dialog`; `sheet.tsx` Dialog-as-sheet; `drawer.tsx` `@base-ui/react/drawer`; `dropdown-menu.tsx` `@base-ui/react/menu`) |

**Tailwind:** Current Vite template (`templates/vite-app/package.json`) is **Tailwind `^4`** + `@tailwindcss/vite`. Root workspace still lists `tailwindcss` `^3.4.18` for older tooling, but **new shadcn apps are Tailwind 4**. Base-style components use `cn-*` class names intended for a Tailwind 4 theme stylesheet — **not drop-in on Data Relay 3.4 without rewriting classes to `gdc-*` utilities**.

**React 19:** `apps/v4/package.json` `react: 19.2.3`; CLI fixtures include `project-npm-react19`.

**Resizable:** `new-york-v4/ui/resizable.tsx` wraps `react-resizable-panels` — different from Data Relay’s custom `ResizableSplit`.

---

## 4. Compatibility answers (called out)

### Tailwind 3.4 compatibility

| Library | Compatible with Data Relay Tailwind **3.4.17**? |
| --- | --- |
| **Base UI** | **Yes.** Unstyled. No Tailwind peer. |
| **Kumo** | **No as a styled dependency.** Requires Tailwind **v4** `@theme`, `@source`, `@import "tailwindcss"`, `bg-(--token)` syntax, and `data-mode="dark"`. Forcing Kumo would mean a **Tailwind 4 migration** of the whole frontend (PostCSS plugin model, `tailwind.config.js` → CSS-first config). |
| **shadcn New York (radix)** | **Partial.** Utility classes like `size-9`, `has-[>svg]` exist in 3.4, but animation plugins (`tw-animate-css`), `bg-background` CSS variables, and `data-[state=open]:animate-in` assume shadcn’s token CSS. Not a one-file paste. |
| **shadcn Base style** | **No as-is.** `cn-button-variant-default` etc. need the v4 theme layer. **Pattern** (compound parts wrapping Base UI) is still usable if classes are rewritten to `gdcUi` / CVA. |

**Recommendation:** Stay on Tailwind **3.4** for this foundation pass. Do **not** take Kumo’s Tailwind 4 dependency as a reason to upgrade CSS infrastructure.

### React 19 compatibility

All three support React 19. Data Relay is already on React 19. **No blocker.**

### Kumo Tailwind 4 dependency impact

If Data Relay added `@cloudflare/kumo` today:

1. Replace `tailwindcss@3.4` + `autoprefixer` PostCSS with `@tailwindcss/vite` / CSS `@import "tailwindcss"`.  
2. Rewrite `tailwind.config.js` `gdc.*` colors into `@theme`.  
3. Change dark mode from `.dark` (`AppShellLayout` `isDark ? 'dark …'`) to `[data-mode="dark"]` **or** maintain two systems.  
4. Add `@source` for `node_modules/@cloudflare/kumo/dist`.  
5. Pull Phosphor icons (or dual icon sets with lucide).  
6. Risk: Kumo `@layer` and `data-kumo-component` cursor rules vs hundreds of existing Data Relay buttons.

**Impact: high. Reject Kumo as a direct dependency.**

### Can Base UI sit under Data Relay styling?

**Yes.** That is the intended use. Wrap `Dialog.Root` / `Dialog.Popup` with `gdcUi.modalPanel` / `dark:bg-gdc-elevated` the same way `Card` already wraps a `div`. Kumo and shadcn-base prove the wrapping pattern; Data Relay should wrap with **GDC tokens**, not Cloudflare or shadcn default palettes.

### What to keep vs replace vs never migrate

See §7–§9.

---

## 5. Per-component matrix

Legend — **Adoption:** `DIRECT_DEPENDENCY` | `SOURCE_ADAPTATION` | `REFERENCE_PATTERN` | `REJECT`  
**Priority:** `P0` | `P1` | `P2` | `LATER` | `REJECT`

| Component | Data Relay (file / function) | OSS source of truth | Adoption | Priority | Notes |
| --- | --- | --- | --- | --- | --- |
| **Button** | No primitive; `gdcUi.primaryBtn`/`secondaryBtn`; native `<button>` everywhere | Base UI `Button.tsx`; shadcn-base `bases/base/ui/button.tsx` (CVA + Base UI); Kumo `components/button/button.tsx` | **SOURCE_ADAPTATION** (thin CVA wrapper over native or `@base-ui/react/button`) | **P1** | Use unused `class-variance-authority`. Do not import Kumo variants (`kumo-button-emphasis-*`). |
| **Input** | `gdcUi.input`; `SchemaFormRenderer` `inputCls`; `TopHeader` search input | Base UI `input/`; shadcn-base `input.tsx`; Kumo `components/input/input.tsx` (Field-coupled) | **SOURCE_ADAPTATION** | **P1** | Keep native `<input>` styling; optional Base UI Input for consistency. |
| **Select** | Native `<select>` + `gdcUi.select` | Base UI `select/` (listbox popup); shadcn-base `select.tsx`; Kumo `components/select/select.tsx` | **SOURCE_ADAPTATION** (custom listbox **only** where search/typeahead needed) | **P2** | Native `<select>` is fine for admin enums. Do not mass-replace every `<select>` in one PR. |
| **Checkbox** | Native `type="checkbox"` (wizard, schema form, policy) | Base UI `checkbox/`; shadcn-base `checkbox.tsx` | **SOURCE_ADAPTATION** | **P2** | Optional visual indicator; native is accessible. |
| **Radio** | Native `type="radio"` (few: `step-data-protection.tsx`, `step-done.tsx`, …) | Base UI `radio` + `radio-group` | **SOURCE_ADAPTATION** | **P2** | Same as checkbox. |
| **Dialog** | Many `fixed inset-0` modals (list in §2.5) | Base UI `DialogRoot` + `DialogPopup` + `FloatingFocusManager`; tests Escape/focus | **DIRECT_DEPENDENCY** `@base-ui/react/dialog` + **SOURCE_ADAPTATION** styled `DialogContent` | **P0** | Highest a11y gap. |
| **Drawer / Sheet** | Policy/governance/wizard/destination/log drawers | Prefer Base UI **Dialog as side sheet** (shadcn-base `sheet.tsx`) for **desktop right drawers**. Base UI `drawer/` is swipe/mobile-oriented. Kumo has no separate Sheet. shadcn radix uses `vaul` | **DIRECT_DEPENDENCY** (Dialog) **SOURCE_ADAPTATION** Sheet wrapper | **P0** | Do **not** use vaul for operator desktop drawers. |
| **Popover** | `ConnectorStreamsPopover`, mapping menus | Base UI `popover/` | **DIRECT_DEPENDENCY** | **P2** | Replace click-outside-only popovers incrementally. |
| **Tooltip** | `HelpTooltip` (CSS); `title=` | Base UI `tooltip/`; Kumo `components/tooltip/tooltip.tsx` | **SOURCE_ADAPTATION** for overflow/collision; **keep** `HelpTooltip` + `HELP_COPY` as product help | **P1** | CSS tooltips clip/overflow; Floating UI fixes that. |
| **Dropdown / Menu** | `EnrichmentAddFieldMenu`, header icon buttons | Base UI `menu/`; shadcn-base `dropdown-menu.tsx` | **DIRECT_DEPENDENCY** | **P1** | Keyboard (arrow/typeahead) missing today. |
| **Tabs** | `StreamDetailTabNav`, governance NavLinks, drawer tabs | Base UI `tabs/`; Kumo `components/tabs/tabs.tsx` (segmented) | **SOURCE_ADAPTATION** for **in-page** tablists only | **P2** | Do **not** replace `GovernanceShell` `NavLink`s with ARIA tabs (they are routes). |
| **Badge** | `StatusBadge` + many domain badges | Kumo `badge.tsx`; shadcn `badge.tsx` | **REFERENCE_PATTERN** for generic `StatusBadge` only | **P2** | Domain badges stay custom. |
| **Card / Surface** | `ui/card.tsx`; `gdcUi.cardShell`; Kumo `Surface`→`LayerCard` | shadcn `card.tsx`; Kumo `surface.tsx` | **KEEP** Data Relay `Card` | **LATER** | Already a primitive. Optional Header/Footer alignment. |
| **Form validation** | `SchemaFormRenderer`, local `error` state | Base UI `Form` + `Field`; shadcn radix `form.tsx` = react-hook-form | **REFERENCE_PATTERN** (Field error association) | **LATER** | Do not introduce react-hook-form across the app. Do not wrap connector schema in RHF. |
| **Sidebar** | `layout/sidebar.tsx` | Kumo `sidebar.tsx`; shadcn `sidebar.tsx` (cookie, `SidebarProvider`, Cmd+B) | **REJECT** replacement | **REJECT** | Product nav + persona + RBAC. Pattern-only: mobile sheet for collapsed nav. |
| **Resizable** | `ui/resizable-split.tsx` | shadcn `react-resizable-panels` | **KEEP** | **REJECT** migrate | Already keyboard-accessible; used by request-preview drawer. |
| **Switch** | `StreamRunControlSwitch` | Base UI `switch/` | **REJECT** as drop-in | **REJECT** | Encodes stream scheduler start/stop. |
| **Charts** | `recharts` + `RuntimeChartCard` | Kumo ECharts | **REJECT** | **REJECT** | Dual chart stacks + P0 metric UIs. |
| **Kumo whole library** | — | `@cloudflare/kumo` | **REJECT** | **REJECT** | Tailwind 4 + Phosphor + Cloudflare tokens + echarts. |
| **Radix / default shadcn** | — | `radix-ui`, `vaul` | **REJECT** as parallel primitive engine | **REJECT** | Duplicate of Base UI; extra a11y stack. |

---

## 6. The 15 audit questions (file/function level)

### 1. Where implemented in Data Relay?

See §2. There is **no** central primitive kit. Closest: `frontend/src/lib/gdc-ui-tokens.ts` (`gdcUi`), `frontend/src/lib/utils.ts` (`cn`), `frontend/src/components/ui/{card,help-tooltip,resizable-split}.tsx`, `frontend/src/components/layout/sidebar.tsx`, `frontend/src/components/shell/*`. Overlays are per-feature files listed in §2.5.

### 2. Structure and limits?

- **Structure:** Tailwind 3.4 class strings + optional `gdcUi` tokens; product pages own markup.  
- **Limits:** Duplicated button/input chrome; dialogs/drawers without focus trap/Escape; incomplete tab ARIA; tooltip clipping; CVA unused; no portal layering standard (z-20 vs z-50 vs z-[60]); destination drawer uses hardcoded hex, diverging from `gdc-*`.  
- **Does not limit:** Stream→Route→Destination architecture (layout only). Runtime metrics live in domain components, not `components/ui`.

### 3. Which OSS files/modules/functions?

**Adopt as dependency:** `@base-ui/react` modules:

- `dialog`: `DialogRoot`, `DialogPopup`, `DialogBackdrop`, `DialogTitle`, `DialogClose`  
- `menu`: `Menu.Root`, `Menu.Trigger`, `Menu.Popup`, `Menu.Item`  
- `popover`, `tooltip`, `select` (opt-in), `tabs` (opt-in), `checkbox`/`radio` (opt-in)

**Adapt from (copy pattern, rewrite styles):**  
`/tmp/oss-audit-clones/ui/apps/v4/registry/bases/base/ui/{button,dialog,sheet,dropdown-menu,tooltip,input,tabs}.tsx` — replace `cn-*` with CVA + `gdcUi`.

**Reference only:** Kumo `components/dialog/dialog.tsx` (size variants, AlertDialog split), `packages/kumo/src/primitives/*.ts` (re-export map).

**Do not copy:** Kumo `sidebar.tsx`, `chart/EChart.tsx`, `styles/kumo-binding.css` `@theme`, Phosphor icons.

### 4. What OSS reduces/improves?

- **Focus trap, Escape, scroll lock, restore focus** — Base UI `DialogPopup` + `FloatingFocusManager` vs 15+ custom overlays.  
- **Menu keyboard model** vs `mousedown` outside-click menus.  
- **Collision-aware tooltips/popovers** vs CSS `group-hover`.  
- **Field/Form `focusFirstInvalid`** (`Form.tsx`) as a pattern for schema forms.  
- **Does not reduce** domain complexity (routes, checkpoints, governance RBAC).

### 5. Duplication with Data Relay?

- `cn()` ≈ Kumo `cnfast` / shadcn `cn` — **keep Data Relay** `lib/utils.ts`.  
- `Card` ≈ shadcn Card — **keep** GDC styling.  
- `StatusBadge` ≈ Kumo Badge variants — keep tones mapped to ops language.  
- Sidebar collapse ≈ Kumo/shadcn sidebar — **keep Data Relay** implementation.  
- `ResizableSplit` ≈ shadcn resizable — **keep**.  
- Overlay markup duplicated **internally** across Data Relay files — OSS dialog/sheet **collapses that duplication**.

### 6. Direct dependency?

**Yes, one:** `@base-ui/react` (pin **1.7.x** to match published API; Kumo currently `^1.6.0` — prefer 1.7 for Data Relay).

**No:** `@cloudflare/kumo`, `radix-ui`, `vaul`, `react-hook-form`, `echarts`, `@phosphor-icons/react`, `motion` (Kumo).

**Optional later:** none required for P0.

### 7. Code adaptation?

**Yes:** styled wrappers under `frontend/src/components/ui/` (new files in a future implementation, not this audit):

- `dialog.tsx` — Base UI parts + `gdcUi.modalPanel`  
- `sheet.tsx` — Base UI Dialog, `side="right"`, classes from policy drawer (`max-w-lg`, `border-l`, `dark:bg-gdc-card`)  
- `button.tsx` — CVA from `gdcUi.primaryBtn` / `secondaryBtn`  
- `dropdown-menu.tsx`, `tooltip.tsx`

Adapt shadcn-base **structure** (Root/Trigger/Portal/Popup), not its Tailwind 4 class names or `IconPlaceholder`.

### 8. Algorithm / pattern only?

- Focus restoration and modal `inert` behavior — **do not reimplement**; take from Base UI.  
- Kumo `resolveVariant` — unnecessary if using CVA.  
- shadcn `SidebarProvider` cookie + Cmd+B — optional pattern; Data Relay already has collapse state in `AppShellLayout`.  
- Base UI Form `focusFirstInvalid` — pattern for `SchemaFormRenderer` later.

### 9. Connector Harvester?

**N/A.** UI primitives do not harvest connectors. No overlap.

### 10. License usable?

**Yes.** MIT for Base UI, Kumo, and shadcn. Retain notices if copying shadcn-base wrapper files. Floating UI (Base UI dependency) is MIT.

### 11. Architecture invasion?

| Choice | Invasion |
| --- | --- |
| `@base-ui/react` + GDC wrappers | **Low.** Headless. No stream/runtime model. No second app shell. |
| shadcn CLI full init (Tailwind 4, CSS variables `--background`, radix) | **Medium–high.** Fights `gdc-*` tokens and Vite 5 / TW 3.4. |
| `@cloudflare/kumo` | **High.** Tailwind 4, `data-mode`, Phosphor, Kumo `@theme`, optional ECharts vs recharts, `data-kumo-component` global CSS. Visual language becomes Cloudflare, not Data Relay. |
| Replacing `Sidebar` / wizard / runtime pages | **Unacceptable.** Product IA and P0 metrics. |

Does **not** introduce a parallel pipeline runtime or duplicate Streams.

### 12. Integration points (exact files)

**Add (future work):** `frontend/package.json` dependency `@base-ui/react`; new wrappers in `frontend/src/components/ui/`.

**First consumers (P0 overlays):**

- `frontend/src/components/streams/wizard/wizard-governance-start-modal.tsx`  
- `frontend/src/components/templates/template-use-modal.tsx`  
- `frontend/src/components/templates/template-draft-preview-modal.tsx`  
- `frontend/src/components/governance/policy-editor-drawer.tsx`  
- `frontend/src/components/governance/governance-investigation-drawer.tsx`  
- `frontend/src/components/streams/wizard/wizard-data-protection-drawer.tsx`  
- `frontend/src/components/streams/wizard/request-preview-drawer.tsx`  
- `frontend/src/components/destinations/destination-detail-drawer.tsx`  
- `frontend/src/components/settings/admin-settings-page.tsx`  
- `frontend/src/components/settings/admin-settings-operational.tsx`  
- `frontend/src/components/destinations/destinations-management-page.tsx`

**Token / layout (do not replace, do consume wrappers):**

- `frontend/src/lib/gdc-ui-tokens.ts`  
- `frontend/tailwind.config.js`  
- `frontend/src/components/layout/app-shell-layout.tsx`  
- `frontend/src/components/layout/sidebar.tsx`  
- `frontend/src/components/shell/app-shell.tsx`

**Tests to extend when implementing (not modified now):** `help-tooltip.test.tsx`; overlay tests such as `policy-editor-drawer.test.tsx`, `template-use-modal.test.tsx`, `request-preview-drawer.test.tsx`, `wizard-governance` tests.

### 13. What NOT to apply?

- Kumo as the Data Relay design system  
- Tailwind 4 upgrade as a prerequisite for primitives  
- Radix + Base UI **together**  
- `vaul` bottom-sheet drawers for operator side panels  
- shadcn `Form` / react-hook-form app-wide  
- Kumo/shadcn **Sidebar** replacing `layout/sidebar.tsx`  
- Kumo **Chart/ECharts** replacing recharts operational charts  
- Phosphor as a second default icon set  
- Replacing `StreamRunControlSwitch`, `DevValidationBadge`, `HealthBadge`, `RouteProcessingStatusBadge`, `SchemaFormRenderer`, `WizardStepper`  
- Any change to Stream Runtime, snapshot APIs, E2E EPS, or AI Gateway UI  
- Parallel “Kumo app shell” or duplicate Streams views

### 14. Difficulty and regression risk?

| Workstream | Difficulty | Regression risk | Why |
| --- | --- | --- | --- |
| Add `@base-ui/react` + Dialog/Sheet wrappers | Medium | Medium | Many `data-testid` overlays; Playwright/smoke may click backdrop/focus |
| Migrate P0 modals/drawers one-by-one | Medium | **High** if big-bang | Wizard, policy, destination, admin confirmations |
| Button/Input CVA + gradual class swap | Medium | Medium | Visual diffs on hundreds of buttons |
| Menu/Tooltip | Low–medium | Low–medium | Fewer call sites |
| Tabs primitive on `StreamDetailTabNav` | Low | Medium | URL `?tab=` must stay |
| Replace Sidebar | High | **Critical** | Navigation, persona, RBAC |
| Adopt Kumo / Tailwind 4 | Very high | **Critical** | Entire visual + build pipeline |
| Form library | High | High | Connector auth schema + wizard |

Mitigation: wrappers first, migrate overlays **file-by-file**, keep `data-testid` and existing copy. Do not change Runtime.

### 15. Priority?

**P0 — overlay accessibility (Dialog + Sheet)**  
Operator product with many blocking dialogs; currently no trap/Escape.

**P1 — Button, Input, Menu, Tooltip**  
Stops class-string drift; uses already-purchased CVA; menus/tooltips fail keyboard/overflow.

**P2 — Select (custom), Checkbox/Radio polish, Tabs (in-page), generic Badge, Popover**

**LATER — Field/Form association, Combobox, Toast** (if a toast system is introduced)

**REJECT — Kumo library, Radix stack, Sidebar/chart/runtime/domain badge replacement, Tailwind 4-for-Kumo**

---

## 7. Recommended adoption sequence (guidance only)

1. **Depend on `@base-ui/react@1.7.x` only.**  
2. **Add GDC-styled Dialog + Sheet** in `components/ui`, tokens from `gdcUi` + `tailwind.config.js`.  
3. **Migrate overlays** in §12, starting with `WizardGovernanceStartModal` and `PolicyEditorDrawer` (clear dialog vs drawer split).  
4. **Add CVA `Button` / `Input`**; point `gdcUi.primaryBtn` at the same variants.  
5. **Menu + Tooltip** for enrichment/mapping/header.  
6. Leave **Sidebar, AppShell, domain badges, SchemaForm, Runtime charts, ResizableSplit, Help copy**.

Kumo’s value to Data Relay is **proof** that Base UI + a token layer works in a serious ops UI — not that Cloudflare’s tokens should be imported.

---

## 8. Architecture risk summary

| Risk | Rating | Control |
| --- | --- | --- |
| Second primitive engine (Radix + Base UI) | High if both added | **Reject Radix** |
| Tailwind 4 + token rewrite | High | Stay on 3.4; Base UI is TW-agnostic |
| Cloudflare visual takeover | High if Kumo adopted | **Reject Kumo dependency** |
| Accidental Runtime / snapshot changes | High if pages rewritten | UI wrappers only; Runtime-First |
| Duplicate Streams / extra runtime UI | High if “new shell” | Keep `AppShellLayout`; One Stream → Routes → Destinations |
| E2E / Playwright overlay selectors | Medium | Preserve `data-testid`; migrate per file |
| Icon set split (lucide vs phosphor) | Medium | Keep lucide-react |

**Overall recommended path architecture risk: Low** (Base UI headless + existing GDC tokens).

---

## 9. Never-migrate list

Do **not** migrate, replace, or restyle-via-OSS these (product or charter):

1. **Stream Runtime behavior** and P0 metrics UI: EPS, Success Rate, Checkpoint, Route Health, Delivery Health (`Stream-Runtime-Rule`, `Runtime-First-Rule`).  
2. **Runtime Snapshot** consumption patterns — no new duplicate runtime queries (`Snapshot-Rule`).  
3. **DEV VALIDATION / DEV E2E** streams, throughput 5–20 EPS, `DevValidationBadge` (`Dev-Validation-Rule`).  
4. **Route architecture:** one Stream, many Routes, many Destinations — no parallel stream copies (`Route-Architecture-Rule`).  
5. **`layout/sidebar.tsx` / `AppShellLayout` / `PersonaSwitcher` / RBAC nav** (`config/app-navigation`, `governance-rbac`).  
6. **`StreamRunControlSwitch`** — scheduler start/stop, not a generic Switch.  
7. **Domain badges:** `HealthBadge`, `RouteProcessingStatusBadge`, `LevelBadge`, package completeness, field importance.  
8. **`SchemaFormRenderer`** connector auth schema (domain validation).  
9. **`WizardStepper` + `wizard-step-gates`** (product wizard, not a Tabs demo).  
10. **`HELP_COPY` / checkpoint help semantics** — copy is product, not shadcn lorem.  
11. **`ResizableSplit`** unless a proven defect appears.  
12. **recharts operational charts** — do not switch to Kumo ECharts.  
13. **AI Gateway pages** (`frontend/src/components/ai-gateway/**`, `runtime/ai-gateway-page.tsx`) — out of scope.  
14. **Full Matrix / QA Lab / production compose / seeder** — out of scope for this audit.  
15. **Kumo `data-kumo-component` CSS, `@theme` kumo tokens, Phosphor, `data-mode="dark"`.**  
16. **shadcn default radix + vaul + react-hook-form stack** as the Data Relay foundation.

---

## 10. Keep (custom Data Relay)

| Keep | Reason |
| --- | --- |
| `gdc` Tailwind tokens + `gdcUi` | Product dark SaaS language |
| `cn()` in `lib/utils.ts` | Already correct |
| `ui/card.tsx` | Thin and on-token |
| `HelpTooltip` + `HELP_COPY` | Product help; optional later Floating UI |
| `ResizableSplit` | Keyboard + persistence |
| Sidebar / header / app shell | Product chrome |
| `StatusBadge` as generic tone | Ops-neutral; extend rather than replace |
| All domain badges and switches | Semantics ≠ UI kit |
| lucide-react | Already standard |
| recharts | Already standard |

**Replace (incrementally):** ad-hoc Dialog/Drawer markup; outside-click menus; unstyled native controls that ignore `gdcUi`.

---

## 11. Evidence index (paths)

**Data Relay**

- `frontend/package.json`  
- `frontend/tailwind.config.js`  
- `frontend/postcss.config.js`  
- `frontend/src/index.css`  
- `frontend/src/lib/utils.ts`  
- `frontend/src/lib/gdc-ui-tokens.ts`  
- `frontend/src/components/ui/card.tsx`  
- `frontend/src/components/ui/help-tooltip.tsx`  
- `frontend/src/components/ui/resizable-split.tsx`  
- `frontend/src/components/layout/{app-shell-layout,sidebar,top-header,persona-switcher}.tsx`  
- `frontend/src/components/shell/{app-shell,status-badge,dev-validation-badge,runtime-chart-card,table-container}.tsx`  
- Overlay files listed in §2.5 and §12  

**Base UI**

- `packages/react/package.json`  
- `packages/react/src/dialog/root/DialogRoot.tsx`  
- `packages/react/src/dialog/popup/DialogPopup.tsx` (`FloatingFocusManager`)  
- `packages/react/src/form/Form.tsx`  
- `LICENSE`, `CHANGELOG.md` (v1.7.0)  

**Kumo**

- `packages/kumo/package.json`  
- `pnpm-workspace.yaml` (Tailwind `^4.1.17`)  
- `packages/kumo/README.md` (`@source`, `@theme` order, `data-mode`)  
- `packages/kumo/src/styles/kumo-binding.css`  
- `packages/kumo/src/primitives/dialog.ts`  
- `packages/kumo/src/components/{button,dialog,sidebar,badge,input,tabs,chart}/**`  
- `LICENSE`  

**shadcn/ui**

- `package.json`, `packages/shadcn/package.json` (CLI 4.19.0)  
- `apps/v4/package.json` (React 19, Tailwind 4, `@base-ui/react` 1.6.0 **and** `radix-ui`)  
- `apps/v4/registry/new-york-v4/ui/{button,dialog,drawer,sheet,sidebar,form,resizable}.tsx`  
- `apps/v4/registry/bases/base/ui/{button,dialog,sheet,drawer,dropdown-menu,tooltip,input,tabs,checkbox}.tsx`  
- `templates/vite-app/package.json` (Tailwind 4)  
- `LICENSE.md`  

---

## 12. One-line verdict

**Use Base UI as the only headless dependency, style it with existing GDC Tailwind 3.4 tokens (and unused CVA), adapt shadcn’s Base-UI wrapper shapes — and reject Kumo, Radix, vaul, and any Tailwind 4 design-system import.**
