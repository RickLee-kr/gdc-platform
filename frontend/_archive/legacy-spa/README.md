# Legacy single-page SPA (archived)

Pre–App Router monolith UI sections and helpers removed from the production
import chain (`main.tsx` → `App.tsx`). Not included in the Vite build graph.

Archived on repository cleanup; do not import from `src/` without restoring
into the active tree.

## Contents

- `components/*Section.tsx` — tabbed legacy workspace UI
- `observabilityUi.tsx`, `runtimeQuery.ts`, `runtimeTypes.ts`
- `hooks/useDirtyState.ts`, `hooks/useRuntimeUiState.ts`
- `utils/*` — legacy runtime/connector helpers
- `jsonUtils.ts`, `utils/runtimeMessages.ts` — only used by the legacy cluster
- Replaced screens: `destinations-overview-page.tsx`
- Unused shell/ui: `dashboard-card`, `header`, `section-container`, `badge`
