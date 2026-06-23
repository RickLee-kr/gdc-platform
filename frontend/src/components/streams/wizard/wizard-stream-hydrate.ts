import { fetchConnectorById } from '../../../api/gdcConnectors'
import { fetchStreamMappingUiConfig } from '../../../api/gdcRuntime'
import { fetchStreamById } from '../../../api/gdcStreams'
import type { MappingUIConfigResponse, StreamRead } from '../../../api/types/gdcApi'
import { resolveStreamEndpointPath } from '../../../utils/streamHttpConfigFromStreamRead'
import { UNMAPPED_FIELDS_POLICY_KEY } from '../../../utils/advancedTransformConfig'
import type { MappingMode } from '../../../types/advancedTransform'
import { DEFAULT_MESSAGE_PREFIX_TEMPLATE, defaultMessagePrefixEnabled } from '../../../utils/messagePrefixDefaults'
import { normalizeWizardEnrichmentRules } from './enrichment-rules-model'
import {
  buildInitialState,
  DEFAULT_ROUTE_PROCESSING_INHERIT,
  normalizeWizardDestinations,
  wizardConnectorPatchFromApi,
  type StreamConfigHeaderRow,
  type WizardMappingRow,
  type WizardRouteDraft,
  type WizardState,
} from './wizard-state'

function kvRowsFromRecord(raw: Record<string, unknown> | undefined, prefix: string): StreamConfigHeaderRow[] {
  if (!raw || typeof raw !== 'object') return []
  return Object.entries(raw).map(([key, value], index) => ({
    id: `${prefix}-${index}`,
    key,
    value: String(value ?? ''),
  }))
}

function stripJsonPathPrefix(path: string | null | undefined): string {
  const trimmed = String(path ?? '').trim()
  if (!trimmed) return ''
  return trimmed.startsWith('$.') ? trimmed.slice(2) : trimmed
}

function mappingRowsFromFieldMappings(fieldMappings: Record<string, unknown>): WizardMappingRow[] {
  const rows: WizardMappingRow[] = []
  let index = 0
  for (const [outputField, sourcePath] of Object.entries(fieldMappings)) {
    if (outputField === 'transform_rules' || outputField === 'mapping_mode' || outputField === UNMAPPED_FIELDS_POLICY_KEY) {
      continue
    }
    if (typeof sourcePath !== 'string' || !sourcePath.trim()) continue
    rows.push({
      id: `map-${index++}`,
      outputField,
      sourceJsonPath: sourcePath.trim(),
      origin: 'manual',
    })
  }
  return rows
}

function mappingModeFromFieldMappings(fieldMappings: Record<string, unknown>): MappingMode {
  const mode = fieldMappings.mapping_mode
  if (mode === 'full_event_jsonata') return 'full_event_jsonata'
  if (mode === 'full_event_regex') return 'full_event_regex'
  return 'basic_jsonpath'
}

function normalizeFailurePolicy(raw: string): WizardRouteDraft['failurePolicy'] {
  const upper = raw.toUpperCase()
  if (upper === 'PAUSE_STREAM_ON_FAILURE') return 'PAUSE_STREAM_ON_FAILURE'
  if (upper === 'RETRY_AND_BACKOFF') return 'RETRY_AND_BACKOFF'
  if (upper === 'DISABLE_ROUTE_ON_FAILURE') return 'DISABLE_ROUTE_ON_FAILURE'
  return 'LOG_AND_CONTINUE'
}

function routeDraftsFromMappingUi(mapping: MappingUIConfigResponse): WizardState['destinations'] {
  const destinationKindsById: Record<number, string> = {}
  const messagePrefixEnabledByDestinationId: Record<number, boolean> = {}
  const routeDrafts: WizardRouteDraft[] = (mapping.routes ?? []).map((route) => {
    destinationKindsById[route.destination_id] = route.destination_type ?? ''
    const fc = route.formatter_config ?? {}
    messagePrefixEnabledByDestinationId[route.destination_id] =
      typeof fc.message_prefix_enabled === 'boolean'
        ? fc.message_prefix_enabled
        : defaultMessagePrefixEnabled(route.destination_type ?? '')
    return {
      key: `route-${route.route_id}`,
      destinationId: route.destination_id,
      enabled: route.route_enabled,
      failurePolicy: normalizeFailurePolicy(route.failure_policy),
      rateLimitJson:
        route.route_rate_limit && typeof route.route_rate_limit === 'object'
          ? { ...(route.route_rate_limit as Record<string, unknown>) }
          : {},
      inherit: { ...DEFAULT_ROUTE_PROCESSING_INHERIT },
    }
  })

  const firstPrefix = mapping.routes?.[0]?.formatter_config?.message_prefix_template
  const messagePrefixTemplate =
    typeof firstPrefix === 'string' && firstPrefix.trim() ? firstPrefix.trim() : DEFAULT_MESSAGE_PREFIX_TEMPLATE

  return normalizeWizardDestinations({
    routeDrafts,
    destinationKindsById,
    messagePrefixEnabledByDestinationId,
    messagePrefixTemplate,
    destinationApiBacked: true,
  })
}

function streamConfigPatchFromRead(
  found: StreamRead,
  mapping: MappingUIConfigResponse | null,
): Partial<WizardState['stream']> {
  const cfg = (found.config_json ?? {}) as Record<string, unknown>
  const sourceConfig = mapping?.source_config ?? {}
  const methodRaw = String(cfg.method ?? cfg.http_method ?? 'GET').toUpperCase()
  const httpMethod =
    methodRaw === 'POST' ||
    methodRaw === 'PUT' ||
    methodRaw === 'PATCH' ||
    methodRaw === 'DELETE'
      ? methodRaw
      : 'GET'
  const endpoint = resolveStreamEndpointPath(cfg, sourceConfig)
  const body = cfg.body ?? cfg.request_body
  let requestBody = ''
  if (typeof body === 'string') requestBody = body
  else if (body != null) {
    try {
      requestBody = JSON.stringify(body, null, 2)
    } catch {
      requestBody = ''
    }
  }

  const eventArrayPath = stripJsonPathPrefix(mapping?.mapping?.event_array_path)
  const eventRootPath = stripJsonPathPrefix(mapping?.mapping?.event_root_path)
  const useWholeResponseAsEvent = !eventArrayPath && !mapping?.mapping?.event_array_path

  const ck = (cfg.checkpoint ?? {}) as Record<string, unknown>
  const checkpointSourcePath =
    typeof ck.cursor_path === 'string' && ck.cursor_path.trim()
      ? ck.cursor_path.trim()
      : Array.isArray(ck.cursor_paths) && typeof ck.cursor_paths[0] === 'string'
        ? ck.cursor_paths[0]
        : ''

  const rl = found.rate_limit_json ?? {}
  const confirmedAt = Date.now()

  return {
    name: (found.name ?? '').trim() || `Stream ${found.id}`,
    httpMethod,
    endpoint,
    headers: kvRowsFromRecord((cfg.headers ?? {}) as Record<string, unknown>, 'hdr'),
    params: kvRowsFromRecord((cfg.params ?? {}) as Record<string, unknown>, 'prm'),
    requestBody,
    pollingIntervalSec:
      typeof found.polling_interval === 'number' && found.polling_interval > 0 ? found.polling_interval : 60,
    timeoutSec:
      typeof cfg.timeout_seconds === 'number'
        ? cfg.timeout_seconds
        : typeof cfg.timeout_sec === 'number'
          ? cfg.timeout_sec
          : 30,
    eventArrayPath,
    eventRootPath,
    useWholeResponseAsEvent,
    checkpointSourcePath,
    checkpointFieldType: checkpointSourcePath.includes('cursor') ? 'CURSOR' : 'TIMESTAMP',
    rateLimitPerMinute: typeof rl.per_minute === 'number' ? rl.per_minute : 60,
    rateLimitBurst: typeof rl.burst === 'number' ? rl.burst : 10,
    recordPathConfirmedForApiTestAt: eventArrayPath || useWholeResponseAsEvent ? confirmedAt : null,
    eventRootConfirmedForApiTestAt: eventRootPath ? confirmedAt : null,
    checkpointConfirmedForApiTestAt: checkpointSourcePath ? confirmedAt : null,
  }
}

export async function hydrateWizardStateFromStream(streamId: number): Promise<WizardState | null> {
  const [found, mapping] = await Promise.all([
    fetchStreamById(streamId),
    fetchStreamMappingUiConfig(streamId),
  ])
  if (!found) return null

  const base = buildInitialState()
  const connectorId = typeof found.connector_id === 'number' ? found.connector_id : null
  let connectorPatch: Partial<WizardState['connector']> = {
    connectorId,
    sourceId: mapping?.source_id ?? null,
    apiBacked: true,
  }

  if (connectorId != null) {
    const connector = await fetchConnectorById(connectorId)
    if (connector) {
      connectorPatch = {
        ...connectorPatch,
        ...wizardConnectorPatchFromApi(connector),
        connectorId,
        sourceId: connector.source_id ?? mapping?.source_id ?? null,
      }
    }
  }

  const fieldMappings = (mapping?.mapping?.field_mappings ?? {}) as Record<string, unknown>
  const mappingMode = mappingModeFromFieldMappings(fieldMappings)
  const fullEventJsonataExpression =
    mappingMode === 'full_event_jsonata' && typeof fieldMappings.expression === 'string'
      ? fieldMappings.expression
      : ''
  const fullEventRegexConfigJson =
    mappingMode === 'full_event_regex' && fieldMappings.regex_config != null
      ? JSON.stringify(fieldMappings.regex_config, null, 2)
      : ''

  const unmappedPolicyRaw = fieldMappings[UNMAPPED_FIELDS_POLICY_KEY]
  const unmappedFieldsPolicy = unmappedPolicyRaw === 'drop_unmapped' ? 'drop_unmapped' : 'pass_through'

  return {
    ...base,
    connector: {
      ...base.connector,
      ...connectorPatch,
      sourceType:
        (mapping?.source_type as WizardState['connector']['sourceType']) ??
        connectorPatch.sourceType ??
        base.connector.sourceType,
    },
    stream: {
      ...base.stream,
      ...streamConfigPatchFromRead(found, mapping),
    },
    mapping: mappingRowsFromFieldMappings(fieldMappings),
    mappingMode,
    fullEventJsonataExpression,
    fullEventRegexConfigJson,
    unmappedFieldsPolicy,
    enrichment: normalizeWizardEnrichmentRules(mapping?.enrichment?.enrichment),
    destinations: mapping ? routeDraftsFromMappingUi(mapping) : base.destinations,
    outcome: {
      streamId: found.id,
      routeId: mapping?.routes?.[0]?.route_id ?? null,
      routeIds: (mapping?.routes ?? []).map((r) => r.route_id),
      mappingSaved: mapping?.mapping?.exists ?? false,
      enrichmentSaved: mapping?.enrichment?.exists ?? false,
      dataProtectionSaved: false,
      governanceSaved: false,
      schemaDriftPolicySaved: false,
      schemaDriftPolicyWarnings: [],
      dataProtectionEnforcementIncomplete: false,
      dataProtectionWarnings: [],
      errors: [],
      apiBacked: true,
      createdAt: found.created_at ?? null,
      materializedStreamIds: [],
    },
  }
}
