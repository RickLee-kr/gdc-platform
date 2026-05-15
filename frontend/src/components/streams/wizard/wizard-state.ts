/**
 * State model for the multi-step Stream Onboarding Wizard.
 *
 * Wizard flow (matches `Stream Wizard Real Onboarding Completion` spec):
 *
 *   0. source       — Connector + Source selection
 *   1. config       — Stream config (name, method, URL, endpoint, headers, polling, checkpoint, event_array_path)
 *   2. api_test     — Fetch Sample Data (`/runtime/api-test/http` + `fetch_sample`)
 *   3. preview      — JSON preview of the test response, pick event_array_path
 *   4. mapping      — JSONPath → output field rows (preview-first UX)
 *   5. enrichment   — Static enrichment fields
 *   6. delivery     — Destination + Failure policy + Route create
 *   7. review       — Review summary + create stream batch (POST /streams + mapping-ui/save + /routes)
 *   8. done         — Start stream + Go to runtime
 *
 * Each step records which signals are "complete" so the workflow checklist
 * widget reflects real onboarding progress instead of static placeholders.
 */

import type { ConnectorRead } from '../../../api/gdcConnectors'
import type { CatalogConnector, CatalogSource } from '../../../api/gdcCatalog'
import type { ConnectorAuthTestResponse } from '../../../api/gdcRuntimePreview'
import {
  DEFAULT_MESSAGE_PREFIX_TEMPLATE,
  defaultMessagePrefixEnabled,
} from '../../../utils/messagePrefixDefaults'

export const WIZARD_STEP_KEYS = [
  'connector',
  'stream',
  'api_test',
  'preview',
  'mapping',
  'enrichment',
  'destinations',
  'review',
  'done',
] as const

export type WizardStepKey = (typeof WIZARD_STEP_KEYS)[number]

export type WizardStepDef = {
  key: WizardStepKey
  title: string
  subtitle: string
}

export const WIZARD_STEPS: ReadonlyArray<WizardStepDef> = [
  { key: 'connector', title: 'Connector', subtitle: 'Select existing connector' },
  { key: 'stream', title: 'HTTP Request', subtitle: 'Method · endpoint · polling' },
  { key: 'api_test', title: 'Fetch Sample Data', subtitle: 'Auth · sample response' },
  { key: 'preview', title: 'JSON Preview', subtitle: 'Inspect the raw response' },
  { key: 'mapping', title: 'Mapping', subtitle: 'Pick fields for events' },
  { key: 'enrichment', title: 'Enrichment', subtitle: 'Add static metadata' },
  { key: 'destinations', title: 'Destinations', subtitle: 'Route to destinations' },
  { key: 'review', title: 'Review & Create', subtitle: 'Persist via API' },
  { key: 'done', title: 'Start Stream', subtitle: 'Verify in runtime' },
]

export type AuthType =
  | 'NO_AUTH'
  | 'BASIC'
  | 'BEARER'
  | 'API_KEY'
  | 'OAUTH2_CLIENT_CREDENTIALS'
  | 'SESSION_LOGIN'
  | 'JWT_REFRESH_TOKEN'
export type ApiKeyLocation = 'headers' | 'query_params'

export type WizardConnectorState = {
  connectorId: number | null
  sourceId: number | null
  templateId: string | null
  apiBacked: boolean
  candidates: { connectors: CatalogConnector[]; sources: CatalogSource[] }
  connectorName: string
  description: string
  hostBaseUrl: string
  /** Mirrors backend Source.source_type for the selected connector. */
  sourceType: 'HTTP_API_POLLING' | 'S3_OBJECT_POLLING' | 'DATABASE_QUERY' | 'REMOTE_FILE_POLLING'
  authType: AuthType
  verifySsl: boolean
  httpProxy: string
  commonHeaders: StreamConfigHeaderRow[]
  basicUsername: string
  basicPassword: string
  bearerToken: string
  apiKeyName: string
  apiKeyValue: string
  apiKeyLocation: ApiKeyLocation
  oauthClientId: string
  oauthClientSecret: string
  oauthTokenUrl: string
  oauthScope: string
  loginUrl: string
  loginPath: string
  loginMethod: 'POST' | 'PUT' | 'PATCH'
  loginUsername: string
  loginPassword: string
  loginHeaders: Record<string, string>
  loginBodyTemplate: Record<string, unknown>
  refreshToken: string
  tokenUrl: string
  tokenPath: string
  tokenHttpMethod: 'POST' | 'PUT' | 'PATCH'
  refreshTokenHeaderName: string
  refreshTokenHeaderPrefix: string
  accessTokenJsonPath: string
  accessTokenHeaderName: string
  accessTokenHeaderPrefix: string
  tokenTtlSeconds: number
}

export type StreamConfigHeaderRow = { id: string; key: string; value: string }
export type StreamConfigParamRow = { id: string; key: string; value: string }

export type WizardCheckpointFieldType = '' | 'TIMESTAMP' | 'EVENT_ID' | 'CURSOR' | 'OFFSET'

export type WizardHttpApiAnalysis = {
  responseSummary: {
    root_type: string
    approx_size_bytes: number
    top_level_keys: string[]
    item_count_root: number | null
    truncation: string | null
  }
  detectedArrays: Array<{
    path: string
    count: number
    confidence: number
    reason: string
    sample_item_preview?: unknown
  }>
  detectedCheckpointCandidates: Array<{
    path: string
    checkpoint_type: WizardCheckpointFieldType
    confidence: number
    sample_value: unknown
    reason: string
  }>
  sampleEvent: Record<string, unknown> | null
  selectedEventArrayDefault: string | null
  flatPreviewFields: string[]
  eventRootCandidates?: string[]
  /** Backend `preview_error` when body is not parseable JSON, oversized, or non-JSON. */
  previewError: string | null
}

export type WizardConfigState = {
  name: string
  httpMethod: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  endpoint: string
  headers: StreamConfigHeaderRow[]
  params: StreamConfigParamRow[]
  requestBody: string
  pollingIntervalSec: number
  timeoutSec: number
  eventArrayPath: string
  eventRootPath: string
  /** True when user chose “entire response as single event” (empty event_array_path semantics). */
  useWholeResponseAsEvent: boolean
  /** JSONPath into a single event for checkpoint templates (e.g. $.creationTime). */
  checkpointFieldType: WizardCheckpointFieldType
  checkpointSourcePath: string
  rateLimitPerMinute: number
  rateLimitBurst: number
  /** S3_OBJECT_POLLING stream: objects fetched per StreamRunner execution (default 20). */
  maxObjectsPerRun: number
  /** REMOTE_FILE_POLLING: remote directory (required for sample fetch). */
  remoteDirectory: string
  filePattern: string
  remoteRecursive: boolean
  parserType: string
  maxFilesPerRun: number
  maxFileSizeMb: number
  encoding: string
  csvDelimiter: string
  lineEventField: string
  includeFileMetadata: boolean
}

export type WizardApiTestStatus = 'idle' | 'running' | 'success' | 'error'

export type WizardApiTestStep = {
  name: string
  success: boolean
  status_code?: number | null
  message?: string
}

export type WizardApiTestState = {
  status: WizardApiTestStatus
  ok: boolean
  requestUrl: string | null
  method: string | null
  statusCode: number | null
  responseHeaders: Record<string, string>
  rawBody: string | null
  parsedJson: unknown
  rawResponse: unknown
  extractedEvents: Array<Record<string, unknown>>
  eventCount: number
  startedAt: number | null
  finishedAt: number | null
  errorCode: string | null
  errorType: string | null
  errorMessage: string | null
  targetStatusCode: number | null
  targetResponseBody: string | null
  hint: string | null
  /** Whether this preview came from real API (true) or local mock (false). */
  apiBacked: boolean
  /** Auth / HTTP steps from Stream API Test (masked headers; no plaintext secrets). */
  steps: WizardApiTestStep[]
  responseSample: unknown
  effectiveHeadersMasked: Record<string, string> | null
  actualRequestSent: {
    method: string
    url: string
    endpoint: string | null
    queryParams: Record<string, unknown>
    headersMasked: Record<string, string>
    jsonBodyMasked: unknown | null
    timeoutSeconds: number
  } | null
  /** Structured response analysis from backend (persists across wizard navigation). */
  analysis: WizardHttpApiAnalysis | null
  /** S3_OBJECT_POLLING: connectivity probe succeeded via connector-auth (replaces HTTP sample fetch). */
  s3ConnectivityPassed: boolean
  /** REMOTE_FILE_POLLING: last connector-auth probe (SSH/SFTP listing) before sample fetch. */
  remoteProbe?: ConnectorAuthTestResponse | null
}

export type WizardMappingRow = {
  id: string
  outputField: string
  sourceJsonPath: string
}

export type WizardEnrichmentRow = {
  id: string
  fieldName: string
  value: string
}

/** Per-route draft for wizard Destinations step (persists to POST /routes/ on create). */
export type WizardRouteDraft = {
  /** Stable React/client key (not sent to API). */
  key: string
  destinationId: number
  enabled: boolean
  failurePolicy:
    | 'LOG_AND_CONTINUE'
    | 'PAUSE_STREAM_ON_FAILURE'
    | 'RETRY_AND_BACKOFF'
    | 'DISABLE_ROUTE_ON_FAILURE'
  /** Route-level rate limits (optional); merged with destination at runtime when empty. */
  rateLimitJson: Record<string, unknown>
}

export type WizardDestinationsState = {
  /** Ordered route plans — one POST /routes/ row per entry after stream creation. */
  routeDrafts: WizardRouteDraft[]
  /** destination_type per id — used for message-prefix defaults when creating routes */
  destinationKindsById: Record<number, string>
  /** Applied to every route created from this wizard step */
  messagePrefixTemplate: string
  /** Explicit per-destination override; omit key → use default by destination type at save */
  messagePrefixEnabledByDestinationId: Record<number, boolean | undefined>
  destinationApiBacked: boolean
}

export type WizardCreateOutcome = {
  streamId: number | null
  routeId: number | null
  /** All route ids returned from POST /routes/ during this creation (last id duplicated in routeId for backward compat). */
  routeIds: number[]
  mappingSaved: boolean
  enrichmentSaved: boolean
  errors: string[]
  apiBacked: boolean
  /** ISO timestamp from POST /streams/ response when available. */
  createdAt: string | null
}

export type WizardState = {
  connector: WizardConnectorState
  stream: WizardConfigState
  apiTest: WizardApiTestState
  mapping: WizardMappingRow[]
  enrichment: WizardEnrichmentRow[]
  destinations: WizardDestinationsState
  outcome: WizardCreateOutcome | null
  startMessage: string | null
}

export const INITIAL_CONFIG: WizardConfigState = {
  name: 'Generic HTTP Events',
  httpMethod: 'GET',
  endpoint: '/v1/events',
  headers: [],
  params: [],
  requestBody: '',
  pollingIntervalSec: 60,
  timeoutSec: 30,
  eventArrayPath: '',
  eventRootPath: '',
  useWholeResponseAsEvent: false,
  checkpointFieldType: '',
  checkpointSourcePath: '',
  rateLimitPerMinute: 60,
  rateLimitBurst: 10,
  maxObjectsPerRun: 20,
  remoteDirectory: '',
  filePattern: '*',
  remoteRecursive: false,
  parserType: 'NDJSON',
  maxFilesPerRun: 10,
  maxFileSizeMb: 5,
  encoding: 'utf-8',
  csvDelimiter: ',',
  lineEventField: 'line',
  includeFileMetadata: false,
}

export const INITIAL_API_TEST: WizardApiTestState = {
  status: 'idle',
  ok: false,
  requestUrl: null,
  method: null,
  statusCode: null,
  responseHeaders: {},
  rawBody: null,
  parsedJson: null,
  rawResponse: null,
  extractedEvents: [],
  eventCount: 0,
  startedAt: null,
  finishedAt: null,
  errorCode: null,
  errorType: null,
  errorMessage: null,
  targetStatusCode: null,
  targetResponseBody: null,
  hint: null,
  apiBacked: false,
  steps: [],
  responseSample: null,
  effectiveHeadersMasked: null,
  actualRequestSent: null,
  analysis: null,
  s3ConnectivityPassed: false,
  remoteProbe: null,
}

export const INITIAL_DESTINATIONS: WizardDestinationsState = {
  routeDrafts: [],
  destinationKindsById: {},
  messagePrefixTemplate: DEFAULT_MESSAGE_PREFIX_TEMPLATE,
  messagePrefixEnabledByDestinationId: {},
  destinationApiBacked: false,
}

export function newWizardRouteDraftKey(): string {
  return `wr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Normalize persisted wizard JSON / legacy shapes into `routeDrafts`. */
export function normalizeWizardDestinations(destinations: Partial<WizardDestinationsState> | undefined): WizardDestinationsState {
  if (!destinations) return INITIAL_DESTINATIONS
  const merged: WizardDestinationsState = {
    ...INITIAL_DESTINATIONS,
    ...destinations,
    destinationKindsById: {
      ...INITIAL_DESTINATIONS.destinationKindsById,
      ...destinations.destinationKindsById,
    },
    messagePrefixEnabledByDestinationId: {
      ...INITIAL_DESTINATIONS.messagePrefixEnabledByDestinationId,
      ...destinations.messagePrefixEnabledByDestinationId,
    },
    routeDrafts: Array.isArray(destinations.routeDrafts) ? destinations.routeDrafts : INITIAL_DESTINATIONS.routeDrafts,
  }
  const drafts = merged.routeDrafts
  if (Array.isArray(drafts) && drafts.length > 0) {
    merged.routeDrafts = drafts.map((d) => ({
      key: d.key || newWizardRouteDraftKey(),
      destinationId: d.destinationId,
      enabled: d.enabled,
      failurePolicy: d.failurePolicy,
      rateLimitJson: typeof d.rateLimitJson === 'object' && d.rateLimitJson && !Array.isArray(d.rateLimitJson) ? { ...d.rateLimitJson } : {},
    }))
    return merged
  }
  const legacyIds = (destinations as { selectedDestinationIds?: number[] } | undefined)?.selectedDestinationIds
  const legacyPolicy = (destinations as { failurePolicy?: WizardRouteDraft['failurePolicy'] } | undefined)?.failurePolicy
  const legacyEnabled = (destinations as { routeEnabled?: boolean } | undefined)?.routeEnabled
  if (Array.isArray(legacyIds) && legacyIds.length > 0) {
    merged.routeDrafts = legacyIds.map((destinationId, idx) => ({
      key: `legacy-${destinationId}-${idx}`,
      destinationId,
      enabled: legacyEnabled !== false,
      failurePolicy: legacyPolicy ?? 'LOG_AND_CONTINUE',
      rateLimitJson: {},
    }))
  }
  return merged
}

export function buildInitialState(): WizardState {
  return {
    connector: {
      connectorId: null,
      sourceId: null,
      templateId: null,
      apiBacked: false,
      candidates: { connectors: [], sources: [] },
      connectorName: '',
      description: '',
      hostBaseUrl: '',
      authType: 'NO_AUTH',
      verifySsl: true,
      httpProxy: '',
      commonHeaders: [],
      basicUsername: '',
      basicPassword: '',
      bearerToken: '',
      apiKeyName: '',
      apiKeyValue: '',
      apiKeyLocation: 'headers',
      oauthClientId: '',
      oauthClientSecret: '',
      oauthTokenUrl: '',
      oauthScope: '',
      loginUrl: '',
      loginPath: '',
      loginMethod: 'POST',
      loginUsername: '',
      loginPassword: '',
      loginHeaders: {},
      loginBodyTemplate: {},
      refreshToken: '',
      tokenUrl: '',
      tokenPath: '',
      tokenHttpMethod: 'POST',
      refreshTokenHeaderName: 'Authorization',
      refreshTokenHeaderPrefix: 'Bearer',
      accessTokenJsonPath: '$.access_token',
      accessTokenHeaderName: 'Authorization',
      accessTokenHeaderPrefix: 'Bearer',
      tokenTtlSeconds: 600,
      sourceType: 'HTTP_API_POLLING',
    },
    stream: {
      ...INITIAL_CONFIG,
      headers: [],
      params: [...INITIAL_CONFIG.params],
    },
    apiTest: { ...INITIAL_API_TEST },
    mapping: [],
    enrichment: [],
    destinations: INITIAL_DESTINATIONS,
    outcome: null,
    startMessage: null,
  }
}

export type StepCompletion = 'incomplete' | 'in_progress' | 'complete'

/** Pure status calculator — does not perform network calls. */
export function buildFullRequestUrl(hostBaseUrl: string, endpointPath: string): string {
  const base = hostBaseUrl.trim().replace(/\/$/, '')
  const ep = endpointPath.trim()
  if (!base || !ep) return ''
  return `${base}${ep.startsWith('/') ? ep : `/${ep}`}`
}

/** Merge connector common headers with stream headers (stream wins on key clash). */
export function effectiveRequestHeaders(
  connector: WizardConnectorState,
  stream: WizardConfigState,
): Record<string, string> {
  const inherited: Record<string, string> = {}
  for (const row of connector.commonHeaders) {
    const k = row.key.trim()
    if (k) inherited[k] = row.value
  }
  const extra: Record<string, string> = {}
  for (const row of stream.headers) {
    const k = row.key.trim()
    if (k) extra[k] = row.value
  }
  return { ...inherited, ...extra }
}

export function mapConnectorApiAuthType(raw: string): AuthType {
  const x = raw.toLowerCase().replace(/-/g, '_')
  const table: Record<string, AuthType> = {
    no_auth: 'NO_AUTH',
    basic: 'BASIC',
    bearer: 'BEARER',
    api_key: 'API_KEY',
    oauth2_client_credentials: 'OAUTH2_CLIENT_CREDENTIALS',
    session_login: 'SESSION_LOGIN',
    jwt_refresh_token: 'JWT_REFRESH_TOKEN',
  }
  return table[x] ?? 'NO_AUTH'
}

/** Hydrate wizard connector slice from GET /connectors/:id (masked secrets OK — API Test uses connector_id server-side). */
/** Reset fields mirrored from API when user clears connector selection. */
export function resetInheritedConnectorFields(): Partial<WizardConnectorState> {
  return {
    connectorName: '',
    description: '',
    hostBaseUrl: '',
    authType: 'NO_AUTH',
    verifySsl: true,
    httpProxy: '',
    commonHeaders: [],
    basicUsername: '',
    basicPassword: '',
    bearerToken: '',
    apiKeyName: '',
    apiKeyValue: '',
    apiKeyLocation: 'headers',
    oauthClientId: '',
    oauthClientSecret: '',
    oauthTokenUrl: '',
    oauthScope: '',
    loginUrl: '',
    loginPath: '',
    loginMethod: 'POST',
    loginUsername: '',
    loginPassword: '',
    loginHeaders: {},
    loginBodyTemplate: {},
    refreshToken: '',
    tokenUrl: '',
    tokenPath: '',
    tokenHttpMethod: 'POST',
    refreshTokenHeaderName: 'Authorization',
    refreshTokenHeaderPrefix: 'Bearer',
    accessTokenJsonPath: '$.access_token',
    accessTokenHeaderName: 'Authorization',
    accessTokenHeaderPrefix: 'Bearer',
    tokenTtlSeconds: 600,
    sourceType: 'HTTP_API_POLLING',
  }
}

export function wizardConnectorPatchFromApi(row: ConnectorRead): Partial<WizardConnectorState> {
  const auth = (row.auth ?? {}) as Record<string, unknown>
  const authType = mapConnectorApiAuthType(String(auth.auth_type ?? row.auth_type ?? 'no_auth'))
  const commonHeaders = Object.entries(row.common_headers ?? {}).map(([key, value], idx) => ({
    id: `ch-${row.id}-${idx}`,
    key,
    value: String(value ?? ''),
  }))
  const lhRaw = auth.login_headers
  const loginHeaders =
    lhRaw && typeof lhRaw === 'object' && !Array.isArray(lhRaw)
      ? Object.fromEntries(
          Object.entries(lhRaw as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]),
        )
      : {}
  const lbRaw = auth.login_body_template
  const loginBodyTemplate =
    lbRaw && typeof lbRaw === 'object' && !Array.isArray(lbRaw)
      ? { ...(lbRaw as Record<string, unknown>) }
      : {}

  const stRaw = String(row.source_type ?? 'HTTP_API_POLLING').toUpperCase()
  const st: WizardConnectorState['sourceType'] =
    stRaw === 'S3_OBJECT_POLLING'
      ? 'S3_OBJECT_POLLING'
      : stRaw === 'REMOTE_FILE_POLLING'
        ? 'REMOTE_FILE_POLLING'
        : 'HTTP_API_POLLING'
  const baseUrl =
    st === 'S3_OBJECT_POLLING'
      ? String(row.endpoint_url ?? row.base_url ?? row.host ?? '').trim()
      : String(row.base_url ?? row.host ?? '').trim()

  return {
    connectorName: row.name ?? '',
    description: row.description ?? '',
    hostBaseUrl: baseUrl,
    sourceType: st,
    verifySsl: row.verify_ssl,
    httpProxy: row.http_proxy ?? '',
    commonHeaders,
    authType,
    basicUsername: String(auth.basic_username ?? ''),
    basicPassword: String(auth.basic_password ?? ''),
    bearerToken: String(auth.bearer_token ?? ''),
    apiKeyName: String(auth.api_key_name ?? ''),
    apiKeyValue: String(auth.api_key_value ?? ''),
    apiKeyLocation: (String(auth.api_key_location ?? 'headers').toLowerCase() as ApiKeyLocation),
    oauthClientId: String(auth.oauth2_client_id ?? ''),
    oauthClientSecret: String(auth.oauth2_client_secret ?? ''),
    oauthTokenUrl: String(auth.oauth2_token_url ?? ''),
    oauthScope: String(auth.oauth2_scope ?? ''),
    loginUrl: String(auth.login_url ?? ''),
    loginPath: String(auth.login_path ?? ''),
    loginMethod: (String(auth.login_method ?? 'POST').toUpperCase() as 'POST' | 'PUT' | 'PATCH'),
    loginUsername: String(auth.login_username ?? ''),
    loginPassword: String(auth.login_password ?? ''),
    loginHeaders,
    loginBodyTemplate,
    refreshToken: String(auth.refresh_token ?? ''),
    tokenUrl: String(auth.token_url ?? ''),
    tokenPath: String(auth.token_path ?? ''),
    tokenHttpMethod: (String(auth.token_http_method ?? 'POST').toUpperCase() as 'POST' | 'PUT' | 'PATCH'),
    refreshTokenHeaderName: String(auth.refresh_token_header_name ?? 'Authorization'),
    refreshTokenHeaderPrefix: String(auth.refresh_token_header_prefix ?? 'Bearer'),
    accessTokenJsonPath: String(auth.access_token_json_path ?? '$.access_token'),
    accessTokenHeaderName: String(auth.access_token_header_name ?? 'Authorization'),
    accessTokenHeaderPrefix: String(auth.access_token_header_prefix ?? 'Bearer'),
    tokenTtlSeconds: Number(auth.token_ttl_seconds ?? 600),
  }
}

export function computeStepCompletion(state: WizardState): Record<WizardStepKey, StepCompletion> {
  const connectorReady = state.connector.connectorId != null && state.connector.sourceId != null
  const isS3 = state.connector.sourceType === 'S3_OBJECT_POLLING'
  const isRemote = state.connector.sourceType === 'REMOTE_FILE_POLLING'
  const streamReady =
    state.stream.name.trim().length > 0 &&
    (isS3 ||
      isRemote ||
      (!isS3 && !isRemote && state.stream.endpoint.trim().length > 0)) &&
    (!isS3 || (Number.isFinite(state.stream.maxObjectsPerRun) && state.stream.maxObjectsPerRun >= 1)) &&
    (!isRemote || state.stream.remoteDirectory.trim().length > 0)
  const apiTestRan =
    state.apiTest.status === 'success' &&
    (!isS3 || state.apiTest.s3ConnectivityPassed) &&
    (!isRemote || state.apiTest.remoteProbe?.ok === true)
  const previewErr = state.apiTest.analysis?.previewError
  const previewReady =
    apiTestRan &&
    !previewErr &&
    (state.stream.useWholeResponseAsEvent ||
      state.stream.eventArrayPath.trim().length > 0 ||
      state.apiTest.eventCount > 0)
  const mappingReady = state.mapping.filter((m) => m.outputField.trim() && m.sourceJsonPath.trim()).length > 0
  const enrichmentReady = state.enrichment.length === 0 || state.enrichment.every((e) => e.fieldName.trim().length > 0)
  const enrichmentHasRows = state.enrichment.length > 0
  const destinationsReady = state.destinations.routeDrafts.length > 0
  const reviewReady = connectorReady && streamReady && apiTestRan && previewReady && mappingReady && destinationsReady
  const done = state.outcome?.streamId != null && reviewReady

  return {
    connector: connectorReady ? 'complete' : 'in_progress',
    stream: !connectorReady ? 'incomplete' : streamReady ? 'complete' : 'in_progress',
    api_test: !connectorReady || !streamReady ? 'incomplete' : apiTestRan ? 'complete' : 'in_progress',
    preview: !connectorReady || !streamReady || !apiTestRan ? 'incomplete' : previewReady ? 'complete' : 'in_progress',
    mapping: !previewReady ? 'incomplete' : mappingReady ? 'complete' : 'in_progress',
    enrichment: !mappingReady ? 'incomplete' : enrichmentReady && enrichmentHasRows ? 'complete' : 'in_progress',
    destinations: !mappingReady ? 'incomplete' : destinationsReady ? 'complete' : 'in_progress',
    review: reviewReady ? 'in_progress' : 'incomplete',
    done: done ? 'complete' : 'incomplete',
  }
}

function buildAuthConfig(state: WizardState): Record<string, unknown> {
  const authType = state.connector.authType
  if (authType === 'BASIC') {
    return {
      type: authType,
      username: state.connector.basicUsername,
      password: state.connector.basicPassword,
    }
  }
  if (authType === 'BEARER') {
    return {
      type: authType,
      token: state.connector.bearerToken,
    }
  }
  if (authType === 'API_KEY') {
    return {
      type: authType,
      key_name: state.connector.apiKeyName,
      key_value: state.connector.apiKeyValue,
      location: state.connector.apiKeyLocation,
    }
  }
  if (authType === 'OAUTH2_CLIENT_CREDENTIALS') {
    return {
      type: authType,
      client_id: state.connector.oauthClientId,
      client_secret: state.connector.oauthClientSecret,
      token_url: state.connector.oauthTokenUrl,
      scope: state.connector.oauthScope,
    }
  }
  if (authType === 'SESSION_LOGIN') {
    const lh = state.connector.loginHeaders
    const login_headers =
      lh && Object.keys(lh).length > 0 ? { ...lh } : { 'Content-Type': 'application/json' }
    const tmpl = state.connector.loginBodyTemplate
    const login_body_template =
      tmpl && Object.keys(tmpl).length > 0
        ? tmpl
        : { username: '{{username}}', password: '{{password}}' }
    return {
      type: authType,
      login_url: state.connector.loginUrl || undefined,
      login_path: state.connector.loginPath || undefined,
      login_method: state.connector.loginMethod,
      login_headers,
      login_body_template,
      login_username: state.connector.loginUsername,
      login_password: state.connector.loginPassword,
    }
  }
  if (authType === 'JWT_REFRESH_TOKEN') {
    return {
      type: authType,
      refresh_token: state.connector.refreshToken,
      token_url: state.connector.tokenUrl || undefined,
      token_path: state.connector.tokenPath || undefined,
      token_http_method: state.connector.tokenHttpMethod,
      refresh_token_header_name: state.connector.refreshTokenHeaderName,
      refresh_token_header_prefix: state.connector.refreshTokenHeaderPrefix,
      access_token_json_path: state.connector.accessTokenJsonPath,
      access_token_header_name: state.connector.accessTokenHeaderName,
      access_token_header_prefix: state.connector.accessTokenHeaderPrefix,
      token_ttl_seconds: state.connector.tokenTtlSeconds,
    }
  }
  return { type: 'NO_AUTH' }
}

export function buildSourceConfig(state: WizardState): Record<string, unknown> {
  const commonHeaders: Record<string, string> = {}
  for (const row of state.connector.commonHeaders) {
    if (row.key.trim()) commonHeaders[row.key.trim()] = row.value
  }
  return {
    base_url: state.connector.hostBaseUrl.trim(),
    timeout_seconds: state.stream.timeoutSec,
    verify_ssl: state.connector.verifySsl,
    http_proxy: state.connector.httpProxy.trim() || null,
    headers: commonHeaders,
  }
}

export function buildSourceAuthPayload(state: WizardState): Record<string, unknown> {
  const auth = buildAuthConfig(state)
  return {
    auth_type: auth.type,
    ...auth,
  }
}

export function buildStreamConfigPayload(state: WizardState): Record<string, unknown> {
  const isRemote = state.connector.sourceType === 'REMOTE_FILE_POLLING'
  if (isRemote) {
    return {
      remote_directory: state.stream.remoteDirectory.trim(),
      file_pattern: (state.stream.filePattern.trim() || '*') as string,
      recursive: state.stream.remoteRecursive,
      parser_type: state.stream.parserType,
      max_files_per_run: Math.max(1, Math.floor(Number(state.stream.maxFilesPerRun) || 10)),
      max_file_size_mb: Math.max(1, Math.floor(Number(state.stream.maxFileSizeMb) || 5)),
      encoding: state.stream.encoding.trim() || 'utf-8',
      csv_delimiter: state.stream.csvDelimiter || ',',
      line_event_field: state.stream.lineEventField.trim() || 'line',
      include_file_metadata: state.stream.includeFileMetadata,
    }
  }
  const headers: Record<string, string> = {}
  for (const row of state.stream.headers) {
    if (row.key.trim()) headers[row.key.trim()] = row.value
  }
  const params: Record<string, string> = {}
  for (const row of state.stream.params) {
    if (row.key.trim()) params[row.key.trim()] = row.value
  }
  const out: Record<string, unknown> = {
    method: state.stream.httpMethod,
    endpoint: state.stream.endpoint.trim(),
    headers,
    params,
    body: state.stream.requestBody.trim() || undefined,
    timeout_seconds: state.stream.timeoutSec,
  }
  if (!state.stream.useWholeResponseAsEvent) {
    const eap = state.stream.eventArrayPath.trim()
    if (eap) {
      out.event_array_path = eap.startsWith('$') ? eap : `$.${eap}`
    }
  }
  const erp = state.stream.eventRootPath.trim()
  if (erp) {
    out.event_root_path = erp.startsWith('$') ? erp : `$.${erp}`
  }
  return out
}

export function buildStreamCreatePayload(state: WizardState): {
  name: string
  connector_id: number
  source_id: number
  stream_type: string
  polling_interval: number
  enabled: boolean
  status: string
  config_json: Record<string, unknown>
  rate_limit_json: Record<string, unknown>
} | null {
  if (state.connector.connectorId == null || state.connector.sourceId == null) return null
  const isS3 = state.connector.sourceType === 'S3_OBJECT_POLLING'
  const isRemote = state.connector.sourceType === 'REMOTE_FILE_POLLING'
  const maxOb = Math.max(1, Math.floor(Number(state.stream.maxObjectsPerRun) || 20))
  let stream_type = 'HTTP_API_POLLING'
  if (isS3) stream_type = 'S3_OBJECT_POLLING'
  else if (isRemote) stream_type = 'REMOTE_FILE_POLLING'
  const config_json: Record<string, unknown> = isS3 ? { max_objects_per_run: maxOb } : buildStreamConfigPayload(state)
  return {
    name: state.stream.name.trim() || 'Untitled Stream',
    connector_id: state.connector.connectorId,
    source_id: state.connector.sourceId,
    stream_type,
    polling_interval: state.stream.pollingIntervalSec,
    enabled: true,
    status: 'STOPPED',
    config_json,
    rate_limit_json: {
      per_minute: state.stream.rateLimitPerMinute,
      burst: state.stream.rateLimitBurst,
    },
  }
}

export function fieldMappingsFromRows(rows: WizardMappingRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of rows) {
    if (row.outputField.trim() && row.sourceJsonPath.trim()) {
      out[row.outputField.trim()] = row.sourceJsonPath.trim()
    }
  }
  return out
}

export function enrichmentDictFromRows(rows: WizardEnrichmentRow[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const row of rows) {
    if (row.fieldName.trim()) out[row.fieldName.trim()] = row.value
  }
  return out
}

export function buildRouteCreatePayloads(streamId: number, destinations: WizardDestinationsState): Array<{
  stream_id: number
  destination_id: number
  enabled: boolean
  failure_policy: WizardRouteDraft['failurePolicy']
  status: 'ENABLED' | 'DISABLED'
  formatter_config_json: Record<string, unknown>
  rate_limit_json: Record<string, unknown>
}> {
  const tmpl =
    destinations.messagePrefixTemplate.trim().length > 0
      ? destinations.messagePrefixTemplate.trim()
      : DEFAULT_MESSAGE_PREFIX_TEMPLATE
  return destinations.routeDrafts.map((draft) => {
    const destinationId = draft.destinationId
    const kind = destinations.destinationKindsById[destinationId]
    const explicit = destinations.messagePrefixEnabledByDestinationId[destinationId]
    const prefixEnabled = explicit !== undefined ? explicit : defaultMessagePrefixEnabled(kind ?? '')
    const rl = draft.rateLimitJson && typeof draft.rateLimitJson === 'object' ? { ...draft.rateLimitJson } : {}
    return {
      stream_id: streamId,
      destination_id: destinationId,
      enabled: draft.enabled,
      failure_policy: draft.failurePolicy,
      status: draft.enabled ? 'ENABLED' : 'DISABLED',
      formatter_config_json: {
        message_prefix_enabled: prefixEnabled,
        message_prefix_template: tmpl,
      },
      rate_limit_json: rl,
    }
  })
}
