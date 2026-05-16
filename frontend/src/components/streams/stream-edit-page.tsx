import { ChevronDown, Copy, Loader2, Play, ShieldCheck, Square, Tag, Trash2 } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { StatusBadge } from '../shell/status-badge'
import { fetchRoutesList } from '../../api/gdcRoutes'
import { deleteStream, fetchStreamById, updateStream } from '../../api/gdcStreams'
import { NAV_PATH, streamApiTestPath, streamRuntimePath } from '../../config/nav-paths'
import { cn } from '../../lib/utils'
import { fetchConnectorById } from '../../api/gdcConnectors'
import {
  fetchStreamMappingUiConfig,
  fetchStreamRuntimeHealth,
  fetchStreamRuntimeStats,
  runStreamOnce,
  startRuntimeStream,
  stopRuntimeStream,
} from '../../api/gdcRuntime'
import { runHttpApiTest, runConnectorAuthTest, type ConnectorAuthTestResponse, type HttpApiTestResponse } from '../../api/gdcRuntimePreview'
import type { MappingUIConfigResponse, StreamRead } from '../../api/types/gdcApi'
import { mapBackendStreamStatus } from '../../api/streamRows'
import { saveSourceUiConfig } from '../../api/gdcRuntimeUi'
import { workflowOverridesFromMappingUi } from '../../utils/mappingUiWorkflow'
import { computeStreamWorkflow } from '../../utils/streamWorkflow'
import { resolveSourceTypePresentation } from '../../utils/sourceTypePresentation'
import {
  buildOperationalStreamBadges,
  operationalRunControlTooltipSupplement,
} from '../../utils/streamOperationalBadges'
import { StreamOperationalBadges } from './stream-operational-badges'
import { formatRunOnceErrorLines, formatRunOnceSummaryLines } from '../../utils/formatRunOnceSummary'
import { StreamWorkflowChecklist } from './stream-workflow-checklist'
import { RemoteFileProbeSummary } from '../connectors/remote-file-probe-summary'
import { StreamEditDeliveryPanel } from './stream-edit-delivery-panel'
import type { StreamRuntimeStatus } from '../../api/streamRows'

const SAMPLE_PLACEHOLDER = `Connect to the API with "Test Connection" to load a live response here.

(Previously this panel showed static placeholder JSON only.)`

function normalizeHttpMethod(cfg: Record<string, unknown>): string {
  const m = String(cfg.method ?? cfg.http_method ?? 'GET').toUpperCase()
  return m === 'POST' ? 'POST' : 'GET'
}

function normalizeEndpointPath(cfg: Record<string, unknown>): string {
  return String(cfg.endpoint ?? cfg.endpoint_path ?? '').trim()
}

function parseTimeoutSec(cfg: Record<string, unknown>): string {
  const raw = cfg.timeout_seconds ?? cfg.timeout_sec
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  if (typeof raw === 'string' && raw.trim()) return raw
  return '30'
}

function parseInitialDelaySec(cfg: Record<string, unknown>): string {
  const raw = cfg.initial_delay_sec ?? cfg.initialDelaySec
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  if (typeof raw === 'string' && raw.trim()) return raw
  return '0'
}

function normalizePaginationLabel(raw: string): string {
  const t = raw.trim()
  if (!t || t.toLowerCase() === 'none') return 'None'
  return raw.trim()
}

function inferPaginationAndParams(cfg: Record<string, unknown>): {
  paginationType: string
  cursorParam: string
  pageSize: string
  maxPages: string
} {
  const pag = (cfg.pagination ?? {}) as Record<string, unknown>
  const rawType = typeof pag.type === 'string' ? pag.type.trim() : ''
  const paginationType = rawType ? normalizePaginationLabel(rawType) : 'None'

  const out = {
    paginationType,
    cursorParam: typeof pag.cursor_param === 'string' ? pag.cursor_param.trim() : '',
    pageSize: '',
    maxPages: '0',
  }
  const ps = pag.page_size
  if (typeof ps === 'number' && Number.isFinite(ps) && ps > 0) out.pageSize = String(ps)
  else if (typeof ps === 'string' && ps.trim()) out.pageSize = ps
  const mp = pag.max_pages
  if (typeof mp === 'number' && Number.isFinite(mp)) out.maxPages = String(mp)
  else if (typeof mp === 'string') out.maxPages = mp

  const prm = (cfg.params ?? {}) as Record<string, unknown>
  if (out.paginationType !== 'None' && prm && typeof prm === 'object') {
    if (prm.limit != null && out.pageSize === '') out.pageSize = String(prm.limit)
    if (!out.cursorParam) {
      for (const k of Object.keys(prm)) {
        if (k === 'limit') continue
        if (prm[k] != null && typeof prm[k] !== 'object') {
          out.cursorParam = k
          break
        }
      }
    }
  }
  return out
}

function buildPersistParams(form: {
  paginationType: string
  cursorParam: string
}): Record<string, string> {
  if (normalizePaginationLabel(form.paginationType) === 'None') return {}
  const cp = form.cursorParam.trim()
  if (!cp) return {}
  return { [cp]: '{{checkpoint.cursor}}' }
}

function buildApiTestParams(form: { paginationType: string; cursorParam: string }): Record<string, string> {
  if (normalizePaginationLabel(form.paginationType) === 'None') return {}
  const cp = form.cursorParam.trim()
  if (!cp) return {}
  return { [cp]: '{{checkpoint}}' }
}

function streamConfigBodyText(cfg: Record<string, unknown>): string {
  const body = cfg.body ?? cfg.request_body
  if (body === undefined || body === null) return ''
  if (typeof body === 'string') return body
  try {
    return JSON.stringify(body, null, 2)
  } catch {
    return ''
  }
}

function truncateSampleJson(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return `${text.slice(0, maxLen)}\n… (truncated)`
}

function applyStreamReadToForm(found: StreamRead, mappingSourceBaseUrl: string | null): {
  streamName: string
  description: string
  httpMethod: string
  baseUrl: string
  endpointPath: string
  pollingInterval: string
  timeoutSec: string
  initialDelaySec: string
  paginationType: string
  cursorParam: string
  pageSize: string
  maxPages: string
  rateLimitPerMinute: string
  rateLimitBurst: string
  schemaRootPath: string
  checkpointMode: string
  checkpointCursorPath: string
  checkpointSecondaryPath: string
  selectedTags: string[]
  connectorId: number | null
  requestBodyText: string
} {
  const cfg = (found.config_json ?? {}) as Record<string, unknown>
  const pagParams = inferPaginationAndParams(cfg)
  const schema = (cfg.schema ?? {}) as Record<string, unknown>
  const ck = (cfg.checkpoint ?? {}) as Record<string, unknown>
  const descFromCfg = typeof cfg.description === 'string' ? cfg.description : ''
  const baseFromStream = typeof cfg.base_url === 'string' ? cfg.base_url.trim() : ''
  const baseUrl =
    baseFromStream || (mappingSourceBaseUrl && mappingSourceBaseUrl.trim() ? mappingSourceBaseUrl.trim() : '')

  let tags: string[] = []
  if (Array.isArray(cfg.tags) && cfg.tags.every((t) => typeof t === 'string')) {
    tags = cfg.tags as string[]
  }

  const rl = found.rate_limit_json ?? {}
  let rateLimitPerMinute = '100'
  let rateLimitBurst = '10'
  if (typeof rl.per_minute === 'number' && Number.isFinite(rl.per_minute)) rateLimitPerMinute = String(rl.per_minute)
  if (typeof rl.burst === 'number' && Number.isFinite(rl.burst)) rateLimitBurst = String(rl.burst)

  const polling =
    typeof found.polling_interval === 'number' && found.polling_interval > 0 ? String(found.polling_interval) : '60'

  return {
    streamName: (found.name ?? '').trim() || `Stream ${found.id}`,
    description: descFromCfg || (found.status ? `Status: ${found.status}` : ''),
    httpMethod: normalizeHttpMethod(cfg),
    baseUrl,
    endpointPath: normalizeEndpointPath(cfg) || '',
    pollingInterval: polling,
    timeoutSec: parseTimeoutSec(cfg),
    initialDelaySec: parseInitialDelaySec(cfg),
    paginationType: pagParams.paginationType,
    cursorParam: pagParams.cursorParam,
    pageSize: pagParams.pageSize,
    maxPages: pagParams.maxPages,
    rateLimitPerMinute,
    rateLimitBurst,
    schemaRootPath: typeof schema.root_path === 'string' && schema.root_path.trim() ? schema.root_path : '',
    checkpointMode: typeof ck.mode === 'string' && ck.mode.trim() ? ck.mode : 'Cursor',
    checkpointCursorPath:
      typeof ck.cursor_path === 'string' && ck.cursor_path.trim()
        ? ck.cursor_path
        : Array.isArray(ck.cursor_paths) && typeof ck.cursor_paths[0] === 'string'
          ? ck.cursor_paths[0]
          : '',
    checkpointSecondaryPath:
      typeof ck.secondary_cursor_path === 'string' && ck.secondary_cursor_path.trim()
        ? ck.secondary_cursor_path
        : Array.isArray(ck.cursor_paths) && typeof ck.cursor_paths[1] === 'string'
          ? ck.cursor_paths[1]
          : '',
    selectedTags: tags,
    connectorId: typeof found.connector_id === 'number' ? found.connector_id : null,
    requestBodyText: streamConfigBodyText(cfg),
  }
}

const TAG_CHOICES = ['malop', 'edr', 'threat', 'security', 'api'] as const

export function StreamEditPage() {
  const { streamId = 'draft' } = useParams<{ streamId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const backendStreamId = /^\d+$/.test(streamId) ? Number(streamId) : null

  const [streamName, setStreamName] = useState('')
  const [description, setDescription] = useState('')
  const [httpMethod, setHttpMethod] = useState('GET')
  const [baseUrl, setBaseUrl] = useState('')
  const [endpointPath, setEndpointPath] = useState('')
  const [pollingInterval, setPollingInterval] = useState('60')
  const [timeoutSec, setTimeoutSec] = useState('30')
  const [initialDelaySec, setInitialDelaySec] = useState('0')
  const [paginationType, setPaginationType] = useState('None')
  const [cursorParam, setCursorParam] = useState('')
  const [pageSize, setPageSize] = useState('')
  const [maxPages, setMaxPages] = useState('0')
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState('100')
  const [rateLimitBurst, setRateLimitBurst] = useState('10')
  const [schemaRootPath, setSchemaRootPath] = useState('')
  const [checkpointMode, setCheckpointMode] = useState('Cursor')
  const [checkpointCursorPath, setCheckpointCursorPath] = useState('')
  const [checkpointSecondaryPath, setCheckpointSecondaryPath] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  const initialConfigSnapshot = JSON.stringify({
    httpMethod: 'GET',
    baseUrl: '',
    endpointPath: '',
    pollingInterval: '60',
    timeoutSec: '30',
    initialDelaySec: '0',
    paginationType: 'None',
    cursorParam: '',
    pageSize: '',
    maxPages: '0',
    rateLimitPerMinute: '100',
    rateLimitBurst: '10',
    schemaRootPath: '',
    checkpointMode: 'Cursor',
    checkpointCursorPath: '',
    checkpointSecondaryPath: '',
    selectedTags: [],
    requestBodyText: '',
    s3EndpointUrl: '',
    s3Bucket: '',
    s3Prefix: '',
    s3Region: 'us-east-1',
    s3AccessKey: '',
    s3SecretKey: '',
    s3PathStyle: true,
    s3UseSsl: false,
    s3MaxObjects: '20',
    isS3ObjectPolling: false,
    isDatabaseQuery: false,
    dbSqlQuery: 'SELECT id, event_time, severity, message FROM security_events',
    dbMaxRows: '100',
    dbCkMode: 'NONE',
    dbCkCol: '',
    dbCkOrd: '',
    dbQueryTimeout: '30',
  })
  const [baseline, setBaseline] = useState<{ name: string; description: string; configSnapshot: string }>({
    name: '',
    description: '',
    configSnapshot: initialConfigSnapshot,
  })
  const [runtimeStatus, setRuntimeStatus] = useState<StreamRuntimeStatus>('UNKNOWN')
  const [runtimeEvents1h, setRuntimeEvents1h] = useState(0)
  const [runtimeDeliveryPct, setRuntimeDeliveryPct] = useState(0)
  const [runtimeRoutesTotal, setRuntimeRoutesTotal] = useState(0)
  const [runtimeRoutesOk, setRuntimeRoutesOk] = useState(0)
  const [runtimeRoutesErr, setRuntimeRoutesErr] = useState(0)
  const [runtimeDestinationsTotal, setRuntimeDestinationsTotal] = useState(0)
  const [runtimeLastSuccessAt, setRuntimeLastSuccessAt] = useState<string | null>(null)
  const [runtimeLastErrorAt, setRuntimeLastErrorAt] = useState<string | null>(null)
  const [runtimeLastErrorMessage, setRuntimeLastErrorMessage] = useState<string | null>(null)
  const [controlBusy, setControlBusy] = useState(false)
  const [controlMessage, setControlMessage] = useState<string | null>(null)
  const [runOnceBusy, setRunOnceBusy] = useState(false)
  const [runOnceNotice, setRunOnceNotice] = useState<{ variant: 'success' | 'error'; lines: string[] } | null>(null)
  const [connectorId, setConnectorId] = useState<number | null>(null)
  const [connectorDisplayName, setConnectorDisplayName] = useState<string | null>(null)
  const [connectorRemoteProtocol, setConnectorRemoteProtocol] = useState<string | null>(null)
  const [connectorDbType, setConnectorDbType] = useState<string | null>(null)
  const [streamRouteCount, setStreamRouteCount] = useState(0)
  /** DB-backed mapping-ui config: drives workflow route step when runtime health has not counted successes yet. */
  const [mappingUiWorkflowCfg, setMappingUiWorkflowCfg] = useState<MappingUIConfigResponse | null>(null)
  const [apiStreamStatus, setApiStreamStatus] = useState<string | null>(null)
  const [streamDeleteOpen, setStreamDeleteOpen] = useState(false)
  const [streamDeleteConfirm, setStreamDeleteConfirm] = useState('')
  const [streamDeleteBusy, setStreamDeleteBusy] = useState(false)
  const [streamDeleteError, setStreamDeleteError] = useState<string | null>(null)
  const [mappingEventArrayPath, setMappingEventArrayPath] = useState('')
  const [mappingEventRootPath, setMappingEventRootPath] = useState('')
  const [apiTestBusy, setApiTestBusy] = useState(false)
  const [apiTestError, setApiTestError] = useState<string | null>(null)
  const [liveSampleJson, setLiveSampleJson] = useState<string | null>(null)
  const [liveSampleMeta, setLiveSampleMeta] = useState<{ status: number; latencyMs: number } | null>(null)
  const [lastTestOutbound, setLastTestOutbound] = useState<HttpApiTestResponse['actual_request_sent']>(null)
  const [remoteFileProbe, setRemoteFileProbe] = useState<ConnectorAuthTestResponse | null>(null)
  const [requestBodyText, setRequestBodyText] = useState('')
  const [streamSnapshotCfg, setStreamSnapshotCfg] = useState<Record<string, unknown>>({})
  const [s3EndpointUrl, setS3EndpointUrl] = useState('')
  const [s3Bucket, setS3Bucket] = useState('')
  const [s3Prefix, setS3Prefix] = useState('')
  const [s3Region, setS3Region] = useState('us-east-1')
  const [s3AccessKey, setS3AccessKey] = useState('')
  const [s3SecretKey, setS3SecretKey] = useState('')
  const [s3PathStyle, setS3PathStyle] = useState(true)
  const [s3UseSsl, setS3UseSsl] = useState(false)
  const [s3MaxObjects, setS3MaxObjects] = useState('20')
  const [dbSqlQuery, setDbSqlQuery] = useState('SELECT id, event_time, severity, message FROM security_events')
  const [dbMaxRows, setDbMaxRows] = useState('100')
  const [dbCkMode, setDbCkMode] = useState('NONE')
  const [dbCkCol, setDbCkCol] = useState('')
  const [dbCkOrd, setDbCkOrd] = useState('')
  const [dbQueryTimeout, setDbQueryTimeout] = useState('30')

  const [rfRemoteDirectory, setRfRemoteDirectory] = useState('')
  const [rfFilePattern, setRfFilePattern] = useState('*')
  const [rfRecursive, setRfRecursive] = useState(false)
  const [rfParserType, setRfParserType] = useState('NDJSON')
  const [rfMaxFiles, setRfMaxFiles] = useState('10')
  const [rfMaxMb, setRfMaxMb] = useState('5')
  const [rfEncoding, setRfEncoding] = useState('utf-8')
  const [rfCsvDelimiter, setRfCsvDelimiter] = useState(',')
  const [rfLineField, setRfLineField] = useState('line')
  const [rfIncludeMeta, setRfIncludeMeta] = useState(false)

  const isS3ObjectPolling = (mappingUiWorkflowCfg?.source_type ?? '').toUpperCase() === 'S3_OBJECT_POLLING'
  const isDatabaseQuery = (mappingUiWorkflowCfg?.source_type ?? '').toUpperCase() === 'DATABASE_QUERY'
  const isRemoteFilePolling = (mappingUiWorkflowCfg?.source_type ?? '').toUpperCase() === 'REMOTE_FILE_POLLING'

  const sourceUi = useMemo(
    () => resolveSourceTypePresentation(mappingUiWorkflowCfg?.source_type),
    [mappingUiWorkflowCfg?.source_type],
  )
  const isHttpSourcePoll = sourceUi.key === 'HTTP_API_POLLING'

  useEffect(() => {
    const section = (searchParams.get('section') ?? '').toLowerCase()
    const sectionId =
      section === 'delivery'
        ? 'delivery-section'
        : section === 'connection' || section === 'api' || section === 'api_test'
          ? 'http-request-section'
          : section === 'mapping'
            ? 'schema-detection-section'
            : null
    if (sectionId) {
      window.requestAnimationFrame(() => document.getElementById(sectionId)?.scrollIntoView({ block: 'start' }))
    }
  }, [searchParams])

  useEffect(() => {
    let cancelled = false
    if (backendStreamId == null) return
    ;(async () => {
      const found = await fetchStreamById(backendStreamId)
      if (!found || cancelled) return

      const mapping = await fetchStreamMappingUiConfig(backendStreamId)
      setMappingUiWorkflowCfg(mapping ?? null)
      const src = mapping?.source_config ?? {}
      setStreamSnapshotCfg((found.config_json ?? {}) as Record<string, unknown>)
      const mappingBase =
        typeof src.base_url === 'string' && src.base_url.trim().length > 0 ? String(src.base_url).trim() : null

      const streamSourceType = (mapping?.source_type ?? '').toUpperCase()

      let snapIsS3ObjectPolling = false
      let snapS3EndpointUrl = ''
      let snapS3Bucket = ''
      let snapS3Prefix = ''
      let snapS3Region = 'us-east-1'
      let snapS3AccessKey = ''
      let snapS3SecretKey = ''
      let snapS3PathStyle = true
      let snapS3UseSsl = false
      let snapS3MaxObjects = '20'

      let snapIsDatabaseQuery = false
      let snapDbSqlQuery = 'SELECT id, event_time, severity, message FROM security_events'
      let snapDbMaxRows = '100'
      let snapDbCkMode = 'NONE'
      let snapDbCkCol = ''
      let snapDbCkOrd = ''
      let snapDbQueryTimeout = '30'

      if (streamSourceType === 'S3_OBJECT_POLLING') {
        const sc = src as Record<string, unknown>
        snapIsS3ObjectPolling = true
        snapS3EndpointUrl = String(sc.endpoint_url ?? '').trim()
        snapS3Bucket = String(sc.bucket ?? '').trim()
        snapS3Prefix = String(sc.prefix ?? '').trim()
        snapS3Region = String(sc.region ?? 'us-east-1').trim() || 'us-east-1'
        snapS3AccessKey = String(sc.access_key ?? '').trim()
        snapS3SecretKey = String(sc.secret_key ?? '').trim()
        snapS3PathStyle = sc.path_style_access !== false
        snapS3UseSsl = sc.use_ssl === true
        const mo = (found.config_json as Record<string, unknown> | undefined)?.max_objects_per_run
        snapS3MaxObjects =
          typeof mo === 'number' && mo > 0 ? String(mo) : typeof mo === 'string' && mo ? mo : '20'
        setS3EndpointUrl(snapS3EndpointUrl)
        setS3Bucket(snapS3Bucket)
        setS3Prefix(snapS3Prefix)
        setS3Region(snapS3Region)
        setS3AccessKey(snapS3AccessKey)
        setS3SecretKey(snapS3SecretKey)
        setS3PathStyle(snapS3PathStyle)
        setS3UseSsl(snapS3UseSsl)
        setS3MaxObjects(snapS3MaxObjects)
      } else {
        setS3EndpointUrl('')
        setS3Bucket('')
        setS3Prefix('')
        setS3Region('us-east-1')
        setS3AccessKey('')
        setS3SecretKey('')
        setS3PathStyle(true)
        setS3UseSsl(false)
        setS3MaxObjects('20')
      }

      if (streamSourceType === 'DATABASE_QUERY') {
        const cj = (found.config_json ?? {}) as Record<string, unknown>
        snapIsDatabaseQuery = true
        snapDbSqlQuery = typeof cj.query === 'string' && cj.query.trim() ? cj.query : 'SELECT 1'
        const mr = cj.max_rows_per_run
        snapDbMaxRows =
          typeof mr === 'number' && mr > 0 ? String(mr) : typeof mr === 'string' && mr ? mr : '100'
        snapDbCkMode = typeof cj.checkpoint_mode === 'string' ? cj.checkpoint_mode : 'NONE'
        snapDbCkCol = typeof cj.checkpoint_column === 'string' ? cj.checkpoint_column : ''
        snapDbCkOrd = typeof cj.checkpoint_order_column === 'string' ? cj.checkpoint_order_column : ''
        const qt = cj.query_timeout_seconds
        snapDbQueryTimeout =
          typeof qt === 'number' && qt > 0 ? String(qt) : typeof qt === 'string' && qt ? qt : '30'
        setDbSqlQuery(snapDbSqlQuery)
        setDbMaxRows(snapDbMaxRows)
        setDbCkMode(snapDbCkMode)
        setDbCkCol(snapDbCkCol)
        setDbCkOrd(snapDbCkOrd)
        setDbQueryTimeout(snapDbQueryTimeout)
      } else {
        setDbSqlQuery('SELECT id, event_time, severity, message FROM security_events')
        setDbMaxRows('100')
        setDbCkMode('NONE')
        setDbCkCol('')
        setDbCkOrd('')
        setDbQueryTimeout('30')
      }

      if (streamSourceType === 'REMOTE_FILE_POLLING') {
        const cj = (found.config_json ?? {}) as Record<string, unknown>
        setRfRemoteDirectory(typeof cj.remote_directory === 'string' ? cj.remote_directory : '')
        setRfFilePattern(typeof cj.file_pattern === 'string' ? cj.file_pattern : '*')
        setRfRecursive(cj.recursive === true)
        setRfParserType(typeof cj.parser_type === 'string' ? String(cj.parser_type).toUpperCase() : 'NDJSON')
        const mf = cj.max_files_per_run
        setRfMaxFiles(typeof mf === 'number' && mf > 0 ? String(mf) : typeof mf === 'string' && mf ? mf : '10')
        const mm = cj.max_file_size_mb
        setRfMaxMb(typeof mm === 'number' && mm > 0 ? String(mm) : typeof mm === 'string' && mm ? mm : '5')
        setRfEncoding(typeof cj.encoding === 'string' ? cj.encoding : 'utf-8')
        setRfCsvDelimiter(typeof cj.csv_delimiter === 'string' ? cj.csv_delimiter : ',')
        setRfLineField(typeof cj.line_event_field === 'string' ? cj.line_event_field : 'line')
        setRfIncludeMeta(cj.include_file_metadata === true)
      } else {
        setRfRemoteDirectory('')
        setRfFilePattern('*')
        setRfRecursive(false)
        setRfParserType('NDJSON')
        setRfMaxFiles('10')
        setRfMaxMb('5')
        setRfEncoding('utf-8')
        setRfCsvDelimiter(',')
        setRfLineField('line')
        setRfIncludeMeta(false)
      }
      const form = applyStreamReadToForm(found, mappingBase)
      setMappingEventArrayPath(mapping?.mapping?.event_array_path?.trim() ?? '')
      setMappingEventRootPath(mapping?.mapping?.event_root_path?.trim() ?? '')
      setStreamName(form.streamName)
      setDescription(form.description)
      setHttpMethod(form.httpMethod)
      setBaseUrl(form.baseUrl)
      setEndpointPath(form.endpointPath)
      setPollingInterval(form.pollingInterval)
      setTimeoutSec(form.timeoutSec)
      setInitialDelaySec(form.initialDelaySec)
      setPaginationType(form.paginationType)
      setCursorParam(form.cursorParam)
      setPageSize(form.pageSize)
      setRequestBodyText(form.requestBodyText)
      setMaxPages(form.maxPages)
      setRateLimitPerMinute(form.rateLimitPerMinute)
      setRateLimitBurst(form.rateLimitBurst)
      setSchemaRootPath(form.schemaRootPath)
      setCheckpointMode(form.checkpointMode)
      setCheckpointCursorPath(form.checkpointCursorPath)
      setCheckpointSecondaryPath(form.checkpointSecondaryPath)
      setSelectedTags(form.selectedTags)
      setConnectorId(form.connectorId)
      if (form.connectorId != null) {
        const conn = await fetchConnectorById(form.connectorId)
        if (!cancelled) setConnectorDisplayName(conn?.name?.trim() ? conn.name.trim() : null)
        if (!cancelled && conn) {
          const st = String(conn.source_type ?? '').toUpperCase()
          setConnectorRemoteProtocol(st === 'REMOTE_FILE_POLLING' ? String(conn.remote_file_protocol ?? '').trim() || null : null)
          setConnectorDbType(st === 'DATABASE_QUERY' ? String(conn.db_type ?? '').trim() || null : null)
        }
      } else {
        setConnectorDisplayName(null)
        setConnectorRemoteProtocol(null)
        setConnectorDbType(null)
      }
      setLiveSampleJson(null)
      setLiveSampleMeta(null)
      setApiTestError(null)

      if (found.status) setRuntimeStatus(mapBackendStreamStatus(found.status))
      setApiStreamStatus(found.status ?? null)

      const routes = await fetchRoutesList()
      if (backendStreamId != null && routes) {
        setStreamRouteCount(routes.filter((r) => r.stream_id === backendStreamId).length)
      } else {
        setStreamRouteCount(0)
      }

      const snap = JSON.stringify({
        httpMethod: form.httpMethod,
        baseUrl: form.baseUrl,
        endpointPath: form.endpointPath,
        pollingInterval: form.pollingInterval,
        timeoutSec: form.timeoutSec,
        initialDelaySec: form.initialDelaySec,
        paginationType: form.paginationType,
        cursorParam: form.cursorParam,
        pageSize: form.pageSize,
        requestBodyText: form.requestBodyText,
        maxPages: form.maxPages,
        rateLimitPerMinute: form.rateLimitPerMinute,
        rateLimitBurst: form.rateLimitBurst,
        schemaRootPath: form.schemaRootPath,
        checkpointMode: form.checkpointMode,
        checkpointCursorPath: form.checkpointCursorPath,
        checkpointSecondaryPath: form.checkpointSecondaryPath,
        selectedTags: form.selectedTags,
        s3EndpointUrl: snapS3EndpointUrl,
        s3Bucket: snapS3Bucket,
        s3Prefix: snapS3Prefix,
        s3Region: snapS3Region,
        s3AccessKey: snapS3AccessKey,
        s3SecretKey: snapS3SecretKey,
        s3PathStyle: snapS3PathStyle,
        s3UseSsl: snapS3UseSsl,
        s3MaxObjects: snapS3MaxObjects,
        isS3ObjectPolling: snapIsS3ObjectPolling,
        isDatabaseQuery: snapIsDatabaseQuery,
        dbSqlQuery: snapDbSqlQuery,
        dbMaxRows: snapDbMaxRows,
        dbCkMode: snapDbCkMode,
        dbCkCol: snapDbCkCol,
        dbCkOrd: snapDbCkOrd,
        dbQueryTimeout: snapDbQueryTimeout,
      })
      setBaseline({
        name: form.streamName,
        description: form.description,
        configSnapshot: snap,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [backendStreamId])

  const refreshRuntimeSnapshot = useCallback(async () => {
    if (backendStreamId == null) return false
    const [stats, health] = await Promise.all([
      fetchStreamRuntimeStats(backendStreamId, 80),
      fetchStreamRuntimeHealth(backendStreamId, 80),
    ])
    if (stats) {
      const sum = stats.summary
      const sendSuccess = Number(sum?.route_send_success ?? 0)
      const sendFailed = Number(sum?.route_send_failed ?? 0)
      const retrySuccess = Number(sum?.route_retry_success ?? 0)
      const retryFailed = Number(sum?.route_retry_failed ?? 0)
      const attempted = sendSuccess + sendFailed + retrySuccess + retryFailed
      const delivered = sendSuccess + retrySuccess
      const deliveryPct = attempted > 0 ? Math.min(100, (100 * delivered) / attempted) : 0
      setRuntimeEvents1h(Number(sum?.total_logs ?? 0))
      setRuntimeDeliveryPct(deliveryPct)
      setRuntimeStatus(mapBackendStreamStatus(stats.stream_status))
      const routes = stats.routes ?? []
      let ok = 0
      let err = 0
      const destinationIds = new Set<number>()
      let lastSuccessAt: string | null = null
      let lastErrorAt: string | null = null
      for (const r of routes) {
        destinationIds.add(r.destination_id)
        const failed = Number(r.counts?.route_send_failed ?? 0) + Number(r.counts?.route_retry_failed ?? 0)
        const okish = Number(r.counts?.route_send_success ?? 0) + Number(r.counts?.route_retry_success ?? 0)
        if (failed === 0 && okish > 0) ok += 1
        else if (failed > 0) err += 1
        if (r.last_success_at && (lastSuccessAt == null || r.last_success_at > lastSuccessAt)) lastSuccessAt = r.last_success_at
        if (r.last_failure_at && (lastErrorAt == null || r.last_failure_at > lastErrorAt)) lastErrorAt = r.last_failure_at
      }
      setRuntimeRoutesTotal(routes.length)
      setRuntimeRoutesOk(ok)
      setRuntimeRoutesErr(err)
      setRuntimeDestinationsTotal(destinationIds.size)
      setRuntimeLastSuccessAt(lastSuccessAt)
      setRuntimeLastErrorAt(lastErrorAt)
      setRuntimeLastErrorMessage(lastErrorAt ? 'Latest route failure observed in runtime window' : null)
    }
    if (health?.summary) {
      const h = health.summary
      const total = Number(h.total_routes ?? 0)
      if (total > 0) setRuntimeRoutesTotal(total)
      setRuntimeRoutesOk(Number(h.healthy_routes ?? 0))
      setRuntimeRoutesErr(Number(h.unhealthy_routes ?? 0))
      if (health.stream_status) setRuntimeStatus(mapBackendStreamStatus(health.stream_status))
      if (runtimeDestinationsTotal === 0 && health.routes?.length) {
        const destinationIds = new Set<number>()
        for (const route of health.routes) destinationIds.add(route.destination_id)
        setRuntimeDestinationsTotal(destinationIds.size)
      }
      if (health.routes?.length) {
        let latestFailureAt: string | null = null
        let latestFailureMessage: string | null = null
        for (const route of health.routes) {
          if (route.last_failure_at && (latestFailureAt == null || route.last_failure_at > latestFailureAt)) {
            latestFailureAt = route.last_failure_at
            latestFailureMessage = route.last_error_message ?? route.last_error_code ?? 'Route delivery failed'
          }
        }
        if (latestFailureAt) {
          setRuntimeLastErrorAt(latestFailureAt)
          setRuntimeLastErrorMessage(latestFailureMessage)
        }
      }
    }
    return stats != null || health != null
  }, [backendStreamId, runtimeDestinationsTotal])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (cancelled) return
      await refreshRuntimeSnapshot()
    })()
    return () => {
      cancelled = true
    }
  }, [refreshRuntimeSnapshot])

  const runStreamControl = useCallback(
    async (action: 'start' | 'stop') => {
      if (backendStreamId == null || controlBusy || runOnceBusy) return
      setControlBusy(true)
      setControlMessage(null)
      const res = action === 'start' ? await startRuntimeStream(backendStreamId) : await stopRuntimeStream(backendStreamId)
      if (res) {
        setControlMessage(res.message)
        await refreshRuntimeSnapshot()
        const st = await fetchStreamById(backendStreamId)
        if (st) setApiStreamStatus(st.status ?? null)
        window.dispatchEvent(new CustomEvent('gdc-runtime-control-updated', { detail: { streamId: backendStreamId, action } }))
      } else {
        setControlMessage('Runtime API unavailable · control action not applied.')
      }
      setControlBusy(false)
    },
    [backendStreamId, controlBusy, runOnceBusy, refreshRuntimeSnapshot],
  )

  const executeRunOnce = useCallback(async () => {
    if (backendStreamId == null || runOnceBusy || controlBusy) return
    setRunOnceBusy(true)
    setRunOnceNotice(null)
    setControlMessage(null)
    try {
      const r = await runStreamOnce(backendStreamId)
      setRunOnceNotice({ variant: 'success', lines: formatRunOnceSummaryLines(r) })
      await refreshRuntimeSnapshot()
      window.dispatchEvent(new CustomEvent('gdc-runtime-run-once', { detail: { streamId: backendStreamId, response: r } }))
    } catch (e) {
      setRunOnceNotice({
        variant: 'error',
        lines: formatRunOnceErrorLines(e, {
          compareTestOutbound: lastTestOutbound
            ? {
                method: lastTestOutbound.method,
                url: lastTestOutbound.url,
                query_params: lastTestOutbound.query_params as Record<string, unknown>,
                json_body_masked: lastTestOutbound.json_body_masked,
                timeout_seconds: lastTestOutbound.timeout_seconds,
              }
            : null,
        }),
      })
    } finally {
      setRunOnceBusy(false)
    }
  }, [backendStreamId, runOnceBusy, controlBusy, refreshRuntimeSnapshot, lastTestOutbound])

  const runConnectionTest = useCallback(async () => {
    if (apiTestBusy) return
    setRemoteFileProbe(null)
    if (isS3ObjectPolling) {
      if (connectorId == null) {
        setApiTestError('A saved connector is required for the S3 connectivity test.')
        return
      }
      setApiTestBusy(true)
      setApiTestError(null)
      try {
        const res = await runConnectorAuthTest({
          connector_id: connectorId,
          method: 'GET',
          test_path: '/',
        })
        const summary = {
          ok: res.ok,
          s3_endpoint_reachable: res.s3_endpoint_reachable,
          s3_bucket_exists: res.s3_bucket_exists,
          s3_auth_ok: res.s3_auth_ok,
          s3_object_count_preview: res.s3_object_count_preview,
          s3_sample_keys: res.s3_sample_keys ?? [],
          message: res.message,
        }
        setLiveSampleJson(JSON.stringify(summary, null, 2))
        setLiveSampleMeta({ status: res.ok ? 200 : 422, latencyMs: 0 })
        setLastTestOutbound(null)
        if (!res.ok) {
          setApiTestError(res.message ?? res.error_type ?? 'S3 connectivity test failed')
        }
      } catch (e) {
        setLiveSampleJson(null)
        setLiveSampleMeta(null)
        setApiTestError(e instanceof Error ? e.message : 'S3 test failed')
      } finally {
        setApiTestBusy(false)
      }
      return
    }
    if (isDatabaseQuery) {
      if (connectorId == null) {
        setApiTestError('A saved connector is required for the database sample fetch.')
        return
      }
      if (!dbSqlQuery.trim()) {
        setApiTestError('SQL query is required.')
        return
      }
      setApiTestBusy(true)
      setApiTestError(null)
      try {
        const streamCfg: Record<string, unknown> = {
          query: dbSqlQuery.trim(),
          max_rows_per_run: Number.parseInt(dbMaxRows, 10) || 50,
          checkpoint_mode: dbCkMode,
          checkpoint_column: dbCkCol.trim() || undefined,
          checkpoint_order_column: dbCkOrd.trim() || undefined,
          query_timeout_seconds: Number.parseInt(dbQueryTimeout, 10) || 30,
        }
        const res = await runHttpApiTest({
          connector_id: connectorId,
          source_config: {},
          stream_config: streamCfg,
          checkpoint: null,
          fetch_sample: true,
        })
        if (!res.ok) {
          setLiveSampleJson(null)
          setLiveSampleMeta(null)
          setLastTestOutbound(res.actual_request_sent ?? null)
          setApiTestError(res.message ?? res.error_type ?? res.hint ?? 'Database sample fetch failed')
          return
        }
        setLastTestOutbound(res.actual_request_sent ?? null)
        const body = res.response?.parsed_json
        const text =
          body !== undefined && body !== null
            ? truncateSampleJson(JSON.stringify(body, null, 2), 8000)
            : res.response?.raw_body
              ? truncateSampleJson(res.response.raw_body, 8000)
              : 'Empty body'
        setLiveSampleJson(text)
        if (res.response) {
          setLiveSampleMeta({ status: res.response.status_code, latencyMs: res.response.latency_ms })
        } else {
          setLiveSampleMeta(null)
        }
      } catch (e) {
        setLiveSampleJson(null)
        setLiveSampleMeta(null)
        setApiTestError(e instanceof Error ? e.message : 'Database sample fetch failed')
      } finally {
        setApiTestBusy(false)
      }
      return
    }
    if (isRemoteFilePolling) {
      if (connectorId == null) {
        setApiTestError('A saved connector is required for the remote file sample fetch.')
        return
      }
      if (!rfRemoteDirectory.trim()) {
        setApiTestError('Remote directory is required.')
        return
      }
      setApiTestBusy(true)
      setApiTestError(null)
      try {
        const probe = await runConnectorAuthTest({
          connector_id: connectorId,
          method: 'GET',
          test_path: '/',
          remote_file_stream_config: {
            remote_directory: rfRemoteDirectory.trim(),
            file_pattern: (rfFilePattern.trim() || '*') as string,
            recursive: rfRecursive,
          },
        })
        setRemoteFileProbe(probe)
        if (!probe.ok) {
          setLiveSampleJson(null)
          setLiveSampleMeta(null)
          setLastTestOutbound(null)
          setApiTestError(probe.message ?? probe.error_type ?? 'Remote file connectivity test failed')
          return
        }
        const streamCfg: Record<string, unknown> = {
          remote_directory: rfRemoteDirectory.trim(),
          file_pattern: (rfFilePattern.trim() || '*') as string,
          recursive: rfRecursive,
          parser_type: rfParserType,
          max_files_per_run: Math.max(1, Number.parseInt(rfMaxFiles, 10) || 5),
          max_file_size_mb: Math.max(1, Number.parseInt(rfMaxMb, 10) || 5),
          encoding: rfEncoding.trim() || 'utf-8',
          csv_delimiter: rfCsvDelimiter || ',',
          line_event_field: rfLineField.trim() || 'line',
          include_file_metadata: rfIncludeMeta,
        }
        const res = await runHttpApiTest({
          connector_id: connectorId,
          source_config: {},
          stream_config: streamCfg,
          checkpoint: null,
          fetch_sample: true,
        })
        if (!res.ok) {
          setLiveSampleJson(null)
          setLiveSampleMeta(null)
          setLastTestOutbound(res.actual_request_sent ?? null)
          setApiTestError(res.message ?? res.error_type ?? res.hint ?? 'Remote file sample fetch failed')
          return
        }
        setLastTestOutbound(res.actual_request_sent ?? null)
        const body = res.response?.parsed_json
        const text =
          body !== undefined && body !== null
            ? truncateSampleJson(JSON.stringify(body, null, 2), 8000)
            : res.response?.raw_body
              ? truncateSampleJson(res.response.raw_body, 8000)
              : 'Empty body'
        setLiveSampleJson(text)
        if (res.response) {
          setLiveSampleMeta({ status: res.response.status_code, latencyMs: res.response.latency_ms })
        } else {
          setLiveSampleMeta(null)
        }
      } catch (e) {
        setLiveSampleJson(null)
        setLiveSampleMeta(null)
        setApiTestError(e instanceof Error ? e.message : 'Remote file sample fetch failed')
      } finally {
        setApiTestBusy(false)
      }
      return
    }
    const ep = endpointPath.trim()
    if (!ep) {
      setApiTestError('Endpoint path is required.')
      return
    }
    if (connectorId == null && !baseUrl.trim()) {
      setApiTestError('Base URL is required when the stream has no connector_id (or run tests after assigning a connector).')
      return
    }
    setApiTestBusy(true)
    setApiTestError(null)
    try {
      let parsedTestBody: unknown | undefined
      const rb = requestBodyText.trim()
      if (rb) {
        try {
          parsedTestBody = JSON.parse(rb) as unknown
        } catch {
          setApiTestError('Request body must be valid JSON.')
          setApiTestBusy(false)
          return
        }
      }
      const streamCfg: Record<string, unknown> = {
        method: httpMethod,
        endpoint: ep,
        timeout_seconds: Number.parseInt(timeoutSec, 10) || 30,
        params: buildApiTestParams({ paginationType, cursorParam }),
        pagination: { type: paginationType },
      }
      if (parsedTestBody !== undefined) streamCfg.body = parsedTestBody
      const res = await runHttpApiTest({
        connector_id: connectorId ?? undefined,
        source_config: connectorId != null ? {} : { base_url: baseUrl.trim() },
        stream_config: streamCfg,
        checkpoint: null,
        fetch_sample: true,
      })
      if (!res.ok) {
        setLiveSampleJson(null)
        setLiveSampleMeta(null)
        setLastTestOutbound(null)
        setApiTestError(res.message ?? res.error_type ?? res.hint ?? 'API test failed')
        return
      }
      setLastTestOutbound(res.actual_request_sent ?? null)
      const body = res.response?.parsed_json
      const text =
        body !== undefined && body !== null
          ? truncateSampleJson(JSON.stringify(body, null, 2), 8000)
          : res.response?.raw_body
            ? truncateSampleJson(res.response.raw_body, 8000)
            : 'Empty body'
      setLiveSampleJson(text)
      if (res.response) {
        setLiveSampleMeta({ status: res.response.status_code, latencyMs: res.response.latency_ms })
      } else {
        setLiveSampleMeta(null)
      }
    } catch (e) {
      setLiveSampleJson(null)
      setLiveSampleMeta(null)
      setApiTestError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setApiTestBusy(false)
    }
  }, [
    apiTestBusy,
    baseUrl,
    connectorId,
    cursorParam,
    dbCkCol,
    dbCkMode,
    dbCkOrd,
    dbMaxRows,
    dbQueryTimeout,
    dbSqlQuery,
    endpointPath,
    httpMethod,
    isDatabaseQuery,
    isRemoteFilePolling,
    isS3ObjectPolling,
    paginationType,
    requestBodyText,
    rfCsvDelimiter,
    rfEncoding,
    rfFilePattern,
    rfIncludeMeta,
    rfLineField,
    rfMaxFiles,
    rfMaxMb,
    rfParserType,
    rfRecursive,
    rfRemoteDirectory,
    timeoutSec,
  ])

  const fullUrlPreview = `${baseUrl}${endpointPath}`
  const requestPreview = useMemo(() => {
    const qp = buildApiTestParams({ paginationType, cursorParam })
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(qp)) {
      qs.append(k, v)
    }
    const q = qs.toString()
    const path = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`
    return `${httpMethod} ${path}${q ? `?${q}` : ''} HTTP/1.1`
  }, [httpMethod, endpointPath, paginationType, cursorParam])

  const samplePanelText = liveSampleJson ?? SAMPLE_PLACEHOLDER

  function toggleTag(tag: string) {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))
  }

  function applyRequestPreset(preset: string) {
    if (preset === 'Empty Query') {
      setRequestBodyText(JSON.stringify({ query: { bool: { filter: [] } } }, null, 2))
      return
    }
    if (preset === 'Sort by Timestamp') {
      setRequestBodyText(JSON.stringify({ sort: [{ timestamp: 'asc' }], query: { bool: { filter: [] } } }, null, 2))
      return
    }
    if (preset === 'Last 10') {
      setRequestBodyText(JSON.stringify({ size: 10, query: { bool: { filter: [] } } }, null, 2))
      return
    }
    setRequestBodyText(JSON.stringify({ query: { bool: { filter: [{ term: { status: 'active' } }] } } }, null, 2))
  }

  async function handleSave() {
    if (isSaving) return
    setIsSaving(true)
    setSaveError(null)
    setSaveSuccess(null)
    if (backendStreamId == null) {
      setSaveSuccess('API unavailable for this draft id. Changes saved locally (preview only).')
      setBaseline((prev) => ({ name: streamName, description, configSnapshot: prev.configSnapshot }))
      setIsSaving(false)
      return
    }
    const pollingNum = Number.parseInt(pollingInterval, 10)
    const timeoutNum = Number.parseInt(timeoutSec, 10)
    const pageSizeNum = Number.parseInt(pageSize, 10)
    const maxPagesNum = Number.parseInt(maxPages, 10)
    const initialDelayNum = Number.parseInt(initialDelaySec, 10)
    const ratePerMinNum = Number.parseInt(rateLimitPerMinute, 10)
    const rateBurstNum = Number.parseInt(rateLimitBurst, 10)
    const timeoutResolved = Number.isFinite(timeoutNum) ? timeoutNum : 30
    const persistParams = buildPersistParams({ paginationType, cursorParam })
    const rbSave = requestBodyText.trim()
    let parsedSaveBody: unknown | undefined
    if (rbSave && !isDatabaseQuery && !isRemoteFilePolling) {
      try {
        parsedSaveBody = JSON.parse(rbSave) as unknown
      } catch {
        setSaveError('Request body must be valid JSON.')
        setIsSaving(false)
        return
      }
    }
    if (isRemoteFilePolling) {
      if (!rfRemoteDirectory.trim()) {
        setSaveError('Remote directory is required.')
        setIsSaving(false)
        return
      }
      const mf = Number.parseInt(rfMaxFiles, 10)
      if (!Number.isFinite(mf) || mf < 1) {
        setSaveError('Max files per run must be a positive integer.')
        setIsSaving(false)
        return
      }
      const mmb = Number.parseInt(rfMaxMb, 10)
      if (!Number.isFinite(mmb) || mmb < 1) {
        setSaveError('Max file size MB must be a positive integer.')
        setIsSaving(false)
        return
      }
    }
    if (isDatabaseQuery) {
      if (!dbSqlQuery.trim()) {
        setSaveError('SQL query is required.')
        setIsSaving(false)
        return
      }
      const mr = Number.parseInt(dbMaxRows, 10)
      if (!Number.isFinite(mr) || mr < 1) {
        setSaveError('Max rows per run must be a positive integer.')
        setIsSaving(false)
        return
      }
    }
    if (isS3ObjectPolling) {
      if (!s3EndpointUrl.trim()) {
        setSaveError('Endpoint URL is required.')
        setIsSaving(false)
        return
      }
      if (!s3Bucket.trim()) {
        setSaveError('Bucket is required.')
        setIsSaving(false)
        return
      }
      if (!s3AccessKey.trim()) {
        setSaveError('Access key is required.')
        setIsSaving(false)
        return
      }
      if (!s3SecretKey.trim()) {
        setSaveError('Secret key is required (leave the saved mask unchanged to keep the current secret).')
        setIsSaving(false)
        return
      }
      const maxObNum = Number.parseInt(s3MaxObjects, 10)
      if (!Number.isFinite(maxObNum) || maxObNum < 1) {
        setSaveError('Max objects per run must be a positive integer.')
        setIsSaving(false)
        return
      }
    }
    try {
      const maxOb = Math.max(1, Number.parseInt(s3MaxObjects, 10) || 20)
      const mrDb = Math.max(1, Number.parseInt(dbMaxRows, 10) || 100)
      const qto = Math.max(1, Number.parseInt(dbQueryTimeout, 10) || 30)
      const rfMf = Math.max(1, Number.parseInt(rfMaxFiles, 10) || 10)
      const rfMm = Math.max(1, Number.parseInt(rfMaxMb, 10) || 5)
      const saved = await updateStream(backendStreamId, {
        name: streamName,
        polling_interval: Number.isFinite(pollingNum) && pollingNum > 0 ? pollingNum : undefined,
        stream_type: isS3ObjectPolling
          ? 'S3_OBJECT_POLLING'
          : isDatabaseQuery
            ? 'DATABASE_QUERY'
            : isRemoteFilePolling
              ? 'REMOTE_FILE_POLLING'
              : undefined,
        config_json: isS3ObjectPolling
          ? {
              ...streamSnapshotCfg,
              max_objects_per_run: maxOb,
            }
          : isDatabaseQuery
            ? {
                ...streamSnapshotCfg,
                query: dbSqlQuery.trim(),
                max_rows_per_run: mrDb,
                checkpoint_mode: dbCkMode,
                checkpoint_column: dbCkCol.trim() || undefined,
                checkpoint_order_column: dbCkOrd.trim() || undefined,
                query_timeout_seconds: qto,
              }
            : isRemoteFilePolling
              ? {
                  ...streamSnapshotCfg,
                  remote_directory: rfRemoteDirectory.trim(),
                  file_pattern: (rfFilePattern.trim() || '*') as string,
                  recursive: rfRecursive,
                  parser_type: rfParserType,
                  max_files_per_run: rfMf,
                  max_file_size_mb: rfMm,
                  encoding: rfEncoding.trim() || 'utf-8',
                  csv_delimiter: rfCsvDelimiter || ',',
                  line_event_field: rfLineField.trim() || 'line',
                  include_file_metadata: rfIncludeMeta,
                }
              : {
              method: httpMethod,
              endpoint: endpointPath.trim(),
              timeout_seconds: timeoutResolved,
              params: persistParams,
              http_method: httpMethod,
              base_url: baseUrl,
              endpoint_path: endpointPath.trim(),
              timeout_sec: timeoutResolved,
              initial_delay_sec: Number.isFinite(initialDelayNum) ? initialDelayNum : 0,
              ...(parsedSaveBody !== undefined ? { body: parsedSaveBody } : {}),
              pagination: {
                type: paginationType === 'None' ? 'none' : paginationType,
                cursor_param: paginationType === 'None' ? '' : cursorParam,
                page_size: Number.isFinite(pageSizeNum) ? pageSizeNum : undefined,
                max_pages: Number.isFinite(maxPagesNum) ? maxPagesNum : undefined,
              },
              schema: {
                root_path: schemaRootPath,
              },
              checkpoint: {
                mode: checkpointMode,
                cursor_path: checkpointCursorPath,
                secondary_cursor_path: checkpointSecondaryPath.trim() || undefined,
                cursor_paths: [checkpointCursorPath, checkpointSecondaryPath].map((v) => v.trim()).filter(Boolean),
                comparator: checkpointSecondaryPath.trim() ? 'lexicographical' : 'single_field',
              },
              tags: selectedTags,
              description,
            },
        rate_limit_json: {
          per_minute: Number.isFinite(ratePerMinNum) ? ratePerMinNum : undefined,
          burst: Number.isFinite(rateBurstNum) ? rateBurstNum : undefined,
        },
      })
      if (isS3ObjectPolling && mappingUiWorkflowCfg?.source_id != null) {
        await saveSourceUiConfig(mappingUiWorkflowCfg.source_id, {
          enabled: true,
          auth_json: { auth_type: 'no_auth' },
          source_type: 'S3_OBJECT_POLLING',
          config_json: {
            endpoint_url: s3EndpointUrl.trim(),
            bucket: s3Bucket.trim(),
            prefix: s3Prefix.trim(),
            region: s3Region.trim() || 'us-east-1',
            access_key: s3AccessKey.trim(),
            secret_key: s3SecretKey.trim(),
            path_style_access: s3PathStyle,
            use_ssl: s3UseSsl,
          },
        })
      }
      setSaveSuccess(`Stream #${saved.id} saved · API-backed.`)
      setApiStreamStatus(saved.status ?? null)
      setBaseline({ name: streamName, description, configSnapshot: currentConfigSnapshot })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Stream save failed.'
      setSaveError(message)
    } finally {
      setIsSaving(false)
    }
  }

  const currentConfigSnapshot = JSON.stringify({
    httpMethod,
    baseUrl,
    endpointPath,
    pollingInterval,
    timeoutSec,
    initialDelaySec,
    paginationType,
    cursorParam,
    pageSize,
    maxPages,
    rateLimitPerMinute,
    rateLimitBurst,
    schemaRootPath,
    checkpointMode,
    checkpointCursorPath,
    checkpointSecondaryPath,
    selectedTags,
    requestBodyText,
    s3EndpointUrl,
    s3Bucket,
    s3Prefix,
    s3Region,
    s3AccessKey,
    s3SecretKey,
    s3PathStyle,
    s3UseSsl,
    s3MaxObjects,
    isS3ObjectPolling,
    isDatabaseQuery,
    dbSqlQuery,
    dbMaxRows,
    dbCkMode,
    dbCkCol,
    dbCkOrd,
    dbQueryTimeout,
  })

  const hasUnsavedChanges =
    streamName !== baseline.name ||
    description !== baseline.description ||
    currentConfigSnapshot !== baseline.configSnapshot

  const headerStatus: StreamRuntimeStatus = runtimeStatus === 'UNKNOWN' ? 'RUNNING' : runtimeStatus
  const headerStatusTone =
    headerStatus === 'RUNNING'
      ? 'success'
      : headerStatus === 'DEGRADED'
        ? 'warning'
        : headerStatus === 'ERROR'
          ? 'error'
          : 'neutral'

  const workflow = useMemo(
    () =>
      computeStreamWorkflow({
        streamId,
        status: headerStatus,
        events1h: runtimeEvents1h,
        deliveryPct: runtimeDeliveryPct,
        routesTotal: runtimeRoutesTotal,
        routesOk: runtimeRoutesOk,
        routesError: runtimeRoutesErr,
        hasConnector: true,
        ...workflowOverridesFromMappingUi(mappingUiWorkflowCfg),
        hasSaved: !hasUnsavedChanges && saveError == null,
      }),
    [
      streamId,
      headerStatus,
      runtimeEvents1h,
      runtimeDeliveryPct,
      runtimeRoutesTotal,
      runtimeRoutesOk,
      runtimeRoutesErr,
      hasUnsavedChanges,
      saveError,
      mappingUiWorkflowCfg,
    ],
  )

  const operationalBadges = useMemo(
    () => buildOperationalStreamBadges(streamName, mappingUiWorkflowCfg?.source_type),
    [streamName, mappingUiWorkflowCfg?.source_type],
  )
  const runControlTooltipExtra = operationalRunControlTooltipSupplement(streamName)

  const saveStateLabel = isSaving
    ? 'Auto-saving…'
    : saveError
      ? 'Auto-save failed'
      : saveSuccess
        ? 'Changes are auto-saved'
        : hasUnsavedChanges
          ? 'Auto-save pending'
          : 'Changes are auto-saved'

  useEffect(() => {
    if (!hasUnsavedChanges || isSaving || backendStreamId == null) return
    const timer = window.setTimeout(() => {
      void handleSave()
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [
    backendStreamId,
    currentConfigSnapshot,
    description,
    hasUnsavedChanges,
    isSaving,
    streamName,
  ])

  const persistenceMode = backendStreamId == null ? 'Local preview' : 'API-backed'
  const runtimeHealthState =
    runtimeStatus === 'ERROR'
      ? 'Unhealthy'
      : runtimeStatus === 'DEGRADED'
        ? 'Degraded'
        : runtimeStatus === 'RUNNING'
          ? 'Healthy'
          : runtimeStatus === 'STOPPED'
            ? 'Paused/Stopped'
            : 'Unknown'
  const deliveryFailurePolicySummary = runtimeRoutesErr > 0 ? 'Some routes failing; check delivery policy' : 'No active route failure'

  const streamIsRunning = (apiStreamStatus ?? '').toUpperCase() === 'RUNNING'

  const testConnectionDisabled = useMemo(() => {
    if (apiTestBusy) return true
    if ((isS3ObjectPolling || isDatabaseQuery || isRemoteFilePolling) && connectorId == null) return true
    if (isRemoteFilePolling && !rfRemoteDirectory.trim()) return true
    if (isDatabaseQuery && !dbSqlQuery.trim()) return true
    if (!isS3ObjectPolling && !isDatabaseQuery && !isRemoteFilePolling) {
      if (!endpointPath.trim()) return true
      if (connectorId == null && !baseUrl.trim()) return true
    }
    return false
  }, [
    apiTestBusy,
    baseUrl,
    connectorId,
    dbSqlQuery,
    endpointPath,
    isDatabaseQuery,
    isRemoteFilePolling,
    isS3ObjectPolling,
    rfRemoteDirectory,
  ])

  async function executeStreamDelete() {
    if (backendStreamId == null) return
    if (streamDeleteConfirm.trim() !== streamName.trim()) return
    setStreamDeleteBusy(true)
    setStreamDeleteError(null)
    try {
      await deleteStream(backendStreamId)
      navigate(NAV_PATH.streams)
    } catch (e) {
      setStreamDeleteError(e instanceof Error ? e.message : 'Delete failed.')
    } finally {
      setStreamDeleteBusy(false)
    }
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">Edit Stream</h2>
            <StatusBadge tone={headerStatusTone} className="font-bold uppercase tracking-wide">
              {headerStatus}
            </StatusBadge>
            <StreamOperationalBadges badges={operationalBadges} />
          </div>
          <p className="text-[13px] text-slate-600 dark:text-gdc-muted">
            Configure source collection, checkpointing, and delivery in one workflow.
          </p>
          <p className="text-[11px] text-slate-500 dark:text-gdc-muted">
            {persistenceMode} · delivery and checkpoint changes preserve existing platform data
          </p>
        </div>
        <div
          className="inline-flex h-7 items-center rounded-full border border-slate-200/90 bg-slate-50 px-2.5 text-[11px] font-semibold text-slate-700 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200"
          aria-live="polite"
        >
          {saveStateLabel}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={testConnectionDisabled}
            onClick={() => void runConnectionTest()}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-200 dark:hover:bg-gdc-rowHover"
          >
            {apiTestBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
            {apiTestBusy ? 'Testing…' : 'Test Connection'}
          </button>
          <button
            type="button"
            title={sourceUi.streamEdit.primaryNavTestTitle}
            disabled={!/^\d+$/.test(streamId)}
            onClick={() => navigate(streamApiTestPath(streamId))}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-200 dark:hover:bg-gdc-rowHover"
          >
            {sourceUi.streamEdit.primaryNavTestButton}
          </button>
          {backendStreamId != null ? (
            <>
              <button
                type="button"
                disabled={controlBusy || runOnceBusy}
                title={runControlTooltipExtra ? `Start Stream — ${runControlTooltipExtra}` : 'Start the scheduler worker for this stream.'}
                onClick={() => void runStreamControl('start')}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-emerald-200/90 bg-emerald-500/[0.08] px-3 text-[12px] font-semibold text-emerald-800 hover:bg-emerald-500/[0.14] disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200 dark:hover:bg-emerald-500/20"
              >
                <Play className="h-3.5 w-3.5" aria-hidden />
                Start Stream
              </button>
              <button
                type="button"
                disabled={controlBusy || runOnceBusy}
                onClick={() => void runStreamControl('stop')}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-red-200/90 bg-red-500/[0.07] px-3 text-[12px] font-semibold text-red-800 hover:bg-red-500/[0.12] disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200 dark:hover:bg-red-500/20"
              >
                <Square className="h-3.5 w-3.5" aria-hidden />
                Stop Stream
              </button>
              <button
                type="button"
                disabled={controlBusy || runOnceBusy}
                title={
                  runControlTooltipExtra
                    ? `Run the full pipeline once (saved config). ${runControlTooltipExtra}`
                    : 'Run the full extract → map → enrich → deliver pipeline once.'
                }
                onClick={() => void executeRunOnce()}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {runOnceBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
                {runOnceBusy ? 'Running…' : 'Run Now'}
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => navigate(streamRuntimePath(streamId))}
            className="inline-flex h-9 items-center rounded-md border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-200 dark:hover:bg-gdc-rowHover"
          >
            Cancel
          </button>
        </div>
      </div>
      <p className="max-w-[920px] text-[11px] leading-relaxed text-slate-500 dark:text-gdc-muted">
        {isHttpSourcePoll ? (
          <>
            <span className="font-semibold text-slate-600 dark:text-gdc-muted">{sourceUi.streamEdit.helpBoldConnection}</span> — draft
            settings only; HTTP probe via{' '}
            <code className="rounded bg-slate-100 px-1 dark:bg-gdc-elevated">/runtime/api-test/http</code>, no delivery or checkpoint
            writes.{' '}
            <span className="font-semibold text-slate-600 dark:text-gdc-muted">{sourceUi.streamEdit.helpBoldSample}</span>
            {sourceUi.streamEdit.helpSampleSuffix}{' '}
            <span className="font-semibold text-slate-600 dark:text-gdc-muted">Run Now</span> — saved stream config;{' '}
            <code className="rounded bg-slate-100 px-1 dark:bg-gdc-elevated">POST /runtime/streams/&#123;id&#125;/run-once</code> runs
            delivery + logs + checkpoint on success.
          </>
        ) : (
          <>
            <span className="font-semibold text-slate-600 dark:text-gdc-muted">{sourceUi.streamEdit.helpBoldConnection}</span> — draft
            settings only; uses the connector/source preview endpoints (no checkpoint writes on probe).{' '}
            <span className="font-semibold text-slate-600 dark:text-gdc-muted">{sourceUi.streamEdit.helpBoldSample}</span>
            {sourceUi.streamEdit.helpSampleSuffix}{' '}
            <span className="font-semibold text-slate-600 dark:text-gdc-muted">Run Now</span> — saved stream config;{' '}
            <code className="rounded bg-slate-100 px-1 dark:bg-gdc-elevated">POST /runtime/streams/&#123;id&#125;/run-once</code> runs
            delivery + logs + checkpoint on success.
          </>
        )}
      </p>
      {saveError ? <p className="text-[12px] font-medium text-red-700 dark:text-red-300">{saveError}</p> : null}
      {saveSuccess ? <p className="text-[12px] font-medium text-emerald-700 dark:text-emerald-300">{saveSuccess}</p> : null}
      {controlMessage ? <p className="text-[11px] font-medium text-slate-600 dark:text-gdc-mutedStrong">{controlMessage}</p> : null}
      {runOnceNotice ? (
        <div
          role="status"
          className={cn(
            'rounded-md border px-2 py-1.5 text-[11px]',
            runOnceNotice.variant === 'success'
              ? 'border-emerald-300/70 bg-emerald-500/[0.06] text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100'
              : 'border-red-300/70 bg-red-500/[0.06] text-red-950 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100',
          )}
        >
          <p className="font-semibold">{runOnceNotice.variant === 'success' ? 'Run once' : 'Run once failed'}</p>
          <ul className="mt-0.5 list-inside list-disc">
            {runOnceNotice.lines.map((line, i) => (
              <li key={`edit-run-${i}`}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {apiTestError ? <p className="text-[12px] font-medium text-red-700 dark:text-red-300">{apiTestError}</p> : null}

      <StreamWorkflowChecklist snapshot={workflow} showRuntimeLinks />


      <div className="grid gap-4 xl:grid-cols-[1.8fr_1fr]">
        <div className="space-y-4">
          <SectionCard title="Stream & Source">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Stream Name *">
                <input value={streamName} onChange={(e) => setStreamName(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Description">
                <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Connector">
                <div className={readonlyCls}>
                  {connectorDisplayName ??
                    (connectorId != null ? `Connector #${connectorId}` : '—')}
                </div>
              </Field>
              <Field label="Source Type">
                <div className={readonlyCls}>
                  {(mappingUiWorkflowCfg?.source_type ?? 'HTTP_API_POLLING').replace(/_/g, ' ')}
                </div>
              </Field>
              <Field label="Status">
                <label className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-slate-700 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200">
                  <input type="checkbox" defaultChecked className="accent-violet-600" />
                  Enabled
                </label>
              </Field>
              <Field label="Important Tags">
                <div className="flex flex-wrap gap-1.5">
                  {TAG_CHOICES.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className={cn(
                        'inline-flex h-7 items-center rounded-md border px-2 text-[11px] font-semibold',
                        selectedTags.includes(tag)
                          ? 'border-violet-400 bg-violet-500/[0.08] text-violet-700 dark:border-violet-500 dark:bg-violet-500/15 dark:text-violet-300'
                          : 'border-slate-200 bg-white text-slate-600 dark:border-gdc-border dark:bg-gdc-card dark:text-gdc-muted',
                      )}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          </SectionCard>

          {isS3ObjectPolling ? (
            <SectionCard title="S3 Object Polling" id="s3-object-section">
              <p className="mb-3 text-[12px] text-slate-600 dark:text-gdc-muted">
                Source type S3 Object Polling — credentials are stored on the Source. Values masked as ******** are
                unchanged when left as-is.
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="Endpoint URL *">
                  <input value={s3EndpointUrl} onChange={(e) => setS3EndpointUrl(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Bucket *">
                  <input value={s3Bucket} onChange={(e) => setS3Bucket(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Prefix">
                  <input value={s3Prefix} onChange={(e) => setS3Prefix(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Region">
                  <input value={s3Region} onChange={(e) => setS3Region(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Access key *">
                  <input value={s3AccessKey} onChange={(e) => setS3AccessKey(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Secret key *">
                  <input
                    type="password"
                    value={s3SecretKey}
                    onChange={(e) => setS3SecretKey(e.target.value)}
                    className={inputCls}
                    autoComplete="off"
                  />
                </Field>
                <Field label="Path-style addressing">
                  <label className="inline-flex items-center gap-2 text-[12px] text-slate-700 dark:text-gdc-mutedStrong">
                    <input type="checkbox" checked={s3PathStyle} onChange={(e) => setS3PathStyle(e.target.checked)} />
                    Enabled (recommended for MinIO)
                  </label>
                </Field>
                <Field label="Use SSL">
                  <label className="inline-flex items-center gap-2 text-[12px] text-slate-700 dark:text-gdc-mutedStrong">
                    <input type="checkbox" checked={s3UseSsl} onChange={(e) => setS3UseSsl(e.target.checked)} />
                    HTTPS / TLS to endpoint
                  </label>
                </Field>
                <Field label="Max objects per run">
                  <input value={s3MaxObjects} onChange={(e) => setS3MaxObjects(e.target.value)} className={inputCls} />
                </Field>
              </div>
            </SectionCard>
          ) : null}

          {isDatabaseQuery ? (
            <SectionCard title="Database query" id="database-query-section">
              <p className="mb-3 text-[12px] text-slate-600 dark:text-gdc-muted">
                Single SELECT only. Checkpoints advance only after successful destination delivery. Use parameter binding
                via JSON array or object in query_params when needed (advanced).
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="SQL query *" className="md:col-span-2">
                  <textarea
                    value={dbSqlQuery}
                    onChange={(e) => setDbSqlQuery(e.target.value)}
                    spellCheck={false}
                    rows={8}
                    className="min-h-[180px] w-full rounded-md border border-slate-200/90 bg-white px-2.5 py-2 font-mono text-[12px] text-slate-900 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400/30 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
                  />
                </Field>
                <Field label="Max rows per run *">
                  <input value={dbMaxRows} onChange={(e) => setDbMaxRows(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Query timeout (seconds)">
                  <input value={dbQueryTimeout} onChange={(e) => setDbQueryTimeout(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Checkpoint mode">
                  <Select
                    value={dbCkMode}
                    onChange={(v) => setDbCkMode(v)}
                    options={['NONE', 'SINGLE_COLUMN', 'COMPOSITE_ORDER']}
                  />
                </Field>
                <Field label="Checkpoint column">
                  <input value={dbCkCol} onChange={(e) => setDbCkCol(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Checkpoint order column (composite)">
                  <input value={dbCkOrd} onChange={(e) => setDbCkOrd(e.target.value)} className={inputCls} />
                </Field>
              </div>
            </SectionCard>
          ) : null}

          {isRemoteFilePolling ? (
            <SectionCard title="Remote file polling" id="remote-file-section">
              <p className="mb-3 text-[12px] text-slate-600 dark:text-gdc-muted">
                Polls files over SFTP or SFTP-compatible SCP mode from the connector host. Checkpoints advance only after
                successful destination delivery.
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="Remote directory *" className="md:col-span-2">
                  <input value={rfRemoteDirectory} onChange={(e) => setRfRemoteDirectory(e.target.value)} className={inputCls} />
                </Field>
                <Field label="File pattern *">
                  <input value={rfFilePattern} onChange={(e) => setRfFilePattern(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Parser type">
                  <Select
                    value={rfParserType}
                    onChange={(v) => setRfParserType(v)}
                    options={['NDJSON', 'JSON_ARRAY', 'JSON_OBJECT', 'CSV', 'LINE_DELIMITED_TEXT']}
                  />
                </Field>
                <Field label="Max files per run *">
                  <input value={rfMaxFiles} onChange={(e) => setRfMaxFiles(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Max file size (MB) *">
                  <input value={rfMaxMb} onChange={(e) => setRfMaxMb(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Encoding">
                  <input value={rfEncoding} onChange={(e) => setRfEncoding(e.target.value)} className={inputCls} />
                </Field>
                <Field label="CSV delimiter">
                  <input value={rfCsvDelimiter} onChange={(e) => setRfCsvDelimiter(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Line event field">
                  <input value={rfLineField} onChange={(e) => setRfLineField(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Recursive scan">
                  <label className="inline-flex items-center gap-2 text-[12px] text-slate-700 dark:text-gdc-mutedStrong">
                    <input type="checkbox" checked={rfRecursive} onChange={(e) => setRfRecursive(e.target.checked)} />
                    Include subdirectories
                  </label>
                </Field>
                <Field label="Include file metadata">
                  <label className="inline-flex items-center gap-2 text-[12px] text-slate-700 dark:text-gdc-mutedStrong">
                    <input type="checkbox" checked={rfIncludeMeta} onChange={(e) => setRfIncludeMeta(e.target.checked)} />
                    Attach gdc_remote_* fields (protocol/host when enabled)
                  </label>
                </Field>
              </div>
            </SectionCard>
          ) : null}

          {!isS3ObjectPolling && !isDatabaseQuery && !isRemoteFilePolling ? (
          <SectionCard title={sourceUi.wizard.streamStepTitle} id="http-request-section">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="HTTP Method">
                <Select value={httpMethod} onChange={setHttpMethod} options={['GET', 'POST']} />
              </Field>
              <Field label="Base URL *" className="md:col-span-2">
                <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Endpoint Path *" className="md:col-span-2">
                <input value={endpointPath} onChange={(e) => setEndpointPath(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Full URL Preview">
                <div className={readonlyCls}>{fullUrlPreview}</div>
              </Field>
              <Field label="JSON request body (optional)" className="md:col-span-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5 dark:border-gdc-border dark:bg-gdc-section">
                    <span className="rounded bg-violet-600 px-2 py-1 text-[11px] font-semibold text-white">JSON</span>
                    <span className="px-2 py-1 text-[11px] font-semibold text-slate-500 dark:text-gdc-muted">Form</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {['Empty Query', 'Sort by Timestamp', 'Last 10', 'Add Filter'].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => applyRequestPreset(preset)}
                        className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-gdc-mutedStrong"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  value={requestBodyText}
                  onChange={(e) => setRequestBodyText(e.target.value)}
                  spellCheck={false}
                  rows={12}
                  placeholder={`Example Elasticsearch-style body:\n{\n  "size": 10,\n  "sort": [{ "timestamp": "asc" }],\n  "query": { "bool": { "filter": [] } }\n}`}
                  className="min-h-[240px] w-full rounded-md border border-slate-200/90 bg-white px-2.5 py-2 font-mono text-[12px] text-slate-900 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400/30 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
                />
              </Field>
            </div>
          </SectionCard>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Polling">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Polling Interval *">
                  <input value={pollingInterval} onChange={(e) => setPollingInterval(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Timeout">
                  <input value={timeoutSec} onChange={(e) => setTimeoutSec(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Initial Delay (Optional)">
                  <input value={initialDelaySec} onChange={(e) => setInitialDelaySec(e.target.value)} className={inputCls} />
                </Field>
              </div>
            </SectionCard>

            <SectionCard title="Pagination">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Pagination Type">
                  <Select
                    value={paginationType}
                    onChange={(v) => {
                      setPaginationType(v)
                      if (v === 'None') setCursorParam('')
                    }}
                    options={['None', 'Cursor based', 'Page based', 'Offset based']}
                  />
                </Field>
                <Field label={paginationType === 'None' ? 'Query pagination parameter' : 'Cursor / page query name'}>
                  <input
                    value={cursorParam}
                    onChange={(e) => setCursorParam(e.target.value)}
                    disabled={paginationType === 'None'}
                    className={inputCls}
                    placeholder={paginationType === 'None' ? '—' : 'e.g. cursor or page'}
                  />
                </Field>
                <Field label="Page Size (Limit)">
                  <input value={pageSize} onChange={(e) => setPageSize(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Max Pages (Optional)">
                  <input value={maxPages} onChange={(e) => setMaxPages(e.target.value)} className={inputCls} />
                </Field>
              </div>
            </SectionCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Checkpoint">
              <div className="space-y-3">
                <Field label="Mode">
                  <Select value={checkpointMode} onChange={setCheckpointMode} options={['Cursor (composite)', 'Cursor', 'Timestamp', 'Event ID']} />
                </Field>
                <Field label="Primary sort field">
                  <input
                    value={checkpointCursorPath}
                    onChange={(e) => setCheckpointCursorPath(e.target.value)}
                    className={inputCls}
                    placeholder="e.g. $.hits.hits[*]._source.timestamp"
                  />
                </Field>
                <Field label="Secondary sort field (optional)">
                  <input
                    value={checkpointSecondaryPath}
                    onChange={(e) => setCheckpointSecondaryPath(e.target.value)}
                    className={inputCls}
                    placeholder="e.g. $.hits.hits[*]._id"
                  />
                </Field>
                <p className="text-[11px] text-slate-500 dark:text-gdc-muted">
                  Composite checkpoints are saved as ordered cursor fields and can be compared lexicographically by runtime logic.
                </p>
              </div>
            </SectionCard>

            <SectionCard title="Schema Detection" id="schema-detection-section">
              <div className="space-y-3">
                <Field label="Event array path (from Mapping)">
                  <div className={readonlyCls}>{mappingEventArrayPath || '—'}</div>
                </Field>
                <Field label="Event root path (from Mapping)">
                  <div className={readonlyCls}>{mappingEventRootPath || '—'}</div>
                </Field>
                <Field label="Schema root path (Optional)">
                  <input value={schemaRootPath} onChange={(e) => setSchemaRootPath(e.target.value)} className={inputCls} />
                </Field>
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-violet-400/40 bg-violet-500/[0.08] px-3 text-[11px] font-semibold text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-300"
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                  Preview Schema
                </button>
              </div>
            </SectionCard>
          </div>

          <SectionCard title="Rate Limit">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Per Minute">
                <input value={rateLimitPerMinute} onChange={(e) => setRateLimitPerMinute(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Burst">
                <input value={rateLimitBurst} onChange={(e) => setRateLimitBurst(e.target.value)} className={inputCls} />
              </Field>
            </div>
          </SectionCard>

          <div id="delivery-section">
            {backendStreamId != null ? (
              <StreamEditDeliveryPanel
                streamId={backendStreamId}
                onSaved={async () => {
                  await refreshRuntimeSnapshot()
                  const cfg = await fetchStreamMappingUiConfig(backendStreamId)
                  setMappingUiWorkflowCfg(cfg ?? null)
                  const routes = await fetchRoutesList()
                  if (routes) {
                    setStreamRouteCount(routes.filter((r) => r.stream_id === backendStreamId).length)
                  }
                }}
              />
            ) : (
              <p className="rounded-md border border-amber-200/80 bg-amber-500/[0.06] px-3 py-2 text-[12px] text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                Delivery routing requires a saved stream with a numeric id. Open this page from the streams list.
              </p>
            )}
          </div>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <section className="rounded-xl border border-amber-200/80 bg-amber-500/[0.06] p-4 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Operational Summary</h3>
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
              <SummaryRow label="Runtime Status" value={runtimeStatus} />
              <SummaryRow label="Health State" value={runtimeHealthState} />
              <SummaryRow label="Events Processed (1h)" value={runtimeEvents1h.toLocaleString()} />
              <SummaryRow label="Delivery Success" value={`${runtimeDeliveryPct.toFixed(2)}%`} />
              <SummaryRow label="Route Count" value={String(runtimeRoutesTotal)} />
              <SummaryRow label="Destination Count" value={String(runtimeDestinationsTotal || 0)} />
              <SummaryRow label="Last Success" value={runtimeLastSuccessAt ?? 'N/A'} />
              <SummaryRow label="Last Error" value={runtimeLastErrorAt ?? 'N/A'} />
            </div>
            <p className="mt-2 text-[11px] text-slate-700 dark:text-gdc-mutedStrong">Failure Policy Summary: {deliveryFailurePolicySummary}</p>
            {runtimeLastErrorMessage ? (
              <p className="mt-1 text-[11px] text-red-700 dark:text-red-300">Last Error Detail: {runtimeLastErrorMessage}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                to={streamRuntimePath(streamId)}
                className="inline-flex h-7 items-center rounded-md border border-violet-300 bg-violet-500/[0.08] px-2 text-[11px] font-semibold text-violet-800 hover:bg-violet-500/15 dark:border-violet-500/40 dark:text-violet-200"
              >
                Open Runtime
              </Link>
              <Link
                to={`/logs/${encodeURIComponent(streamId)}?focus=error`}
                className="inline-flex h-7 items-center rounded-md border border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-800 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
              >
                Open Logs
              </Link>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Quick Actions</h3>
            <div className="mt-3 space-y-2">
              <button
                type="button"
                disabled={testConnectionDisabled}
                onClick={() => void runConnectionTest()}
                className="flex w-full items-center justify-between rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-left text-[12px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-200"
              >
                <span>Test Connection</span>
                {apiTestBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
              </button>
              <button
                type="button"
                disabled={controlBusy || runOnceBusy || backendStreamId == null}
                onClick={() => void executeRunOnce()}
                className="flex w-full items-center justify-between rounded-lg border border-emerald-200/90 bg-emerald-500/[0.06] px-3 py-2 text-left text-[12px] font-semibold text-emerald-800 hover:bg-emerald-500/[0.12] disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/30 dark:text-emerald-200"
              >
                <span>Run Now</span>
                {runOnceBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
              </button>
              <Link
                to={streamRuntimePath(streamId)}
                className="flex w-full items-center justify-between rounded-lg border border-violet-200/90 bg-violet-500/[0.06] px-3 py-2 text-[12px] font-semibold text-violet-800 hover:bg-violet-500/[0.12] dark:border-violet-500/30 dark:text-violet-200"
              >
                <span>View Runtime</span>
                <span aria-hidden>↗</span>
              </Link>
              <Link
                to={`/logs/${encodeURIComponent(streamId)}?focus=stream`}
                className="flex w-full items-center justify-between rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-[12px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-200"
              >
                <span>View Logs</span>
                <span aria-hidden>↗</span>
              </Link>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Stream Summary</h3>
              <StatusBadge tone={headerStatusTone} className="font-bold uppercase">
                {headerStatus}
              </StatusBadge>
            </div>
            <div className="space-y-3 text-[12px]">
              <SummaryRow label="Stream Name" value={streamName} />
              <SummaryRow
                label="Connector"
                value={connectorDisplayName ?? (connectorId != null ? `Connector #${connectorId}` : '—')}
              />
              <SummaryRow
                label="Source Type"
                value={sourceUi.displayName}
              />
              <SummaryRow label="Polling interval" value={`${pollingInterval} seconds`} />
              {isRemoteFilePolling ? (
                <>
                  <SummaryRow
                    label="Protocol"
                    value={connectorRemoteProtocol ? connectorRemoteProtocol.replace(/_/g, ' ') : '—'}
                  />
                  <SummaryRow label="Remote directory" value={rfRemoteDirectory.trim() || '—'} />
                  <SummaryRow label="File pattern" value={rfFilePattern.trim() || '*'} />
                  <SummaryRow label="Parser type" value={rfParserType} />
                </>
              ) : null}
              {isDatabaseQuery ? (
                <>
                  <SummaryRow label="Database type" value={connectorDbType ? connectorDbType.replace(/_/g, ' ') : '—'} />
                  <SummaryRow label="Query mode" value={dbCkMode.replace(/_/g, ' ')} />
                  <SummaryRow label="Checkpoint column" value={dbCkCol.trim() || '—'} />
                </>
              ) : null}
              {isS3ObjectPolling ? (
                <>
                  <SummaryRow label="Bucket" value={s3Bucket.trim() || '—'} />
                  <SummaryRow label="Prefix" value={s3Prefix.trim() || '(root)'} />
                  <SummaryRow label="Max objects per run" value={s3MaxObjects.trim() || '—'} />
                  <SummaryRow
                    label="Object parser"
                    value={streamSnapshotCfg.strict_json_lines === true ? 'Strict JSON lines' : 'Lenient NDJSON'}
                  />
                </>
              ) : null}
              {sourceUi.summary.showHttpEndpointRows ? (
                <>
                  <SummaryRow label="HTTP method" value={httpMethod} />
                  <SummaryRow label="Endpoint path" value={endpointPath || '—'} />
                </>
              ) : null}
              <SummaryRow label="Status" value="enabled" />
              <SummaryRow
                label="Tags"
                value={
                  <div className="flex flex-wrap gap-1">
                    {selectedTags.map((tag) => (
                      <span key={tag} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold dark:border-gdc-border dark:bg-gdc-card">
                        {tag}
                      </span>
                    ))}
                  </div>
                }
              />
              {sourceUi.summary.showRequestPreview ? (
              <div>
                <p className="mb-1 text-[11px] font-semibold text-slate-500 dark:text-gdc-muted">Request preview</p>
                <pre className="overflow-x-auto rounded-md bg-slate-950 p-2 text-[10px] leading-relaxed text-emerald-300">{requestPreview}</pre>
              </div>
              ) : null}
              <div>
                {isRemoteFilePolling && remoteFileProbe ? <RemoteFileProbeSummary res={remoteFileProbe} /> : null}
                <p className="mb-1 text-[11px] font-semibold text-slate-500 dark:text-gdc-muted">
                  Sample response{' '}
                  {liveSampleMeta
                    ? `(live · HTTP ${liveSampleMeta.status} · ${liveSampleMeta.latencyMs} ms, truncated)`
                    : '(placeholder until Test Connection succeeds)'}
                </p>
                <pre className="overflow-x-auto rounded-md bg-slate-950 p-2 text-[10px] leading-relaxed text-sky-200">{samplePanelText}</pre>
              </div>
              <div className="border-t border-slate-200/80 pt-3 dark:border-gdc-border">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Next Steps</p>
                <ol className="space-y-2">
                  {sourceUi.summary.workflowStepLabels.map((step, idx) => (
                    <li key={step} className="flex items-start gap-2">
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-violet-500/[0.12] text-[10px] font-bold text-violet-700 dark:text-violet-300">
                        {idx + 1}
                      </span>
                      <span className="text-[12px] text-slate-700 dark:text-gdc-mutedStrong">{step}</span>
                    </li>
                  ))}
                </ol>
                <p className="mt-2 text-[10px] text-slate-500 dark:text-gdc-muted">
                  Save path: {backendStreamId == null ? 'draft only (non-numeric stream id)' : 'auto-save via API (/api/v1/streams/{id})'}.
                </p>
              </div>
            </div>
          </section>

          {backendStreamId != null ? (
            <section className="rounded-xl border border-red-200/80 bg-red-500/[0.04] p-4 shadow-sm dark:border-red-500/25 dark:bg-red-500/[0.08]">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Delete Stream</h3>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-600 dark:text-gdc-muted">
                Removing this stream deletes mappings, enrichment, checkpoints, and delivery logs for this stream.{' '}
                <span className="font-semibold text-slate-800 dark:text-slate-200">Destinations are never deleted.</span>
              </p>
              {streamRouteCount > 0 ? (
                <p className="mt-2 rounded-md border border-amber-300/70 bg-amber-500/[0.08] px-2 py-1.5 text-[11px] text-amber-950 dark:border-amber-500/35 dark:bg-amber-500/12 dark:text-amber-100">
                  Warning: {streamRouteCount} route(s) still reference destination(s). Routes will be removed; destinations remain.
                </p>
              ) : null}
              {streamIsRunning ? (
                <p className="mt-2 text-[11px] font-semibold text-red-700 dark:text-red-300">
                  Stream status is RUNNING. Stop the stream before deleting.
                </p>
              ) : null}
              {streamDeleteError ? <p className="mt-2 text-[11px] font-medium text-red-700 dark:text-red-300">{streamDeleteError}</p> : null}
              <button
                type="button"
                disabled={streamIsRunning}
                onClick={() => {
                  setStreamDeleteOpen(true)
                  setStreamDeleteConfirm('')
                  setStreamDeleteError(null)
                }}
                className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-red-300/90 bg-white px-3 text-[12px] font-semibold text-red-800 shadow-sm hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/40 dark:bg-gdc-section dark:text-red-200 dark:hover:bg-red-950/40"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Delete Stream
              </button>
            </section>
          ) : null}

          <section className="rounded-xl border border-violet-200/70 bg-violet-500/[0.05] p-4 shadow-sm dark:border-violet-500/20 dark:bg-violet-500/[0.08]">
            <div className="flex items-start gap-2.5">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-violet-700 shadow-sm dark:bg-gdc-card dark:text-violet-300">
                <ShieldCheck className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Need help?</p>
                <p className="mt-0.5 text-[12px] text-slate-600 dark:text-gdc-muted">Learn more about stream configuration in our docs.</p>
                <Link
                  to={streamRuntimePath(streamId)}
                  className="mt-2 inline-flex h-8 items-center rounded-md border border-slate-200/90 bg-white px-3 text-[12px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200 dark:hover:bg-gdc-rowHover"
                >
                  View Docs
                </Link>
              </div>
            </div>
          </section>
        </aside>
      </div>

      {streamDeleteOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-gdc-border dark:bg-gdc-card">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Delete stream permanently?</h3>
            <ul className="mt-2 list-inside list-disc space-y-1 text-[12px] text-slate-600 dark:text-gdc-muted">
              <li>This will permanently remove the stream configuration.</li>
              <li>Checkpoint and runtime state will also be removed.</li>
              <li>Routes will be detached but destinations will remain.</li>
            </ul>
            <p className="mt-3 text-[11px] text-slate-500">
              Type the stream name <span className="font-semibold text-slate-800 dark:text-slate-200">{streamName}</span> to confirm.
            </p>
            <input
              value={streamDeleteConfirm}
              onChange={(e) => setStreamDeleteConfirm(e.target.value)}
              placeholder="Stream name"
              className="mt-2 h-9 w-full rounded-md border border-slate-200 px-2 text-[12px] dark:border-gdc-border dark:bg-gdc-section"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStreamDeleteOpen(false)}
                className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-slate-700 dark:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  streamDeleteBusy ||
                  streamIsRunning ||
                  streamDeleteConfirm.trim() !== streamName.trim()
                }
                onClick={() => void executeStreamDelete()}
                className="rounded-md bg-red-600 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
              >
                {streamDeleteBusy ? 'Deleting…' : 'Delete stream'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SectionCard({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
      <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      {children}
    </section>
  )
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1', className)}>
      <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-gdc-muted">
        <Tag className="h-3 w-3 text-slate-400" aria-hidden />
        {label}
      </label>
      {children}
    </div>
  )
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: readonly string[]
}) {
  return (
    <div className="relative">
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-slate-500 dark:text-gdc-muted">{label}</p>
      <div className="mt-0.5 text-[12px] text-slate-800 dark:text-slate-200">{value}</div>
    </div>
  )
}

const inputCls =
  'h-9 w-full rounded-md border border-slate-200/90 bg-white px-2.5 text-[13px] text-slate-900 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400/30 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100'
const readonlyCls =
  'inline-flex h-9 w-full items-center rounded-md border border-slate-200/90 bg-slate-50 px-2.5 text-[12px] font-medium text-slate-700 dark:border-gdc-border dark:bg-gdc-card dark:text-gdc-mutedStrong'
