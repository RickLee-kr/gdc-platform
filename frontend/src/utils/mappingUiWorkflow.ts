import type { MappingUIConfigResponse } from '../api/types/gdcApi'
import type { StreamWorkflowInput } from './streamWorkflow'

/** Derive explicit workflow flags from persisted mapping UI config (DB-backed). */
export function workflowOverridesFromMappingUi(cfg: MappingUIConfigResponse | null | undefined): Partial<StreamWorkflowInput> {
  if (!cfg) return {}

  const mappingPersisted = Boolean(cfg.mapping?.exists && Object.keys(cfg.mapping.field_mappings ?? {}).length > 0)

  const enrichmentPersisted = Boolean(
    cfg.enrichment?.exists &&
      (cfg.enrichment.enabled || Object.keys(cfg.enrichment.enrichment ?? {}).length > 0),
  )

  const connectorLinked = cfg.source_id > 0

  const persistedRoutesCount = cfg.routes?.length ?? 0
  const enabledDeliveryRoute = Boolean(
    cfg.routes?.some((r) => Boolean(r.route_enabled && r.destination_enabled)),
  )

  return {
    connectorLinked,
    mappingPersisted,
    enrichmentPersisted,
    apiTestDone: mappingPersisted,
    persistedRoutesCount,
    enabledDeliveryRoute,
    hasSaved: true,
    sourceType: cfg.source_type ?? null,
  }
}
