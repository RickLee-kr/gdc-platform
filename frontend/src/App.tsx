import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { API_BASE_URL, requestJson, resolveApiBaseUrl } from './api'
import { ControlTestSection } from './components/ControlTestSection'
import { ObservabilitySection } from './components/ObservabilitySection'
import { RuntimeConfigSection } from './components/RuntimeConfigSection'
import {
  parseEventsArray,
  parseFieldMappingsStrStr,
  parseJsonObject,
  parseJsonValue,
  pickInitialRawResponseFromSourceConfig,
  prettyJson,
} from './jsonUtils'
import { runtimeQuery } from './runtimeQuery'
import type { ApiState, AppSection, CtrlApiKey, JsonValue, ObsApiKey, TabKey } from './runtimeTypes'
import { SECTION_LABELS } from './runtimeTypes'
import {
  clearApiBaseUrlOverride,
  clearPersistedEntityIds,
  clearUiPreferenceKeys,
  loadApiBaseUrlOverride,
  loadDisplayDensity,
  loadPersistedEntityIds,
  persistApiBaseUrlOverride,
  persistDisplayDensity,
  persistEntityIds,
  type DisplayDensity,
} from './localPreferences'

export default function App() {
  const [activeSection, setActiveSection] = useState<AppSection>('config')
  const [activeTab, setActiveTab] = useState<TabKey>('connector')
  const [ids, setIds] = useState(loadPersistedEntityIds)
  const [density, setDensity] = useState<DisplayDensity>(() => loadDisplayDensity())
  const [apiUrlRevision, setApiUrlRevision] = useState(0)
  const [apiUrlOverrideDraft, setApiUrlOverrideDraft] = useState(() => loadApiBaseUrlOverride() ?? '')

  const effectiveApiBase = useMemo(() => {
    void apiUrlRevision
    return resolveApiBaseUrl()
  }, [apiUrlRevision])

  useEffect(() => {
    persistEntityIds(ids)
  }, [ids])

  useEffect(() => {
    persistDisplayDensity(density)
  }, [density])
  const [apiState, setApiState] = useState<Record<TabKey, ApiState>>({
    connector: { loading: false, success: '', error: '' },
    source: { loading: false, success: '', error: '' },
    stream: { loading: false, success: '', error: '' },
    mapping: { loading: false, success: '', error: '' },
    route: { loading: false, success: '', error: '' },
    destination: { loading: false, success: '', error: '' },
  })

  const [connectorConfig, setConnectorConfig] = useState('')
  const [connectorSave, setConnectorSave] = useState('')

  const [sourceConfig, setSourceConfig] = useState('')
  const [sourceSave, setSourceSave] = useState('')

  const [streamConfig, setStreamConfig] = useState('')
  const [streamSave, setStreamSave] = useState('')

  const [mappingConfig, setMappingConfig] = useState('')
  const [mappingRawResponseJson, setMappingRawResponseJson] = useState('{}')
  const [mappingRows, setMappingRows] = useState<Array<{ outputField: string; sourcePath: string; sampleValue: unknown }>>([])
  const [mappingEventArrayPath, setMappingEventArrayPath] = useState('')
  const [mappingEnrichmentJson, setMappingEnrichmentJson] = useState('{}')
  const [mappingOverridePolicy, setMappingOverridePolicy] = useState('KEEP_EXISTING')
  const [mappingPreviewResult, setMappingPreviewResult] = useState('')
  const [selectedJsonPath, setSelectedJsonPath] = useState('')
  const [mappingTargetField, setMappingTargetField] = useState('')

  const [routeConfig, setRouteConfig] = useState('')
  const [routeSave, setRouteSave] = useState('')

  const [destinationConfig, setDestinationConfig] = useState('')
  const [destinationSave, setDestinationSave] = useState('')

  const [obsApi, setObsApi] = useState<Record<ObsApiKey, ApiState>>({
    dashboard: { loading: false, success: '', error: '' },
    health: { loading: false, success: '', error: '' },
    stats: { loading: false, success: '', error: '' },
    timeline: { loading: false, success: '', error: '' },
    logsSearch: { loading: false, success: '', error: '' },
    logsPage: { loading: false, success: '', error: '' },
    logsCleanup: { loading: false, success: '', error: '' },
    failureTrend: { loading: false, success: '', error: '' },
  })

  const [dashboardLimit, setDashboardLimit] = useState('100')
  const [dashboardData, setDashboardData] = useState<unknown>(null)

  const [healthLimit, setHealthLimit] = useState('100')
  const [healthData, setHealthData] = useState<unknown>(null)

  const [statsLimit, setStatsLimit] = useState('100')
  const [statsData, setStatsData] = useState<unknown>(null)

  const [timelineLimit, setTimelineLimit] = useState('100')
  const [timelineStage, setTimelineStage] = useState('')
  const [timelineLevel, setTimelineLevel] = useState('')
  const [timelineStatus, setTimelineStatus] = useState('')
  const [timelineRouteIdFilter, setTimelineRouteIdFilter] = useState('')
  const [timelineDestinationIdFilter, setTimelineDestinationIdFilter] = useState('')
  const [timelineData, setTimelineData] = useState<unknown>(null)

  const [logSearchStreamId, setLogSearchStreamId] = useState('')
  const [logSearchRouteId, setLogSearchRouteId] = useState('')
  const [logSearchDestinationId, setLogSearchDestinationId] = useState('')
  const [logSearchStage, setLogSearchStage] = useState('')
  const [logSearchLevel, setLogSearchLevel] = useState('')
  const [logSearchStatus, setLogSearchStatus] = useState('')
  const [logSearchErrorCode, setLogSearchErrorCode] = useState('')
  const [logSearchLimit, setLogSearchLimit] = useState('100')
  const [logSearchData, setLogSearchData] = useState<unknown>(null)

  const [logPageLimit, setLogPageLimit] = useState('100')
  const [logPageCursorAt, setLogPageCursorAt] = useState('')
  const [logPageCursorId, setLogPageCursorId] = useState('')
  const [logPageStreamId, setLogPageStreamId] = useState('')
  const [logPageRouteId, setLogPageRouteId] = useState('')
  const [logPageDestinationId, setLogPageDestinationId] = useState('')
  const [logPageStage, setLogPageStage] = useState('')
  const [logPageLevel, setLogPageLevel] = useState('')
  const [logPageStatus, setLogPageStatus] = useState('')
  const [logPageErrorCode, setLogPageErrorCode] = useState('')
  const [logPageData, setLogPageData] = useState<unknown>(null)

  const [cleanupOlderThanDays, setCleanupOlderThanDays] = useState('30')
  const [cleanupDryRun, setCleanupDryRun] = useState(true)
  const [cleanupResult, setCleanupResult] = useState<unknown>(null)

  const [trendLimit, setTrendLimit] = useState('1000')
  const [trendStreamId, setTrendStreamId] = useState('')
  const [trendRouteId, setTrendRouteId] = useState('')
  const [trendDestinationId, setTrendDestinationId] = useState('')
  const [trendData, setTrendData] = useState<unknown>(null)

  const [ctrlApi, setCtrlApi] = useState<Record<CtrlApiKey, ApiState>>({
    streamStart: { loading: false, success: '', error: '' },
    streamStop: { loading: false, success: '', error: '' },
    apiTest: { loading: false, success: '', error: '' },
    mappingCtl: { loading: false, success: '', error: '' },
    formatPreview: { loading: false, success: '', error: '' },
    routeDeliveryPreview: { loading: false, success: '', error: '' },
  })

  const [streamControlResult, setStreamControlResult] = useState<unknown>(null)

  const [apiTestSource, setApiTestSource] = useState('{}')
  const [apiTestStream, setApiTestStream] = useState('{}')
  const [apiTestCheckpoint, setApiTestCheckpoint] = useState('')
  const [apiTestResult, setApiTestResult] = useState<unknown>(null)

  const [ctlRawResponse, setCtlRawResponse] = useState('{}')
  const [ctlFieldMappingsJson, setCtlFieldMappingsJson] = useState('{}')
  const [ctlEnrichmentJson, setCtlEnrichmentJson] = useState('{}')
  const [ctlEventArrayPath, setCtlEventArrayPath] = useState('')
  const [ctlOverridePolicy, setCtlOverridePolicy] = useState('KEEP_EXISTING')
  const [ctlMappingResult, setCtlMappingResult] = useState<unknown>(null)

  const [fmtEventsJson, setFmtEventsJson] = useState('[{"msg":"x"}]')
  const [fmtDestinationType, setFmtDestinationType] = useState('WEBHOOK_POST')
  const [fmtFormatterConfig, setFmtFormatterConfig] = useState('{}')
  const [fmtResult, setFmtResult] = useState<unknown>(null)

  const [rdEventsJson, setRdEventsJson] = useState('[{"k":1}]')
  const [rdResult, setRdResult] = useState<unknown>(null)

  const parsedRawResponseForTree = useMemo(() => {
    const trimmed = mappingRawResponseJson.trim()
    if (!trimmed) {
      return { ok: true as const, value: {} as unknown }
    }
    try {
      return { ok: true as const, value: JSON.parse(trimmed) as unknown }
    } catch {
      return { ok: false as const, value: null }
    }
  }, [mappingRawResponseJson])

  const setStatus = (tab: TabKey, patch: Partial<ApiState>) => {
    setApiState((prev) => ({ ...prev, [tab]: { ...prev[tab], ...patch } }))
  }

  const withApi = async (tab: TabKey, work: () => Promise<void>) => {
    setStatus(tab, { loading: true, error: '', success: '' })
    try {
      await work()
      setStatus(tab, { loading: false, success: '요청 성공' })
    } catch (error) {
      setStatus(tab, { loading: false, error: (error as Error).message })
    }
  }

  const setObsStatus = (key: ObsApiKey, patch: Partial<ApiState>) => {
    setObsApi((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  }

  const withObs = async (key: ObsApiKey, work: () => Promise<void>) => {
    setObsStatus(key, { loading: true, error: '', success: '' })
    try {
      await work()
      setObsStatus(key, { loading: false, success: '요청 성공' })
    } catch (error) {
      setObsStatus(key, { loading: false, error: (error as Error).message })
    }
  }

  const setCtrlStatus = (key: CtrlApiKey, patch: Partial<ApiState>) => {
    setCtrlApi((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  }

  const withCtrl = async (key: CtrlApiKey, work: () => Promise<void>) => {
    setCtrlStatus(key, { loading: true, error: '', success: '' })
    try {
      await work()
      setCtrlStatus(key, { loading: false, success: '요청 성공' })
    } catch (error) {
      setCtrlStatus(key, { loading: false, error: (error as Error).message })
    }
  }

  const loadDashboardSummary = async () => {
    await withObs('dashboard', async () => {
      const lim = dashboardLimit.trim() ? Number(dashboardLimit) : 100
      const path = runtimeQuery('/api/v1/runtime/dashboard/summary', { limit: lim })
      const body = await requestJson<unknown>(path)
      setDashboardData(body)
    })
  }

  const loadStreamHealthView = async () => {
    await withObs('health', async () => {
      const sid = ids.streamId.trim()
      const lim = healthLimit.trim() ? Number(healthLimit) : 100
      const path = runtimeQuery(`/api/v1/runtime/health/stream/${encodeURIComponent(sid)}`, { limit: lim })
      const body = await requestJson<unknown>(path)
      setHealthData(body)
    })
  }

  const loadStreamStatsView = async () => {
    await withObs('stats', async () => {
      const sid = ids.streamId.trim()
      const lim = statsLimit.trim() ? Number(statsLimit) : 100
      const path = runtimeQuery(`/api/v1/runtime/stats/stream/${encodeURIComponent(sid)}`, { limit: lim })
      const body = await requestJson<unknown>(path)
      setStatsData(body)
    })
  }

  const loadTimelineView = async () => {
    await withObs('timeline', async () => {
      const sid = ids.streamId.trim()
      const lim = timelineLimit.trim() ? Number(timelineLimit) : 100
      const path = runtimeQuery(`/api/v1/runtime/timeline/stream/${encodeURIComponent(sid)}`, {
        limit: lim,
        stage: timelineStage.trim() || undefined,
        level: timelineLevel.trim() || undefined,
        status: timelineStatus.trim() || undefined,
        route_id: timelineRouteIdFilter.trim() ? Number(timelineRouteIdFilter) : undefined,
        destination_id: timelineDestinationIdFilter.trim() ? Number(timelineDestinationIdFilter) : undefined,
      })
      const body = await requestJson<unknown>(path)
      setTimelineData(body)
    })
  }

  const searchRuntimeLogs = async () => {
    await withObs('logsSearch', async () => {
      const path = runtimeQuery('/api/v1/runtime/logs/search', {
        stream_id: logSearchStreamId.trim() ? Number(logSearchStreamId) : undefined,
        route_id: logSearchRouteId.trim() ? Number(logSearchRouteId) : undefined,
        destination_id: logSearchDestinationId.trim() ? Number(logSearchDestinationId) : undefined,
        stage: logSearchStage.trim() || undefined,
        level: logSearchLevel.trim() || undefined,
        status: logSearchStatus.trim() || undefined,
        error_code: logSearchErrorCode.trim() || undefined,
        limit: logSearchLimit.trim() ? Number(logSearchLimit) : 100,
      })
      const body = await requestJson<unknown>(path)
      setLogSearchData(body)
    })
  }

  const loadLogsPageView = async () => {
    await withObs('logsPage', async () => {
      const hasCursor = Boolean(logPageCursorAt.trim() && logPageCursorId.trim())
      const path = runtimeQuery('/api/v1/runtime/logs/page', {
        limit: logPageLimit.trim() ? Number(logPageLimit) : 100,
        cursor_created_at: hasCursor ? logPageCursorAt.trim() : undefined,
        cursor_id: hasCursor ? Number(logPageCursorId) : undefined,
        stream_id: logPageStreamId.trim() ? Number(logPageStreamId) : undefined,
        route_id: logPageRouteId.trim() ? Number(logPageRouteId) : undefined,
        destination_id: logPageDestinationId.trim() ? Number(logPageDestinationId) : undefined,
        stage: logPageStage.trim() || undefined,
        level: logPageLevel.trim() || undefined,
        status: logPageStatus.trim() || undefined,
        error_code: logPageErrorCode.trim() || undefined,
      })
      const body = await requestJson<unknown>(path)
      setLogPageData(body)
    })
  }

  const loadNextLogsPage = async () => {
    if (!logPageData || typeof logPageData !== 'object') {
      return
    }
    const o = logPageData as Record<string, unknown>
    const nextAt = o.next_cursor_created_at
    const nextId = o.next_cursor_id
    if (nextAt === undefined || nextAt === null || nextId === undefined || nextId === null) {
      return
    }
    setLogPageCursorAt(String(nextAt))
    setLogPageCursorId(String(nextId))
    await withObs('logsPage', async () => {
      const path = runtimeQuery('/api/v1/runtime/logs/page', {
        limit: logPageLimit.trim() ? Number(logPageLimit) : 100,
        cursor_created_at: String(nextAt),
        cursor_id: Number(nextId),
        stream_id: logPageStreamId.trim() ? Number(logPageStreamId) : undefined,
        route_id: logPageRouteId.trim() ? Number(logPageRouteId) : undefined,
        destination_id: logPageDestinationId.trim() ? Number(logPageDestinationId) : undefined,
        stage: logPageStage.trim() || undefined,
        level: logPageLevel.trim() || undefined,
        status: logPageStatus.trim() || undefined,
        error_code: logPageErrorCode.trim() || undefined,
      })
      const body = await requestJson<unknown>(path)
      setLogPageData(body)
    })
  }

  const runLogsCleanupView = async () => {
    await withObs('logsCleanup', async () => {
      const days = Number(cleanupOlderThanDays.trim())
      if (!Number.isFinite(days) || days < 1) {
        throw new Error('older_than_days는 1 이상이어야 합니다.')
      }
      const body = await requestJson<unknown>('/api/v1/runtime/logs/cleanup', {
        method: 'POST',
        body: JSON.stringify({
          older_than_days: days,
          dry_run: cleanupDryRun,
        }),
      })
      setCleanupResult(body)
    })
  }

  const loadFailureTrendView = async () => {
    await withObs('failureTrend', async () => {
      const path = runtimeQuery('/api/v1/runtime/failures/trend', {
        limit: trendLimit.trim() ? Number(trendLimit) : 1000,
        stream_id: trendStreamId.trim() ? Number(trendStreamId) : undefined,
        route_id: trendRouteId.trim() ? Number(trendRouteId) : undefined,
        destination_id: trendDestinationId.trim() ? Number(trendDestinationId) : undefined,
      })
      const body = await requestJson<unknown>(path)
      setTrendData(body)
    })
  }

  const postStreamStart = async () => {
    await withCtrl('streamStart', async () => {
      const sid = ids.streamId.trim()
      const body = await requestJson<unknown>(`/api/v1/runtime/streams/${encodeURIComponent(sid)}/start`, {
        method: 'POST',
        body: '{}',
      })
      setStreamControlResult(body)
    })
  }

  const postStreamStop = async () => {
    await withCtrl('streamStop', async () => {
      const sid = ids.streamId.trim()
      const body = await requestJson<unknown>(`/api/v1/runtime/streams/${encodeURIComponent(sid)}/stop`, {
        method: 'POST',
        body: '{}',
      })
      setStreamControlResult(body)
    })
  }

  const runHttpApiTestPreview = async () => {
    await withCtrl('apiTest', async () => {
      const payload = {
        source_config: parseJsonObject(apiTestSource, 'source_config'),
        stream_config: parseJsonObject(apiTestStream, 'stream_config'),
        checkpoint: apiTestCheckpoint.trim() ? parseJsonObject(apiTestCheckpoint, 'checkpoint') : null,
      }
      const body = await requestJson<unknown>('/api/v1/runtime/api-test/http', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setApiTestResult(body)
    })
  }

  const runControlMappingPreview = async () => {
    await withCtrl('mappingCtl', async () => {
      const payload = {
        raw_response: parseJsonValue(ctlRawResponse, 'raw_response'),
        event_array_path: ctlEventArrayPath.trim() || null,
        field_mappings: parseFieldMappingsStrStr(ctlFieldMappingsJson, 'field_mappings'),
        enrichment: parseJsonObject(ctlEnrichmentJson, 'enrichment'),
        override_policy: ctlOverridePolicy,
      }
      const body = await requestJson<unknown>('/api/v1/runtime/preview/mapping', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setCtlMappingResult(body)
    })
  }

  const runDeliveryFormatPreview = async () => {
    await withCtrl('formatPreview', async () => {
      const payload = {
        events: parseEventsArray(fmtEventsJson, 'events'),
        destination_type: fmtDestinationType,
        formatter_config: parseJsonObject(fmtFormatterConfig, 'formatter_config'),
      }
      const body = await requestJson<unknown>('/api/v1/runtime/preview/format', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setFmtResult(body)
    })
  }

  const runRouteDeliveryPreview = async () => {
    await withCtrl('routeDeliveryPreview', async () => {
      const rid = ids.routeId.trim()
      const routeNum = Number(rid)
      if (!Number.isFinite(routeNum)) {
        throw new Error('route_id는 숫자여야 합니다.')
      }
      const payload = {
        route_id: routeNum,
        events: parseEventsArray(rdEventsJson, 'events'),
      }
      const body = await requestJson<unknown>('/api/v1/runtime/preview/route-delivery', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setRdResult(body)
    })
  }

  const loadConnector = async () => {
    await withApi('connector', async () => {
      const id = ids.connectorId.trim()
      const body = await requestJson<unknown>(`/api/v1/runtime/connectors/${id}/ui/config`)
      setConnectorConfig(prettyJson(body))
      setConnectorSave(prettyJson((body as { connector?: unknown }).connector ?? {}))
    })
  }

  const saveConnector = async () => {
    await withApi('connector', async () => {
      const id = ids.connectorId.trim()
      const payload = parseJsonObject(connectorSave, 'connector save')
      const body = await requestJson<unknown>(`/api/v1/runtime/connectors/${id}/ui/save`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setConnectorSave(prettyJson(body))
    })
  }

  const loadSource = async () => {
    await withApi('source', async () => {
      const id = ids.sourceId.trim()
      const body = await requestJson<unknown>(`/api/v1/runtime/sources/${id}/ui/config`)
      setSourceConfig(prettyJson(body))
      setSourceSave(prettyJson((body as { source?: unknown }).source ?? {}))
    })
  }

  const saveSource = async () => {
    await withApi('source', async () => {
      const id = ids.sourceId.trim()
      const sourceObj = parseJsonObject(sourceSave, 'source save')
      const payload = {
        enabled: Boolean(sourceObj.enabled),
        config_json: (sourceObj.config_json as JsonValue | undefined) ?? {},
        auth_json: (sourceObj.auth_json as JsonValue | undefined) ?? {},
      }
      const body = await requestJson<unknown>(`/api/v1/runtime/sources/${id}/ui/save`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setSourceSave(prettyJson(body))
    })
  }

  const loadStream = async () => {
    await withApi('stream', async () => {
      const id = ids.streamId.trim()
      const body = await requestJson<unknown>(`/api/v1/runtime/streams/${id}/ui/config`)
      setStreamConfig(prettyJson(body))
      setStreamSave(prettyJson((body as { stream?: unknown }).stream ?? {}))
    })
  }

  const saveStream = async () => {
    await withApi('stream', async () => {
      const id = ids.streamId.trim()
      const streamObj = parseJsonObject(streamSave, 'stream save')
      const payload = {
        name: String(streamObj.name ?? ''),
        enabled: Boolean(streamObj.enabled),
        polling_interval: Number(streamObj.polling_interval ?? 60),
        config_json: (streamObj.config_json as JsonValue | undefined) ?? {},
        rate_limit_json: (streamObj.rate_limit_json as JsonValue | undefined) ?? {},
      }
      const body = await requestJson<unknown>(`/api/v1/runtime/streams/${id}/ui/save`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setStreamSave(prettyJson(body))
    })
  }

  const loadMapping = async () => {
    await withApi('mapping', async () => {
      const id = ids.streamId.trim()
      const body = await requestJson<Record<string, unknown>>(`/api/v1/runtime/streams/${id}/mapping-ui/config`)
      setMappingConfig(prettyJson(body))
      const initialRaw = pickInitialRawResponseFromSourceConfig(body.source_config)
      setMappingRawResponseJson(prettyJson(initialRaw))
      const mapping = (body.mapping as Record<string, unknown> | undefined) ?? {}
      const fieldMappings = (mapping.field_mappings as Record<string, unknown> | undefined) ?? {}
      const rows = Object.entries(fieldMappings).map(([outputField, sourcePath]) => ({
        outputField,
        sourcePath: String(sourcePath),
        sampleValue: null,
      }))
      setMappingRows(rows)
      setMappingEventArrayPath(String(mapping.event_array_path ?? ''))
      const enrichment = (body.enrichment as Record<string, unknown> | undefined) ?? {}
      setMappingEnrichmentJson(prettyJson((enrichment.enrichment as JsonValue | undefined) ?? {}))
      setMappingOverridePolicy(String(enrichment.override_policy ?? 'KEEP_EXISTING'))
      setMappingPreviewResult('')
    })
  }

  const runMappingPreview = async () => {
    await withApi('mapping', async () => {
      const fieldMappings = Object.fromEntries(mappingRows.map((row) => [row.outputField, row.sourcePath]))
      const rawResponse = parseJsonValue(mappingRawResponseJson, 'raw_response')
      const payload = {
        raw_response: rawResponse,
        event_array_path: mappingEventArrayPath || null,
        field_mappings: fieldMappings,
        enrichment: parseJsonObject(mappingEnrichmentJson, 'mapping enrichment'),
        override_policy: mappingOverridePolicy,
      }
      const body = await requestJson<unknown>('/api/v1/runtime/preview/mapping', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setMappingPreviewResult(prettyJson(body))
    })
  }

  const loadRoute = async () => {
    await withApi('route', async () => {
      const id = ids.routeId.trim()
      const body = await requestJson<unknown>(`/api/v1/runtime/routes/${id}/ui/config`)
      setRouteConfig(prettyJson(body))
      const route = body as Record<string, unknown>
      setRouteSave(
        prettyJson({
          route_enabled: (route.route as Record<string, unknown> | undefined)?.enabled,
          destination_enabled: (route.destination as Record<string, unknown> | undefined)?.enabled,
          failure_policy: (route.route as Record<string, unknown> | undefined)?.failure_policy,
          route_formatter_config: (route.route as Record<string, unknown> | undefined)?.formatter_config_json ?? {},
          route_rate_limit: (route.route as Record<string, unknown> | undefined)?.rate_limit_json ?? {},
        }),
      )
    })
  }

  const saveRoute = async () => {
    await withApi('route', async () => {
      const id = ids.routeId.trim()
      const payload = parseJsonObject(routeSave, 'route save')
      const body = await requestJson<unknown>(`/api/v1/runtime/routes/${id}/ui/save`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setRouteSave(prettyJson(body))
    })
  }

  const loadDestination = async () => {
    await withApi('destination', async () => {
      const id = ids.destinationId.trim()
      const body = await requestJson<unknown>(`/api/v1/runtime/destinations/${id}/ui/config`)
      setDestinationConfig(prettyJson(body))
      setDestinationSave(prettyJson((body as { destination?: unknown }).destination ?? {}))
    })
  }

  const saveDestination = async () => {
    await withApi('destination', async () => {
      const id = ids.destinationId.trim()
      const destinationObj = parseJsonObject(destinationSave, 'destination save')
      const payload = {
        name: String(destinationObj.name ?? ''),
        enabled: Boolean(destinationObj.enabled),
        config_json: (destinationObj.config_json as JsonValue | undefined) ?? {},
        rate_limit_json: (destinationObj.rate_limit_json as JsonValue | undefined) ?? {},
      }
      const body = await requestJson<unknown>(`/api/v1/runtime/destinations/${id}/ui/save`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setDestinationSave(prettyJson(body))
    })
  }

  const appendJsonPath = () => {
    if (!mappingTargetField || !selectedJsonPath) {
      return
    }
    setMappingRows((prev) => {
      const exists = prev.find((row) => row.outputField === mappingTargetField)
      if (exists) {
        return prev.map((row) =>
          row.outputField === mappingTargetField ? { ...row, sourcePath: selectedJsonPath } : row,
        )
      }
      return [...prev, { outputField: mappingTargetField, sourcePath: selectedJsonPath, sampleValue: null }]
    })
  }

  const dashRec =
    dashboardData !== null && typeof dashboardData === 'object' ? (dashboardData as Record<string, unknown>) : null
  const dashSummary =
    dashRec?.summary !== undefined &&
    dashRec.summary !== null &&
    typeof dashRec.summary === 'object' &&
    !Array.isArray(dashRec.summary)
      ? (dashRec.summary as Record<string, unknown>)
      : null
  const dashProblems = Array.isArray(dashRec?.recent_problem_routes) ? dashRec.recent_problem_routes : []
  const dashRateLimited = Array.isArray(dashRec?.recent_rate_limited_routes) ? dashRec.recent_rate_limited_routes : []
  const dashUnhealthy = Array.isArray(dashRec?.recent_unhealthy_streams) ? dashRec.recent_unhealthy_streams : []

  const healthRec =
    healthData !== null && typeof healthData === 'object' ? (healthData as Record<string, unknown>) : null
  const healthSummary =
    healthRec?.summary !== undefined &&
    healthRec.summary !== null &&
    typeof healthRec.summary === 'object' &&
    !Array.isArray(healthRec.summary)
      ? (healthRec.summary as Record<string, unknown>)
      : null
  const healthRoutes = Array.isArray(healthRec?.routes) ? healthRec.routes : []

  const statsRec =
    statsData !== null && typeof statsData === 'object' ? (statsData as Record<string, unknown>) : null
  const statsSummary =
    statsRec?.summary !== undefined &&
    statsRec.summary !== null &&
    typeof statsRec.summary === 'object' &&
    !Array.isArray(statsRec.summary)
      ? (statsRec.summary as Record<string, unknown>)
      : null
  const statsRoutes = Array.isArray(statsRec?.routes) ? statsRec.routes : []
  const statsRecentLogs = Array.isArray(statsRec?.recent_logs) ? statsRec.recent_logs : []

  const timelineRec =
    timelineData !== null && typeof timelineData === 'object' ? (timelineData as Record<string, unknown>) : null
  const timelineItems = Array.isArray(timelineRec?.items) ? timelineRec.items : []

  const logSearchRec =
    logSearchData !== null && typeof logSearchData === 'object' ? (logSearchData as Record<string, unknown>) : null
  const logSearchRows = Array.isArray(logSearchRec?.logs) ? logSearchRec.logs : []

  const logPageRec =
    logPageData !== null && typeof logPageData === 'object' ? (logPageData as Record<string, unknown>) : null
  const logPageItems = Array.isArray(logPageRec?.items) ? logPageRec.items : []
  const logPageHasNext = Boolean(logPageRec?.has_next)
  const logPageNextAt = logPageRec?.next_cursor_created_at
  const logPageNextId = logPageRec?.next_cursor_id

  const trendRec = trendData !== null && typeof trendData === 'object' ? (trendData as Record<string, unknown>) : null
  const trendBuckets = Array.isArray(trendRec?.buckets) ? trendRec.buckets : []

  const scr =
    streamControlResult !== null && typeof streamControlResult === 'object'
      ? (streamControlResult as Record<string, unknown>)
      : null

  const apiTestRec =
    apiTestResult !== null && typeof apiTestResult === 'object' ? (apiTestResult as Record<string, unknown>) : null
  const apiTestExtracted = Array.isArray(apiTestRec?.extracted_events) ? apiTestRec.extracted_events : []

  const ctlMapRec =
    ctlMappingResult !== null && typeof ctlMappingResult === 'object' ? (ctlMappingResult as Record<string, unknown>) : null
  const ctlPreviewEvents = Array.isArray(ctlMapRec?.preview_events) ? ctlMapRec.preview_events : []

  const fmtRec = fmtResult !== null && typeof fmtResult === 'object' ? (fmtResult as Record<string, unknown>) : null
  const rdRec = rdResult !== null && typeof rdResult === 'object' ? (rdResult as Record<string, unknown>) : null

  const handleResetIds = () => {
    setIds({
      connectorId: '',
      sourceId: '',
      streamId: '',
      routeId: '',
      destinationId: '',
    })
    clearPersistedEntityIds()
  }

  const handleResetUiPreferences = () => {
    setDensity('comfortable')
    clearUiPreferenceKeys()
    persistDisplayDensity('comfortable')
  }

  const handleApplyApiUrlOverride = () => {
    persistApiBaseUrlOverride(apiUrlOverrideDraft)
    setApiUrlRevision((n) => n + 1)
  }

  const handleResetApiUrl = () => {
    clearApiBaseUrlOverride()
    setApiUrlOverrideDraft('')
    setApiUrlRevision((n) => n + 1)
  }

  return (
    <main className="runtime-page" data-density={density}>
      <header className="topbar">
        <div>
          <h1>Runtime Management MVP</h1>
          <p className="topbar-api-meta">
            Effective API base URL: <code>{effectiveApiBase}</code>
            <span className="muted"> · Default (env): {API_BASE_URL}</span>
          </p>
        </div>
      </header>

      <section className="operator-toolbar" aria-label="Operator preferences">
        <div className="density-toggle" role="radiogroup" aria-label="Display density">
          <span className="toolbar-label">Display density</span>
          <button
            type="button"
            className={density === 'comfortable' ? 'active' : ''}
            role="radio"
            aria-checked={density === 'comfortable'}
            onClick={() => setDensity('comfortable')}
          >
            Comfortable
          </button>
          <button
            type="button"
            className={density === 'compact' ? 'active' : ''}
            role="radio"
            aria-checked={density === 'compact'}
            onClick={() => setDensity('compact')}
          >
            Compact
          </button>
        </div>
        <button type="button" onClick={handleResetIds}>
          Reset IDs
        </button>
        <button type="button" onClick={handleResetUiPreferences}>
          Reset UI preferences
        </button>
        <div className="api-url-toolbar">
          <label className="api-override-label">
            API base URL override (optional)
            <input
              value={apiUrlOverrideDraft}
              onChange={(e) => setApiUrlOverrideDraft(e.target.value)}
              spellCheck={false}
              placeholder=""
              aria-label="API base URL override (optional)"
            />
          </label>
          <button type="button" onClick={handleApplyApiUrlOverride}>
            Apply API URL override
          </button>
          <button type="button" onClick={handleResetApiUrl}>
            Reset API URL
          </button>
        </div>
      </section>

      <nav className="app-section-nav" aria-label="Primary views">
        {(Object.keys(SECTION_LABELS) as AppSection[]).map((key) => (
          <button
            key={key}
            className={activeSection === key ? 'active' : ''}
            type="button"
            onClick={() => setActiveSection(key)}
          >
            {SECTION_LABELS[key]}
          </button>
        ))}
      </nav>

      <section className="id-grid">
        <label>
          connector_id
          <input value={ids.connectorId} onChange={(e) => setIds({ ...ids, connectorId: e.target.value })} />
        </label>
        <label>
          source_id
          <input value={ids.sourceId} onChange={(e) => setIds({ ...ids, sourceId: e.target.value })} />
        </label>
        <label>
          stream_id
          <input value={ids.streamId} onChange={(e) => setIds({ ...ids, streamId: e.target.value })} />
        </label>
        <label>
          route_id
          <input value={ids.routeId} onChange={(e) => setIds({ ...ids, routeId: e.target.value })} />
        </label>
        <label>
          destination_id
          <input value={ids.destinationId} onChange={(e) => setIds({ ...ids, destinationId: e.target.value })} />
        </label>
      </section>

      {activeSection === 'config' && (
        <RuntimeConfigSection
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          apiState={apiState}
          connectorConfig={connectorConfig}
          connectorSave={connectorSave}
          setConnectorSave={setConnectorSave}
          loadConnector={loadConnector}
          saveConnector={saveConnector}
          sourceConfig={sourceConfig}
          sourceSave={sourceSave}
          setSourceSave={setSourceSave}
          loadSource={loadSource}
          saveSource={saveSource}
          streamConfig={streamConfig}
          streamSave={streamSave}
          setStreamSave={setStreamSave}
          loadStream={loadStream}
          saveStream={saveStream}
          mappingConfig={mappingConfig}
          mappingRawResponseJson={mappingRawResponseJson}
          setMappingRawResponseJson={setMappingRawResponseJson}
          mappingRows={mappingRows}
          mappingEventArrayPath={mappingEventArrayPath}
          setMappingEventArrayPath={setMappingEventArrayPath}
          mappingEnrichmentJson={mappingEnrichmentJson}
          setMappingEnrichmentJson={setMappingEnrichmentJson}
          mappingOverridePolicy={mappingOverridePolicy}
          setMappingOverridePolicy={setMappingOverridePolicy}
          mappingPreviewResult={mappingPreviewResult}
          selectedJsonPath={selectedJsonPath}
          mappingTargetField={mappingTargetField}
          setMappingTargetField={setMappingTargetField}
          setSelectedJsonPath={setSelectedJsonPath}
          parsedRawResponseForTree={parsedRawResponseForTree}
          loadMapping={loadMapping}
          runMappingPreview={runMappingPreview}
          appendJsonPath={appendJsonPath}
          routeConfig={routeConfig}
          routeSave={routeSave}
          setRouteSave={setRouteSave}
          loadRoute={loadRoute}
          saveRoute={saveRoute}
          destinationConfig={destinationConfig}
          destinationSave={destinationSave}
          setDestinationSave={setDestinationSave}
          loadDestination={loadDestination}
          saveDestination={saveDestination}
        />
      )}

      <ObservabilitySection
        activeSection={activeSection}
        obsApi={obsApi}
        dashboard={{
          limit: dashboardLimit,
          setLimit: setDashboardLimit,
          onLoad: loadDashboardSummary,
          summary: dashSummary,
          problems: dashProblems,
          rateLimited: dashRateLimited,
          unhealthy: dashUnhealthy,
        }}
        health={{
          limit: healthLimit,
          setLimit: setHealthLimit,
          onLoad: loadStreamHealthView,
          healthRec,
          summary: healthSummary,
          routes: healthRoutes,
        }}
        stats={{
          limit: statsLimit,
          setLimit: setStatsLimit,
          onLoad: loadStreamStatsView,
          statsRec,
          summary: statsSummary,
          routes: statsRoutes,
          recentLogs: statsRecentLogs,
        }}
        timeline={{
          limit: timelineLimit,
          setLimit: setTimelineLimit,
          stage: timelineStage,
          setStage: setTimelineStage,
          level: timelineLevel,
          setLevel: setTimelineLevel,
          status: timelineStatus,
          setStatus: setTimelineStatus,
          routeIdFilter: timelineRouteIdFilter,
          setRouteIdFilter: setTimelineRouteIdFilter,
          destinationIdFilter: timelineDestinationIdFilter,
          setDestinationIdFilter: setTimelineDestinationIdFilter,
          onLoad: loadTimelineView,
          timelineRec,
          items: timelineItems,
        }}
        logs={{
          search: {
            streamId: logSearchStreamId,
            setStreamId: setLogSearchStreamId,
            routeId: logSearchRouteId,
            setRouteId: setLogSearchRouteId,
            destinationId: logSearchDestinationId,
            setDestinationId: setLogSearchDestinationId,
            stage: logSearchStage,
            setStage: setLogSearchStage,
            level: logSearchLevel,
            setLevel: setLogSearchLevel,
            status: logSearchStatus,
            setStatus: setLogSearchStatus,
            errorCode: logSearchErrorCode,
            setErrorCode: setLogSearchErrorCode,
            limit: logSearchLimit,
            setLimit: setLogSearchLimit,
            onSearch: searchRuntimeLogs,
            searchRec: logSearchRec,
            rows: logSearchRows,
          },
          page: {
            limit: logPageLimit,
            setLimit: setLogPageLimit,
            cursorAt: logPageCursorAt,
            setCursorAt: setLogPageCursorAt,
            cursorId: logPageCursorId,
            setCursorId: setLogPageCursorId,
            streamId: logPageStreamId,
            setStreamId: setLogPageStreamId,
            routeId: logPageRouteId,
            setRouteId: setLogPageRouteId,
            destinationId: logPageDestinationId,
            setDestinationId: setLogPageDestinationId,
            stage: logPageStage,
            setStage: setLogPageStage,
            level: logPageLevel,
            setLevel: setLogPageLevel,
            status: logPageStatus,
            setStatus: setLogPageStatus,
            errorCode: logPageErrorCode,
            setErrorCode: setLogPageErrorCode,
            onLoadPage: loadLogsPageView,
            onNextPage: loadNextLogsPage,
            pageRec: logPageRec,
            hasNext: logPageHasNext,
            nextAt: logPageNextAt,
            nextId: logPageNextId,
            items: logPageItems,
          },
          cleanup: {
            olderThanDays: cleanupOlderThanDays,
            setOlderThanDays: setCleanupOlderThanDays,
            dryRun: cleanupDryRun,
            setDryRun: setCleanupDryRun,
            onCleanup: runLogsCleanupView,
            result: cleanupResult,
          },
        }}
        failureTrend={{
          limit: trendLimit,
          setLimit: setTrendLimit,
          streamId: trendStreamId,
          setStreamId: setTrendStreamId,
          routeId: trendRouteId,
          setRouteId: setTrendRouteId,
          destinationId: trendDestinationId,
          setDestinationId: setTrendDestinationId,
          onLoad: loadFailureTrendView,
          trendRec,
          buckets: trendBuckets,
        }}
      />

      {activeSection === 'controlTest' && (
        <ControlTestSection
          ctrlApi={ctrlApi}
          streamControl={{
            result: scr,
            onStart: postStreamStart,
            onStop: postStreamStop,
          }}
          apiTest={{
            source: apiTestSource,
            setSource: setApiTestSource,
            stream: apiTestStream,
            setStream: setApiTestStream,
            checkpoint: apiTestCheckpoint,
            setCheckpoint: setApiTestCheckpoint,
            onRun: runHttpApiTestPreview,
            result: apiTestRec,
            extracted: apiTestExtracted,
          }}
          mappingPreview={{
            rawResponse: ctlRawResponse,
            setRawResponse: setCtlRawResponse,
            fieldMappingsJson: ctlFieldMappingsJson,
            setFieldMappingsJson: setCtlFieldMappingsJson,
            enrichmentJson: ctlEnrichmentJson,
            setEnrichmentJson: setCtlEnrichmentJson,
            eventArrayPath: ctlEventArrayPath,
            setEventArrayPath: setCtlEventArrayPath,
            overridePolicy: ctlOverridePolicy,
            setOverridePolicy: setCtlOverridePolicy,
            onRun: runControlMappingPreview,
            result: ctlMapRec,
            previewEvents: ctlPreviewEvents,
          }}
          formatPreview={{
            eventsJson: fmtEventsJson,
            setEventsJson: setFmtEventsJson,
            destinationType: fmtDestinationType,
            setDestinationType: setFmtDestinationType,
            formatterConfig: fmtFormatterConfig,
            setFormatterConfig: setFmtFormatterConfig,
            onRun: runDeliveryFormatPreview,
            result: fmtRec,
          }}
          routePreview={{
            eventsJson: rdEventsJson,
            setEventsJson: setRdEventsJson,
            onRun: runRouteDeliveryPreview,
            result: rdRec,
          }}
        />
      )}
    </main>
  )
}
