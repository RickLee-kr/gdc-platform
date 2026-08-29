# Wave 1 W1 Overlay Inventory

Inventory performed on `oss-fit/w1-base-ui-dialog-sheet` at commit `6903823` before the remaining migration batches.

## Migrated overlays

The following 19 feature components were migrated to the shared Data Relay `Dialog` or `Sheet` wrappers. Existing state, callbacks, test IDs, visual sizing, and operator-facing copy were retained.

| Classification | Component |
| --- | --- |
| DIALOG | `components/streams/wizard/wizard-governance-start-modal.tsx` |
| DIALOG | `components/connectors/marketplace/marketplace-upload-dialog.tsx` |
| SHEET/DRAWER | `components/governance/policy-editor-drawer.tsx` |
| DIALOG | `components/templates/template-use-modal.tsx` |
| DIALOG | `components/templates/template-draft-preview-modal.tsx` |
| SHEET/DRAWER | `components/templates/template-preview-panel.tsx` |
| DIALOG | `components/settings/admin-settings-page.tsx` (user and system overlays) |
| DIALOG | `components/settings/admin-settings-operational.tsx` (retention and alert overlays) |
| DIALOG | `components/destinations/destinations-management-page.tsx` (create/edit and delete overlays) |
| SHEET/DRAWER | `components/destinations/destination-detail-drawer.tsx` |
| DIALOG | `components/connectors/marketplace/marketplace-package-detail.tsx` |
| DIALOG | `components/connectors/marketplace/marketplace-ai-builder.tsx` |
| SHEET/DRAWER | `components/streams/wizard/wizard-data-protection-drawer.tsx` |
| SHEET/DRAWER | `components/streams/wizard/request-preview-drawer.tsx` |
| DIALOG | `components/streams/stream-runtime-detail-page.tsx` (backfill confirmation) |
| SHEET/DRAWER | `components/streams/stream-governance-drawer.tsx` (mobile sheet) |
| DIALOG | `components/streams/stream-edit-wizard-page.tsx` (delete confirmation) |
| SHEET/DRAWER | `components/logs/logs-explorer-page.tsx` (log detail host) |
| SHEET/DRAWER | `components/governance/governance-investigation-drawer.tsx` |

## Intentionally not migrated

These components are not modal or drawer surfaces. Replacing them with a modal primitive would change interaction semantics, positioning, or keyboard behavior.

| Classification | Component | Reason |
| --- | --- | --- |
| INTENTIONALLY_CUSTOM | `components/streams/wizard/destination-field-chip.tsx` | Anchored field-picker popover with listbox-style selection and custom positioning. |
| NOT_A_MODAL | `components/streams/sensitive-findings-panel.tsx` | Inline protection-mode confirmation panel inside the findings table. |
| INTENTIONALLY_CUSTOM | `components/connectors/connector-streams-popover.tsx` | Inline anchored connector stream summary popover, not a blocking surface. |

Other `fixed`, portal, menu, and expandable-panel matches were reviewed as non-modal UI (menus, field pickers, inline panels, or responsive presentation layers) and were not overlay migration targets.

