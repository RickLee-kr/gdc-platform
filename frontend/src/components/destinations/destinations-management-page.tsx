import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  createDestination,
  deleteDestination,
  previewTestDestination,
  testDestination,
  updateDestination,
  type DestinationListItem,
  type DestinationWritePayload,
  type DestinationTestResult,
} from '../../api/gdcDestinations'
import { useDestinationsOverviewData } from './use-destinations-overview-data'
import type { DestinationUiHealth } from './destination-runtime-metrics'
import { StreamsConsoleControls } from '../streams/streams-console-controls'
import type { StreamsMetricsWindow } from '../../constants/streamConsoleFilters'
import { streamsTimeRangeLabel } from '../../constants/streamConsoleFilters'
import {
  loadStreamsAutoRefresh,
  loadStreamsTimeRange,
  persistStreamsAutoRefresh,
  persistStreamsTimeRange,
  type StreamsAutoRefreshOption,
} from '../../localPreferences'
import { destinationDetailPath } from '../../config/nav-paths'
import { cn } from '../../lib/utils'
import { opTable, opTd, opTh, opThRow, opTr } from '../dashboard/widgets/operational-table-styles'
import { HelpTooltip } from '../ui/help-tooltip'
import { HELP_COPY } from '../ui/help-tooltip-copy'

type WebhookPayloadMode = 'SINGLE_EVENT_OBJECT' | 'BATCH_JSON_ARRAY'
type TlsVerifyMode = 'strict' | 'insecure_skip_verify'

function normalizeWebhookPayloadMode(raw: unknown): WebhookPayloadMode {
  if (raw === 'BATCH_JSON_ARRAY') return 'BATCH_JSON_ARRAY'
  return 'SINGLE_EVENT_OBJECT'
}

function normalizeTlsVerifyMode(raw: unknown): TlsVerifyMode {
  if (raw === 'insecure_skip_verify') return 'insecure_skip_verify'
  return 'strict'
}

type FormState = {
  name: string
  destination_type: DestinationListItem['destination_type']
  host: string
  port: string
  url: string
  webhookPayloadMode: WebhookPayloadMode
  enabled: boolean
  tlsVerifyMode: TlsVerifyMode
  tlsCaCertPath: string
  tlsClientCertPath: string
  tlsClientKeyPath: string
  tlsServerName: string
  tlsConnectTimeout: string
  tlsWriteTimeout: string
}

type SheetMode = 'closed' | 'create' | 'edit'

const INITIAL_FORM: FormState = {
  name: '',
  destination_type: 'SYSLOG_UDP',
  host: '',
  port: '514',
  url: '',
  webhookPayloadMode: 'SINGLE_EVENT_OBJECT',
  enabled: true,
  tlsVerifyMode: 'strict',
  tlsCaCertPath: '',
  tlsClientCertPath: '',
  tlsClientKeyPath: '',
  tlsServerName: '',
  tlsConnectTimeout: '5',
  tlsWriteTimeout: '5',
}

function defaultPortFor(type: DestinationListItem['destination_type']): string {
  if (type === 'SYSLOG_TLS') return '6514'
  return '514'
}

function buildTargetSummary(row: DestinationListItem): string {
  if (row.destination_type === 'WEBHOOK_POST') {
    return String(row.config_json.url ?? '-')
  }
  const host = String(row.config_json.host ?? '-')
  const port = String(row.config_json.port ?? '-')
  const proto =
    row.destination_type === 'SYSLOG_TLS' ? 'tls' : row.destination_type === 'SYSLOG_TCP' ? 'tcp' : 'udp'
  return `${host}:${port} / ${proto}`
}

function payloadFromForm(form: FormState): DestinationWritePayload {
  if (form.destination_type === 'WEBHOOK_POST') {
    return {
      name: form.name.trim(),
      destination_type: 'WEBHOOK_POST',
      enabled: form.enabled,
      config_json: { url: form.url.trim(), payload_mode: form.webhookPayloadMode },
      rate_limit_json: {},
    }
  }
  if (form.destination_type === 'SYSLOG_TLS') {
    const cfg: Record<string, unknown> = {
      host: form.host.trim(),
      port: Number(form.port),
      tls_enabled: true,
      tls_verify_mode: form.tlsVerifyMode,
    }
    if (form.tlsCaCertPath.trim()) cfg.tls_ca_cert_path = form.tlsCaCertPath.trim()
    if (form.tlsClientCertPath.trim()) cfg.tls_client_cert_path = form.tlsClientCertPath.trim()
    if (form.tlsClientKeyPath.trim()) cfg.tls_client_key_path = form.tlsClientKeyPath.trim()
    if (form.tlsServerName.trim()) cfg.tls_server_name = form.tlsServerName.trim()
    if (form.tlsConnectTimeout.trim()) cfg.connect_timeout = Number(form.tlsConnectTimeout)
    if (form.tlsWriteTimeout.trim()) cfg.write_timeout = Number(form.tlsWriteTimeout)
    return {
      name: form.name.trim(),
      destination_type: 'SYSLOG_TLS',
      enabled: form.enabled,
      config_json: cfg,
      rate_limit_json: {},
    }
  }
  return {
    name: form.name.trim(),
    destination_type: form.destination_type,
    enabled: form.enabled,
    config_json: {
      host: form.host.trim(),
      port: Number(form.port),
      protocol: form.destination_type === 'SYSLOG_TCP' ? 'tcp' : 'udp',
    },
    rate_limit_json: {},
  }
}

function formFromRow(row: DestinationListItem): FormState {
  const cfg = row.config_json || {}
  return {
    name: row.name,
    destination_type: row.destination_type,
    host: String(cfg.host ?? ''),
    port: String(cfg.port ?? defaultPortFor(row.destination_type)),
    url: String(cfg.url ?? ''),
    webhookPayloadMode: normalizeWebhookPayloadMode(cfg.payload_mode),
    enabled: row.enabled,
    tlsVerifyMode: normalizeTlsVerifyMode(cfg.tls_verify_mode),
    tlsCaCertPath: String(cfg.tls_ca_cert_path ?? ''),
    tlsClientCertPath: String(cfg.tls_client_cert_path ?? ''),
    tlsClientKeyPath: String(cfg.tls_client_key_path ?? ''),
    tlsServerName: String(cfg.tls_server_name ?? ''),
    tlsConnectTimeout: cfg.connect_timeout != null ? String(cfg.connect_timeout) : '5',
    tlsWriteTimeout: cfg.write_timeout != null ? String(cfg.write_timeout) : '5',
  }
}

function formatRelativeShort(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const diffMs = Date.now() - t
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function typeBadgeClass(dt: DestinationListItem['destination_type']): string {
  switch (dt) {
    case 'SYSLOG_UDP':
      return 'border-violet-300 bg-violet-500/10 text-violet-800 dark:border-violet-500/40 dark:text-violet-200'
    case 'SYSLOG_TCP':
      return 'border-sky-300 bg-sky-500/10 text-sky-800 dark:border-sky-500/40 dark:text-sky-200'
    case 'SYSLOG_TLS':
      return 'border-amber-300 bg-amber-500/10 text-amber-800 dark:border-amber-500/40 dark:text-amber-200'
    case 'WEBHOOK_POST':
      return 'border-emerald-300 bg-emerald-500/10 text-emerald-800 dark:border-emerald-500/40 dark:text-emerald-200'
    default:
      return 'border-slate-300 bg-slate-500/10 text-slate-800'
  }
}

function streamsTierClass(count: number): string {
  if (count === 0) return 'border-slate-200 bg-slate-500/[0.06] text-slate-700 dark:border-gdc-borderStrong dark:text-gdc-mutedStrong'
  if (count >= 3) return 'border-violet-200/80 bg-violet-500/[0.06] text-violet-800 dark:border-violet-500/30 dark:text-violet-200'
  return 'border-sky-200/80 bg-sky-500/[0.06] text-sky-800 dark:border-sky-500/30 dark:text-sky-200'
}

function destinationHealthClass(health: DestinationUiHealth): string {
  switch (health) {
    case 'Healthy':
      return 'border-emerald-300 bg-emerald-500/10 text-emerald-800 dark:border-emerald-500/40 dark:text-emerald-200'
    case 'Warning':
      return 'border-amber-300 bg-amber-500/10 text-amber-900 dark:border-amber-500/40 dark:text-amber-200'
    case 'Critical':
      return 'border-red-300 bg-red-500/10 text-red-800 dark:border-red-500/40 dark:text-red-200'
    case 'Disabled':
      return 'border-slate-200 bg-slate-500/[0.06] text-slate-600 dark:border-gdc-borderStrong dark:text-gdc-muted'
    case 'Idle':
    default:
      return 'border-slate-200 bg-slate-500/[0.06] text-slate-700 dark:border-gdc-borderStrong dark:text-gdc-mutedStrong'
  }
}

function formatSuccessRate(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return '—'
  return `${pct}%`
}

function formatEps(eps: number | null): string {
  if (eps == null || !Number.isFinite(eps)) return '—'
  if (eps === 0) return '0'
  if (eps < 0.01) return '<0.01'
  return eps < 10 ? eps.toFixed(2) : eps.toFixed(1)
}

const deliveryMetricTitle = (windowLabel: string) =>
  `Delivery metrics for ${windowLabel.toLowerCase()}. Shown when events were delivered or failed in that window.`

function protocolLabel(form: FormState): string {
  if (form.destination_type === 'WEBHOOK_POST') return 'HTTPS POST'
  if (form.destination_type === 'SYSLOG_TLS') return 'TCP + TLS'
  if (form.destination_type === 'SYSLOG_TCP') return 'TCP'
  return 'UDP'
}

/** Compact table action control — reads as a button, not a text link. */
const rowActionBtn =
  'inline-flex h-7 shrink-0 items-center justify-center rounded-md border px-2.5 text-[11px] font-semibold shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-45'

type TestBottomToast = {
  destinationName: string
  success: boolean
  message: string
  latencyMs: number
  tlsDetail?: {
    verifyMode?: string
    negotiatedVersion?: string | null
    cipher?: string | null
    serverName?: string
  } | null
}

function extractTlsDetail(detail: Record<string, unknown> | null | undefined): TestBottomToast['tlsDetail'] {
  if (!detail || typeof detail !== 'object') return null
  if (detail.protocol !== 'tls') return null
  return {
    verifyMode: typeof detail.verify_mode === 'string' ? detail.verify_mode : undefined,
    negotiatedVersion:
      typeof detail.negotiated_tls_version === 'string'
        ? detail.negotiated_tls_version
        : detail.negotiated_tls_version == null
          ? null
          : String(detail.negotiated_tls_version),
    cipher:
      typeof detail.cipher === 'string'
        ? detail.cipher
        : detail.cipher == null
          ? null
          : String(detail.cipher),
    serverName: typeof detail.server_name === 'string' ? detail.server_name : undefined,
  }
}

export function DestinationsManagementPage() {
  const [autoRefresh, setAutoRefresh] = useState<StreamsAutoRefreshOption>('Off')
  const [timeRange, setTimeRange] = useState<StreamsMetricsWindow>('1h')
  const [refreshVersion, setRefreshVersion] = useState(0)
  useLayoutEffect(() => {
    setAutoRefresh(loadStreamsAutoRefresh())
    setTimeRange(loadStreamsTimeRange())
  }, [])

  const { rows, loading, runtimeLoading, error, runtimeError, refresh } = useDestinationsOverviewData({
    timeRange,
    refreshVersion,
  })

  useEffect(() => {
    if (autoRefresh === 'Off') return
    const ms =
      autoRefresh === '15s'
        ? 15_000
        : autoRefresh === '30s'
          ? 30_000
          : autoRefresh === '1m'
            ? 60_000
            : autoRefresh === '5m'
              ? 300_000
              : 0
    if (!ms) return
    const id = window.setInterval(() => setRefreshVersion((v) => v + 1), ms)
    return () => window.clearInterval(id)
  }, [autoRefresh])

  const handleAutoRefreshChange = useCallback((value: StreamsAutoRefreshOption) => {
    setAutoRefresh(value)
    persistStreamsAutoRefresh(value)
  }, [])

  const handleTimeRangeChange = useCallback((value: StreamsMetricsWindow) => {
    setTimeRange(value)
    persistStreamsTimeRange(value)
    setRefreshVersion((v) => v + 1)
  }, [])

  const metricsWindowLabel = streamsTimeRangeLabel(timeRange)
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [sheetMode, setSheetMode] = useState<SheetMode>('closed')
  const displayError = localError ?? error
  const displayRuntimeError = runtimeError
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [probeOk, setProbeOk] = useState<boolean | null>(null)
  const [probeBusy, setProbeBusy] = useState(false)
  /** Shown inside the create/edit modal so results are not hidden under the overlay. */
  const [probeBanner, setProbeBanner] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [testBusyId, setTestBusyId] = useState<number | null>(null)
  const [actionBusyId, setActionBusyId] = useState<number | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [searchQ, setSearchQ] = useState('')
  const [typeFilter, setTypeFilter] = useState<'ALL' | DestinationListItem['destination_type']>('ALL')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ENABLED' | 'DISABLED'>('ALL')
  const [showInUseOnly, setShowInUseOnly] = useState(false)
  const [deleteBlocked, setDeleteBlocked] = useState<{ title: string; message: string; destinationId?: number } | null>(
    null,
  )
  const [deleteModal, setDeleteModal] = useState<{ row: DestinationListItem; confirm: string } | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [testBottomToast, setTestBottomToast] = useState<TestBottomToast | null>(null)
  const testToastClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rowRefs = useRef<Map<number, HTMLTableRowElement | null>>(new Map())

  function dismissTestToast() {
    if (testToastClearTimerRef.current) {
      clearTimeout(testToastClearTimerRef.current)
      testToastClearTimerRef.current = null
    }
    setTestBottomToast(null)
  }

  function showTestToast(payload: TestBottomToast) {
    if (testToastClearTimerRef.current) clearTimeout(testToastClearTimerRef.current)
    setTestBottomToast(payload)
    testToastClearTimerRef.current = setTimeout(() => {
      setTestBottomToast(null)
      testToastClearTimerRef.current = null
    }, 10000)
  }

  useEffect(() => {
    return () => {
      if (testToastClearTimerRef.current) clearTimeout(testToastClearTimerRef.current)
    }
  }, [])

  const filteredRows = useMemo(() => {
    let list = [...rows]
    const q = searchQ.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          String(r.id).includes(q) ||
          buildTargetSummary(r).toLowerCase().includes(q),
      )
    }
    if (typeFilter !== 'ALL') {
      list = list.filter((r) => r.destination_type === typeFilter)
    }
    if (statusFilter === 'ENABLED') list = list.filter((r) => r.enabled)
    if (statusFilter === 'DISABLED') list = list.filter((r) => !r.enabled)
    if (showInUseOnly) list = list.filter((r) => r.streams_using_count > 0)
    return list.sort((a, b) => a.id - b.id)
  }, [rows, searchQ, typeFilter, statusFilter, showInUseOnly])

  const usageSummary = useMemo(() => {
    let high = 0
    let low = 0
    let none = 0
    for (const r of rows) {
      const c = r.streams_using_count
      if (c === 0) none += 1
      else if (c >= 3) high += 1
      else low += 1
    }
    return { high, low, none, total: rows.length }
  }, [rows])

  function openCreateSheet() {
    setEditingId(null)
    setSheetMode('create')
    setForm(INITIAL_FORM)
    setProbeOk(null)
    setProbeBanner(null)
    setLocalError(null)
  }

  function openEditSheet(row: DestinationListItem) {
    setEditingId(row.id)
    setSheetMode('edit')
    setForm(formFromRow(row))
    setProbeOk(null)
    setProbeBanner(null)
    setLocalError(null)
  }

  function closeSheet() {
    setSheetMode('closed')
    setEditingId(null)
    setForm(INITIAL_FORM)
    setProbeOk(null)
    setProbeBanner(null)
  }

  async function onProbeForm() {
    if (!form.name.trim()) {
      setProbeBanner({ tone: 'error', text: 'Enter a name before running the connection test.' })
      return
    }
    if (form.destination_type === 'WEBHOOK_POST' && !form.url.trim()) {
      setProbeBanner({ tone: 'error', text: 'Enter a URL for the webhook destination.' })
      return
    }
    if (form.destination_type !== 'WEBHOOK_POST' && (!form.host.trim() || !form.port.trim())) {
      setProbeBanner({ tone: 'error', text: 'Enter both host and port before testing.' })
      return
    }
    setProbeBusy(true)
    setProbeBanner(null)
    setLocalError(null)
    try {
      const payload = payloadFromForm(form)
      const result = await previewTestDestination(payload)
      setProbeOk(result.success)
      setProbeBanner({
        tone: result.success ? 'success' : 'error',
        text: `${result.success ? 'Test finished (ok)' : 'Test finished (failed)'} · ${result.message} · ${Number(result.latency_ms).toFixed(1)} ms`,
      })
    } catch (err) {
      setProbeOk(false)
      setProbeBanner({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Connection test request failed.',
      })
    } finally {
      setProbeBusy(false)
    }
  }

  async function onSubmitSheet(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    if (form.destination_type === 'WEBHOOK_POST' && !form.url.trim()) return
    if (form.destination_type !== 'WEBHOOK_POST' && (!form.host.trim() || !form.port.trim())) return

    setSaving(true)
    setLocalError(null)
    try {
      const payload = payloadFromForm(form)
      if (sheetMode === 'create') {
        await createDestination(payload)
      } else if (sheetMode === 'edit' && editingId != null) {
        await updateDestination(editingId, payload)
      }
      closeSheet()
      await refresh()
      if (probeOk === false) {
        setLocalError('Saved. Last connection test had not succeeded — verify connectivity when possible.')
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  function openDeleteFlow(row: DestinationListItem) {
    setDeleteBlocked(null)
    if (row.enabled) {
      setDeleteBlocked({
        title: 'Cannot delete destination',
        message: `'${row.name}' is still enabled. Disable it before deleting.`,
        destinationId: row.id,
      })
      return
    }
    if (row.routes.length > 0) {
      setDeleteBlocked({
        title: 'Cannot delete destination',
        message: `'${row.name}' is used by ${row.streams_using_count} stream(s). Disable or remove all stream routes using this destination before deleting.`,
        destinationId: row.id,
      })
      return
    }
    setDeleteModal({ row, confirm: '' })
  }

  async function executeDelete() {
    if (!deleteModal) return
    if (deleteModal.confirm.trim() !== deleteModal.row.name.trim()) return
    setDeleteBusy(true)
    setLocalError(null)
    try {
      await deleteDestination(deleteModal.row.id)
      setDeleteModal(null)
      await refresh()
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Delete failed.')
    } finally {
      setDeleteBusy(false)
    }
  }

  async function onTestRow(row: DestinationListItem) {
    setTestBusyId(row.id)
    setLocalError(null)
    try {
      const result: DestinationTestResult = await testDestination(row.id)
      await refresh()
      showTestToast({
        destinationName: row.name,
        success: result.success,
        message: result.message,
        latencyMs: Number(result.latency_ms),
        tlsDetail: extractTlsDetail(result.detail ?? null),
      })
    } catch (err) {
      showTestToast({
        destinationName: row.name,
        success: false,
        message: err instanceof Error ? err.message : 'Test request failed.',
        latencyMs: 0,
        tlsDetail: null,
      })
    } finally {
      setTestBusyId(null)
    }
  }

  async function onToggleEnabled(row: DestinationListItem, nextEnabled: boolean) {
    setActionBusyId(row.id)
    setLocalError(null)
    try {
      await updateDestination(row.id, { enabled: nextEnabled })
      await refresh()
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Update failed.')
    } finally {
      setActionBusyId(null)
    }
  }

  function toggleExpanded(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function lastTestDisplay(row: DestinationListItem): { label: string; ok: boolean | null; rel: string } {
    if (row.last_connectivity_test_at == null) {
      return { label: 'Never tested', ok: null, rel: '' }
    }
    const ok = row.last_connectivity_test_success
    return {
      label: ok ? 'Success' : 'Failed',
      ok: ok ?? false,
      rel: formatRelativeShort(row.last_connectivity_test_at),
    }
  }

  function expandBlockedDestination() {
    if (deleteBlocked?.destinationId == null) return
    const id = deleteBlocked.destinationId
    setExpandedIds((prev) => new Set(prev).add(id))
    setDeleteBlocked(null)
    requestAnimationFrame(() => {
      rowRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }

  const sheetOpen = sheetMode !== 'closed'

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Destinations</h2>
          <p className="mt-1 text-[13px] text-slate-600 dark:text-gdc-muted">
            Manage reusable delivery targets for stream routes.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <button
            type="button"
            onClick={openCreateSheet}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white shadow-sm hover:bg-violet-700"
          >
            <Plus className="h-3.5 w-3.5" />
            New Destination
          </button>
          <StreamsConsoleControls
            autoRefresh={autoRefresh}
            onAutoRefreshChange={handleAutoRefreshChange}
            timeRange={timeRange}
            onTimeRangeChange={handleTimeRangeChange}
            onManualRefresh={() => {
              setRefreshVersion((v) => v + 1)
              void refresh()
            }}
            refreshing={loading || runtimeLoading}
          />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_280px]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200/80 bg-white px-3 py-2 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
            <label className="relative flex min-w-[160px] flex-1 items-center sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2 h-3 w-3 text-slate-400" aria-hidden />
              <input
                placeholder="Search destinations…"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                className="h-8 w-full rounded-md border border-slate-200 bg-white py-1 pl-7 pr-2 text-[12px] text-slate-900 placeholder:text-slate-400 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
              className="h-8 rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-900 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
            >
              <option value="ALL">All Types</option>
              <option value="SYSLOG_UDP">SYSLOG_UDP</option>
              <option value="SYSLOG_TCP">SYSLOG_TCP</option>
              <option value="SYSLOG_TLS">SYSLOG_TLS</option>
              <option value="WEBHOOK_POST">WEBHOOK_POST</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="h-8 rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-900 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
            >
              <option value="ALL">All Status</option>
              <option value="ENABLED">Enabled</option>
              <option value="DISABLED">Disabled</option>
            </select>
            <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-[12px] font-medium text-slate-700 dark:text-gdc-mutedStrong">
              <span>Show in use</span>
              <button
                type="button"
                role="switch"
                aria-checked={showInUseOnly}
                onClick={() => setShowInUseOnly((v) => !v)}
                className={cn(
                  'relative inline-flex h-6 w-10 shrink-0 rounded-full transition-colors',
                  showInUseOnly ? 'bg-violet-600' : 'bg-slate-300 dark:bg-slate-600',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'pointer-events-none absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow transition-[left] duration-200 ease-out',
                    showInUseOnly ? 'left-[calc(100%-1.375rem)]' : 'left-0.5',
                  )}
                />
              </button>
            </label>
          </div>

          {displayError ? <p className="text-[12px] font-medium text-red-600 dark:text-red-400">{displayError}</p> : null}
          {displayRuntimeError ? (
            <p className="text-[12px] font-medium text-amber-800 dark:text-amber-300">
              Runtime metrics unavailable: {displayRuntimeError}
            </p>
          ) : null}
          {runtimeLoading && rows.length > 0 ? (
            <p className="text-[11px] text-slate-500 dark:text-gdc-muted">Refreshing runtime metrics…</p>
          ) : null}

          <section className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card">
            {loading ? (
              <p className="inline-flex items-center gap-2 p-6 text-[12px] text-slate-600 dark:text-gdc-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading destinations...
              </p>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">No destinations yet</p>
                <p className="max-w-md text-[12px] text-slate-600 dark:text-gdc-muted">
                  Create a destination to send stream output to syslog or webhook endpoints. Routes reference destinations when you wire streams to delivery targets.
                </p>
                <button
                  type="button"
                  onClick={openCreateSheet}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white shadow-sm hover:bg-violet-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New Destination
                </button>
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="px-6 py-12 text-center text-[12px] text-slate-500">No destinations match filters.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className={opTable}>
                  <thead>
                    <tr className={opThRow}>
                      <th className={opTh}>Name</th>
                      <th className={opTh}>Type</th>
                      <th className={opTh}>Target</th>
                      <th className={opTh}>Streams</th>
                      <th className={opTh} title="Routes in the catalog that reference this destination">
                        Routes
                      </th>
                      <th className={opTh} title={deliveryMetricTitle(metricsWindowLabel)}>
                        Success
                      </th>
                      <th className={opTh} title={deliveryMetricTitle(metricsWindowLabel)}>
                        EPS
                      </th>
                      <th className={opTh}>Health</th>
                      <th className={opTh}>Issues</th>
                      <th className={opTh}>Status</th>
                      <th className={opTh}>Last Test</th>
                      <th className={opTh}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => {
                      const lt = lastTestDisplay(row)
                      const expanded = expandedIds.has(row.id)
                      const busy = actionBusyId === row.id
                      const dimmed = !row.enabled
                      const count = row.runtime.connectedStreams
                      const routeCount = row.runtime.connectedRoutes
                      const rt = row.runtime
                      return (
                        <Fragment key={row.id}>
                          <tr
                            ref={(el) => {
                              if (el) rowRefs.current.set(row.id, el)
                              else rowRefs.current.delete(row.id)
                            }}
                            className={cn(opTr, dimmed && 'opacity-55')}
                          >
                            <td className={cn(opTd, 'max-w-[200px]')}>
                              <div className="font-semibold text-slate-900 dark:text-gdc-foreground">{row.name}</div>
                              <div className="font-mono text-[11px] text-slate-500 dark:text-gdc-muted">dest_{String(row.id).padStart(3, '0')}</div>
                            </td>
                            <td className={opTd}>
                              <span
                                className={cn(
                                  'inline-flex rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                                  typeBadgeClass(row.destination_type),
                                )}
                              >
                                {row.destination_type}
                              </span>
                            </td>
                            <td
                              className={cn(
                                opTd,
                                'max-w-[220px] truncate font-mono text-[11px] text-slate-700 dark:text-gdc-mutedStrong',
                              )}
                            >
                              {buildTargetSummary(row)}
                            </td>
                            <td className={opTd}>
                              {count === 0 ? (
                                <span
                                  className={cn(
                                    'inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-semibold tabular-nums',
                                    streamsTierClass(count),
                                  )}
                                >
                                  {count}
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => toggleExpanded(row.id)}
                                  className={cn(
                                    'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold tabular-nums',
                                    streamsTierClass(count),
                                  )}
                                >
                                  {count}
                                  {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                </button>
                              )}
                            </td>
                            <td className={cn(opTd, 'tabular-nums text-[11px] font-semibold')} title="Configured routes referencing this destination">
                              {routeCount}
                            </td>
                            <td
                              className={cn(
                                opTd,
                                'tabular-nums text-[11px]',
                                runtimeLoading && 'text-slate-400 dark:text-gdc-muted',
                              )}
                              title={
                                rt.hasDeliveryActivity
                                  ? `Delivery success for ${metricsWindowLabel.toLowerCase()}`
                                  : deliveryMetricTitle(metricsWindowLabel)
                              }
                            >
                              {runtimeLoading ? '…' : formatSuccessRate(rt.successRatePct)}
                            </td>
                            <td
                              className={cn(
                                opTd,
                                'tabular-nums text-[11px] font-semibold',
                                runtimeLoading && 'text-slate-400 dark:text-gdc-muted',
                              )}
                              title={
                                rt.hasDeliveryActivity
                                  ? `Delivered events per second for ${metricsWindowLabel.toLowerCase()}`
                                  : deliveryMetricTitle(metricsWindowLabel)
                              }
                            >
                              {runtimeLoading ? '…' : formatEps(rt.currentEps)}
                            </td>
                            <td className={opTd}>
                              <span
                                className={cn(
                                  'inline-flex rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                                  destinationHealthClass(rt.health),
                                )}
                              >
                                {rt.health}
                              </span>
                            </td>
                            <td className={cn(opTd, 'max-w-[140px] text-[10px] text-slate-600 dark:text-gdc-muted')}>
                              {rt.recentIssues.length === 0 ? (
                                <span className="text-slate-400">—</span>
                              ) : (
                                <span className="line-clamp-2" title={rt.recentIssues.join(' · ')}>
                                  {rt.recentIssues.join(' · ')}
                                </span>
                              )}
                            </td>
                            <td className={opTd}>
                              <div className="flex items-center gap-2">
                                <span
                                  className={cn(
                                    'inline-flex h-1.5 w-1.5 shrink-0 rounded-full',
                                    row.enabled ? 'bg-emerald-500' : 'bg-slate-400',
                                  )}
                                />
                                <span className="text-[11px] font-medium text-slate-800 dark:text-slate-200">
                                  {row.enabled ? 'Enabled' : 'Disabled'}
                                </span>
                              </div>
                            </td>
                            <td className={opTd}>
                              {row.last_connectivity_test_at == null ? (
                                <span className="text-[11px] text-slate-400">— Never tested</span>
                              ) : (
                                <span className="inline-flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
                                  <span
                                    className={cn(
                                      'h-1.5 w-1.5 rounded-full',
                                      lt.ok ? 'bg-emerald-500' : 'bg-red-500',
                                    )}
                                  />
                                  <span className={lt.ok ? 'text-emerald-800 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}>
                                    {lt.label}
                                  </span>
                                  <span className="font-normal text-slate-500">{lt.rel}</span>
                                </span>
                              )}
                            </td>
                            <td className={cn(opTd, 'whitespace-nowrap')}>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={testBusyId === row.id}
                                  onClick={() => void onTestRow(row)}
                                  className={cn(
                                    rowActionBtn,
                                    'border-sky-300/90 bg-white text-sky-800 hover:bg-sky-50 dark:border-sky-600 dark:bg-gdc-card dark:text-sky-200 dark:hover:bg-gdc-rowHover',
                                  )}
                                >
                                  {testBusyId === row.id ? (
                                    <span className="inline-flex items-center gap-1">
                                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                                      Test
                                    </span>
                                  ) : (
                                    'Test'
                                  )}
                                </button>
                                <button
                                  type="button"
                                  disabled={busy || dimmed}
                                  onClick={() => openEditSheet(row)}
                                  className={cn(
                                    rowActionBtn,
                                    'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-gdc-borderStrong dark:bg-gdc-card dark:text-slate-100 dark:hover:bg-gdc-rowHover',
                                  )}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void onToggleEnabled(row, !row.enabled)}
                                  className={cn(
                                    rowActionBtn,
                                    row.enabled
                                      ? 'border-red-200 bg-white text-red-700 hover:bg-red-50 dark:border-red-800 dark:bg-gdc-card dark:text-red-300 dark:hover:bg-red-950/40'
                                      : 'border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-gdc-card dark:text-emerald-200 dark:hover:bg-emerald-950/35',
                                  )}
                                >
                                  {row.enabled ? 'Disable' : 'Enable'}
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => openDeleteFlow(row)}
                                  className={cn(
                                    rowActionBtn,
                                    'border-red-300 bg-white text-red-700 hover:bg-red-50 dark:border-red-700 dark:bg-gdc-card dark:text-red-300 dark:hover:bg-red-950/45',
                                  )}
                                >
                                  Delete
                                </button>
                                <Link
                                  to={destinationDetailPath(String(row.id))}
                                  className={cn(
                                    rowActionBtn,
                                    'border-violet-200 bg-white text-violet-800 hover:bg-violet-50 dark:border-violet-800 dark:bg-gdc-card dark:text-violet-200 dark:hover:bg-violet-950/35',
                                  )}
                                >
                                  Open detail
                                </Link>
                              </div>
                            </td>
                          </tr>
                          {expanded ? (
                            <tr className="border-b border-slate-100 bg-slate-50/80 dark:border-gdc-border dark:bg-gdc-section">
                              <td colSpan={12} className={cn(opTd, 'text-[11px]')}>
                                {row.destination_type === 'SYSLOG_TLS' ? (
                                  <p
                                    data-testid={`tls-info-${row.id}`}
                                    className="mb-2 inline-flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200"
                                  >
                                    <span>tls_active=true</span>
                                    <span>verify_mode={String(row.config_json.tls_verify_mode ?? 'strict')}</span>
                                    {row.config_json.tls_server_name ? (
                                      <span>sni={String(row.config_json.tls_server_name)}</span>
                                    ) : null}
                                    {row.config_json.tls_ca_cert_path ? <span>ca=set</span> : null}
                                    {row.config_json.tls_client_cert_path ? <span>mtls=set</span> : null}
                                  </p>
                                ) : null}
                                {row.routes.length === 0 ? (
                                  <span className="text-slate-500">No routes reference this destination.</span>
                                ) : (
                                  <ul className="space-y-1.5">
                                    {row.routes.map((u) => {
                                      const st = u.route_status ?? '—'
                                      const en = u.route_enabled !== false
                                      return (
                                        <li key={u.route_id}>
                                          <Link
                                            className="font-semibold text-violet-700 hover:underline dark:text-violet-300"
                                            to={`/streams/${u.stream_id}/edit`}
                                          >
                                            {u.stream_name}
                                          </Link>
                                          <span className="text-slate-600 dark:text-gdc-muted">
                                            {' '}
                                            · route #{u.route_id} · {en ? 'enabled' : 'disabled'} · {st}
                                          </span>
                                        </li>
                                      )
                                    })}
                                  </ul>
                                )}
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {!loading && rows.length > 0 ? (
              <div className="flex justify-end border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500 dark:border-gdc-border">
                Showing {filteredRows.length === 0 ? 0 : 1}–{filteredRows.length} of {filteredRows.length} destinations
                {filteredRows.length !== rows.length ? <span className="ml-2">({rows.length} total)</span> : null}
              </div>
            ) : null}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">About Destinations</h3>
            <ul className="mt-3 list-disc space-y-2 pl-4 text-[12px] leading-relaxed text-slate-600 dark:text-gdc-muted">
              <li>Destinations are reusable delivery targets for stream routes.</li>
              <li>Disabling a destination stops new deliveries on routes that reference it.</li>
              <li>Deletion is only allowed when the destination is disabled and not referenced by any route.</li>
              <li>Use Test on a saved destination to record connectivity results, or Test Connection in the create/edit form before saving.</li>
            </ul>
          </section>
          <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">In Use</h3>
            <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-50">{usageSummary.total}</p>
            <p className="text-[11px] text-slate-500">destinations</p>
            <ul className="mt-3 space-y-2 text-[11px]">
              <li className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-violet-500" />
                <span className="text-slate-700 dark:text-gdc-mutedStrong">{usageSummary.high} used by 3+ streams</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-sky-500" />
                <span className="text-slate-700 dark:text-gdc-mutedStrong">{usageSummary.low} used by 1–2 streams</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-600" />
                <span className="text-slate-700 dark:text-gdc-mutedStrong">{usageSummary.none} not in use</span>
              </li>
            </ul>
          </section>
        </aside>
      </div>

      {sheetOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4 sm:p-6"
          role="dialog"
          aria-modal="true"
        >
          <div className="my-auto max-h-[min(92vh,880px)] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-gdc-border dark:bg-gdc-card sm:p-8">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                  {sheetMode === 'create' ? 'Create Destination' : `Edit Destination`}
                </h3>
                <p className="mt-1.5 max-w-xl text-[13px] leading-snug text-slate-500 dark:text-gdc-muted">
                  Test connection with current fields, then save. Save is allowed even if the test fails.
                </p>
              </div>
              <button type="button" onClick={closeSheet} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-gdc-rowHover" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            {probeBanner ? (
              <div
                role="status"
                aria-live="polite"
                className={cn(
                  'mt-4 rounded-lg border px-4 py-3 text-[13px] leading-relaxed',
                  probeBanner.tone === 'success'
                    ? 'border-emerald-300/90 bg-emerald-500/[0.08] text-emerald-950 dark:border-emerald-500/40 dark:bg-emerald-950/30 dark:text-emerald-100'
                    : 'border-red-300/90 bg-red-500/[0.08] text-red-950 dark:border-red-500/40 dark:bg-red-950/35 dark:text-red-100',
                )}
              >
                {probeBanner.text}
              </div>
            ) : null}

            <form onSubmit={(e) => void onSubmitSheet(e)} className="mt-6 grid gap-4">
              <label className="text-[13px] font-medium text-slate-700 dark:text-gdc-mutedStrong">
                Name
                <input
                  required
                  className="mt-1.5 h-10 w-full rounded-md border border-slate-200 px-3 text-[13px] text-slate-900 placeholder:text-slate-400 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100 dark:placeholder:text-slate-500"
                  value={form.name}
                  onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                />
              </label>
              <label className="text-[13px] font-medium text-slate-700 dark:text-gdc-mutedStrong">
                <span className="inline-flex items-center gap-1">
                  Type
                  <HelpTooltip
                    content={HELP_COPY.destinationVsRoute.content}
                    ariaLabel="Destination type help"
                  />
                </span>
                <select
                  className="mt-1.5 h-10 w-full rounded-md border border-slate-200 px-3 text-[13px] text-slate-900 placeholder:text-slate-400 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100 dark:placeholder:text-slate-500"
                  value={form.destination_type}
                  onChange={(e) => {
                    const next = e.target.value as FormState['destination_type']
                    setForm((s) => {
                      const isSyslogChange = next !== s.destination_type && next !== 'WEBHOOK_POST'
                      return {
                        ...s,
                        destination_type: next,
                        port: isSyslogChange ? defaultPortFor(next) : s.port,
                      }
                    })
                  }}
                >
                  <option value="SYSLOG_UDP">SYSLOG_UDP</option>
                  <option value="SYSLOG_TCP">SYSLOG_TCP</option>
                  <option value="SYSLOG_TLS">SYSLOG_TLS</option>
                  <option value="WEBHOOK_POST">WEBHOOK_POST</option>
                </select>
              </label>
              <p className="text-[12px] text-slate-500">
                Protocol: <span className="font-semibold text-slate-700 dark:text-gdc-mutedStrong">{protocolLabel(form)}</span>
              </p>
              {form.destination_type === 'WEBHOOK_POST' ? (
                <>
                  <label className="text-[13px] font-medium text-slate-700 dark:text-gdc-mutedStrong">
                    URL
                    <input
                      required
                      className="mt-1.5 h-10 w-full rounded-md border border-slate-200 px-3 text-[13px] text-slate-900 placeholder:text-slate-400 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100 dark:placeholder:text-slate-500"
                      value={form.url}
                      onChange={(e) => setForm((s) => ({ ...s, url: e.target.value }))}
                      placeholder="https://example.com/webhook"
                    />
                  </label>
                  <label className="text-[13px] font-medium text-slate-700 dark:text-gdc-mutedStrong">
                    Webhook Payload Mode
                    <select
                      className="mt-1.5 h-10 w-full rounded-md border border-slate-200 px-3 text-[13px] text-slate-900 placeholder:text-slate-400 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100 dark:placeholder:text-slate-500"
                      value={form.webhookPayloadMode}
                      onChange={(e) =>
                        setForm((s) => ({
                          ...s,
                          webhookPayloadMode: e.target.value as WebhookPayloadMode,
                        }))
                      }
                    >
                      <option value="SINGLE_EVENT_OBJECT">Single Event Object (one JSON object per HTTP request)</option>
                      <option value="BATCH_JSON_ARRAY">Batch JSON Array (one array per HTTP request)</option>
                    </select>
                  </label>
                  <p className="text-[11px] leading-relaxed text-slate-500 dark:text-gdc-muted">
                    Preview examples (compact JSON): Single →{' '}
                    <code className="rounded bg-slate-100 px-1 font-mono text-[10px] dark:bg-gdc-elevated">
                      {`{"event_type":"reconn"}`}
                    </code>
                    {' · '}
                    Batch →{' '}
                    <code className="rounded bg-slate-100 px-1 font-mono text-[10px] dark:bg-gdc-elevated">
                      {`[{"event_type":"reconn"}]`}
                    </code>
                  </p>
                </>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-[13px] font-medium text-slate-700 dark:text-gdc-mutedStrong">
                      Host
                      <input
                        required
                        className="mt-1.5 h-10 w-full rounded-md border border-slate-200 px-3 text-[13px] text-slate-900 placeholder:text-slate-400 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100 dark:placeholder:text-slate-500"
                        value={form.host}
                        onChange={(e) => setForm((s) => ({ ...s, host: e.target.value }))}
                      />
                    </label>
                    <label className="text-[13px] font-medium text-slate-700 dark:text-gdc-mutedStrong">
                      Port
                      <input
                        required
                        type="number"
                        min={1}
                        max={65535}
                        className="mt-1.5 h-10 w-full rounded-md border border-slate-200 px-3 text-[13px] text-slate-900 placeholder:text-slate-400 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100 dark:placeholder:text-slate-500"
                        value={form.port}
                        onChange={(e) => setForm((s) => ({ ...s, port: e.target.value }))}
                      />
                    </label>
                  </div>
                  {form.destination_type === 'SYSLOG_TLS' ? (
                    <fieldset
                      data-testid="syslog-tls-section"
                      className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/30 p-4 dark:border-amber-500/30 dark:bg-amber-950/20"
                    >
                      <legend className="px-1 text-[12px] font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-200">
                        TLS Settings
                      </legend>
                      <label className="block text-[13px] font-medium text-slate-700 dark:text-gdc-mutedStrong">
                        Verification Mode
                        <select
                          className="mt-1.5 h-10 w-full rounded-md border border-slate-200 px-3 text-[13px] text-slate-900 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100"
                          value={form.tlsVerifyMode}
                          onChange={(e) =>
                            setForm((s) => ({ ...s, tlsVerifyMode: e.target.value as TlsVerifyMode }))
                          }
                        >
                          <option value="strict">strict (CA + hostname check)</option>
                          <option value="insecure_skip_verify">insecure_skip_verify (lab only)</option>
                        </select>
                      </label>
                      {form.tlsVerifyMode === 'insecure_skip_verify' ? (
                        <p
                          role="alert"
                          data-testid="tls-insecure-warning"
                          className="rounded-md border border-amber-400/70 bg-amber-100 px-3 py-2 text-[12px] text-amber-900 dark:border-amber-500/40 dark:bg-amber-900/40 dark:text-amber-100"
                        >
                          Insecure mode disables certificate verification. Use only for lab/local testing.
                        </p>
                      ) : null}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-[13px] font-medium text-slate-700 dark:text-gdc-mutedStrong">
                          CA Certificate Path (optional)
                          <input
                            placeholder="/etc/gdc/tls/ca.pem"
                            className="mt-1.5 h-10 w-full rounded-md border border-slate-200 px-3 text-[13px] text-slate-900 placeholder:text-slate-400 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100 dark:placeholder:text-slate-500"
                            value={form.tlsCaCertPath}
                            onChange={(e) => setForm((s) => ({ ...s, tlsCaCertPath: e.target.value }))}
                          />
                        </label>
                        <label className="text-[13px] font-medium text-slate-700 dark:text-gdc-mutedStrong">
                          SNI Server Name (optional)
                          <input
                            placeholder="defaults to host"
                            className="mt-1.5 h-10 w-full rounded-md border border-slate-200 px-3 text-[13px] text-slate-900 placeholder:text-slate-400 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100 dark:placeholder:text-slate-500"
                            value={form.tlsServerName}
                            onChange={(e) => setForm((s) => ({ ...s, tlsServerName: e.target.value }))}
                          />
                        </label>
                        <label className="text-[13px] font-medium text-slate-700 dark:text-gdc-mutedStrong">
                          Client Certificate Path (optional)
                          <input
                            placeholder="/etc/gdc/tls/client.crt"
                            className="mt-1.5 h-10 w-full rounded-md border border-slate-200 px-3 text-[13px] text-slate-900 placeholder:text-slate-400 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100 dark:placeholder:text-slate-500"
                            value={form.tlsClientCertPath}
                            onChange={(e) => setForm((s) => ({ ...s, tlsClientCertPath: e.target.value }))}
                          />
                        </label>
                        <label className="text-[13px] font-medium text-slate-700 dark:text-gdc-mutedStrong">
                          Client Key Path (optional)
                          <input
                            placeholder="/etc/gdc/tls/client.key"
                            className="mt-1.5 h-10 w-full rounded-md border border-slate-200 px-3 text-[13px] text-slate-900 placeholder:text-slate-400 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100 dark:placeholder:text-slate-500"
                            value={form.tlsClientKeyPath}
                            onChange={(e) => setForm((s) => ({ ...s, tlsClientKeyPath: e.target.value }))}
                          />
                        </label>
                        <label className="text-[13px] font-medium text-slate-700 dark:text-gdc-mutedStrong">
                          Connect Timeout (s)
                          <input
                            type="number"
                            min={1}
                            step="1"
                            className="mt-1.5 h-10 w-full rounded-md border border-slate-200 px-3 text-[13px] text-slate-900 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100"
                            value={form.tlsConnectTimeout}
                            onChange={(e) => setForm((s) => ({ ...s, tlsConnectTimeout: e.target.value }))}
                          />
                        </label>
                        <label className="text-[13px] font-medium text-slate-700 dark:text-gdc-mutedStrong">
                          Write Timeout (s)
                          <input
                            type="number"
                            min={1}
                            step="1"
                            className="mt-1.5 h-10 w-full rounded-md border border-slate-200 px-3 text-[13px] text-slate-900 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100"
                            value={form.tlsWriteTimeout}
                            onChange={(e) => setForm((s) => ({ ...s, tlsWriteTimeout: e.target.value }))}
                          />
                        </label>
                      </div>
                    </fieldset>
                  ) : null}
                </>
              )}
              <label className="inline-flex items-center gap-2 text-[13px] text-slate-700 dark:text-gdc-mutedStrong">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm((s) => ({ ...s, enabled: e.target.checked }))}
                />
                <span className="inline-flex items-center gap-1">
                  Enabled
                  <HelpTooltip content={HELP_COPY.destinationEnabled.content} ariaLabel="Destination enabled help" />
                </span>
              </label>

              {probeOk === false ? (
                <div className="rounded-lg border border-amber-300/80 bg-amber-50 px-4 py-3 text-[12px] leading-relaxed text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100">
                  The last connection test did not succeed. You can still save; verify host, port, or URL and firewall rules.
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => void onProbeForm()}
                  disabled={probeBusy}
                  className="inline-flex h-10 min-w-[140px] items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-800 shadow-sm dark:border-gdc-borderStrong dark:bg-gdc-card dark:text-slate-100"
                >
                  {probeBusy ? 'Testing…' : 'Test Connection'}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex h-10 min-w-[120px] items-center justify-center rounded-md bg-violet-600 px-4 text-[13px] font-semibold text-white disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" onClick={closeSheet} className="inline-flex h-10 items-center px-3 text-[13px] font-semibold text-slate-600 dark:text-gdc-muted">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {deleteBlocked ? (
        <div
          role="alert"
          className="fixed bottom-4 left-1/2 z-50 w-[min(100%,520px)] -translate-x-1/2 rounded-lg border border-amber-300/90 bg-amber-50 px-4 py-3 shadow-lg dark:border-amber-500/40 dark:bg-amber-950/90"
        >
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">{deleteBlocked.title}</p>
              <p className="mt-1 text-[12px] text-amber-900/90 dark:text-amber-200/90">{deleteBlocked.message}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {deleteBlocked.destinationId != null ? (
                  <button
                    type="button"
                    onClick={expandBlockedDestination}
                    className="rounded-md border border-amber-400/60 bg-white px-3 py-1.5 text-[12px] font-semibold text-amber-950 dark:bg-amber-900/40 dark:text-amber-50"
                  >
                    View usage details
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setDeleteBlocked(null)}
                  className="px-2 py-1.5 text-[12px] font-semibold text-amber-900/80 dark:text-amber-200"
                >
                  Cancel
                </button>
              </div>
            </div>
            <button type="button" onClick={() => setDeleteBlocked(null)} className="shrink-0 text-amber-700 dark:text-amber-300" aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      {testBottomToast ? (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            'fixed bottom-4 left-1/2 z-[60] w-[min(100%,560px)] -translate-x-1/2 rounded-lg border px-4 py-3 shadow-xl backdrop-blur-[2px]',
            testBottomToast.success
              ? 'border-emerald-400/80 bg-emerald-50/95 dark:border-emerald-500/50 dark:bg-emerald-950/95'
              : 'border-red-400/80 bg-red-50/95 dark:border-red-500/50 dark:bg-red-950/95',
          )}
        >
          <div className="flex gap-3">
            {testBottomToast.success ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            ) : (
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-50">
                Connection test · {testBottomToast.destinationName}
              </p>
              <p className="mt-1 line-clamp-3 text-[12px] leading-snug text-slate-700 dark:text-gdc-mutedStrong">
                <span className={testBottomToast.success ? 'text-emerald-800 dark:text-emerald-200' : 'text-red-800 dark:text-red-200'}>
                  {testBottomToast.success ? 'Success' : 'Failed'}
                </span>
                {testBottomToast.latencyMs > 0 ? (
                  <span className="text-slate-600 dark:text-gdc-muted"> · {testBottomToast.latencyMs.toFixed(1)} ms</span>
                ) : null}
                <span className="text-slate-600 dark:text-gdc-muted"> · {testBottomToast.message}</span>
              </p>
              {testBottomToast.tlsDetail ? (
                <p
                  data-testid="tls-test-detail"
                  className="mt-1 text-[11px] font-mono text-slate-700 dark:text-gdc-mutedStrong"
                >
                  TLS · {testBottomToast.tlsDetail.verifyMode ?? '—'}
                  {testBottomToast.tlsDetail.negotiatedVersion
                    ? ` · ${testBottomToast.tlsDetail.negotiatedVersion}`
                    : ''}
                  {testBottomToast.tlsDetail.cipher ? ` · ${testBottomToast.tlsDetail.cipher}` : ''}
                  {testBottomToast.tlsDetail.serverName
                    ? ` · sni=${testBottomToast.tlsDetail.serverName}`
                    : ''}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={dismissTestToast}
              className="shrink-0 rounded p-1 text-slate-500 hover:bg-black/5 dark:text-gdc-muted dark:hover:bg-white/10"
              aria-label="Dismiss test result"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      {deleteModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-gdc-border dark:bg-gdc-card">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Delete destination</h3>
            <p className="mt-2 text-[12px] leading-relaxed text-slate-600 dark:text-gdc-muted">
              This will permanently remove <span className="font-semibold text-slate-900 dark:text-slate-100">{deleteModal.row.name}</span>. Type the destination
              name to confirm.
            </p>
            <ul className="mt-2 list-inside list-disc text-[11px] text-slate-500">
              <li>This will permanently remove the destination configuration.</li>
              <li>Routes must already be detached — this destination has none.</li>
            </ul>
            <input
              value={deleteModal.confirm}
              onChange={(e) => setDeleteModal((m) => (m ? { ...m, confirm: e.target.value } : m))}
              placeholder="Destination name"
              className="mt-3 h-9 w-full rounded-md border border-slate-200 px-2 text-[12px] text-slate-900 placeholder:text-slate-400 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-100 dark:placeholder:text-slate-500"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteModal(null)} className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteBusy || deleteModal.confirm.trim() !== deleteModal.row.name.trim()}
                onClick={() => void executeDelete()}
                className="rounded-md bg-red-600 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
              >
                {deleteBusy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
