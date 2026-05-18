import { GDC_DEFAULT_READ_JSON_TIMEOUT_MS, safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'
import type { MetricsWindow } from './gdcRuntime'
import type { ObservabilitySummaryResponse } from './types/gdcApi'

const RT = `${GDC_API_PREFIX}/runtime`
const readJsonOpts = { timeoutMs: GDC_DEFAULT_READ_JSON_TIMEOUT_MS }
const SUMMARY_CACHE_TTL_MS = 15_000

type SummaryCacheEntry = {
  promise?: Promise<ObservabilitySummaryResponse | null>
  value?: ObservabilitySummaryResponse | null
  updatedAt?: number
}

const summaryCache = new Map<string, SummaryCacheEntry>()

function normalizeSnapshotId(snapshotId: string | undefined): string {
  const trimmed = snapshotId?.trim()
  return trimmed && trimmed !== '' ? trimmed : 'latest'
}

export function observabilitySummaryRequestKey(window: MetricsWindow = '24h', snapshotId?: string): string {
  return `${window}:${normalizeSnapshotId(snapshotId)}`
}

function nowMs(): number {
  return Date.now()
}

function logDevTiming(key: string, startedAt: number): void {
  if (!import.meta.env.DEV) return
  const elapsedMs =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now() - startedAt
      : Date.now() - startedAt
  console.info('[observability] summary fetch ms', { key, elapsed_ms: Math.round(elapsedMs) })
}

async function fetchObservabilitySummaryUncached(
  window: MetricsWindow = '24h',
  params: { snapshot_id?: string } = {},
): Promise<ObservabilitySummaryResponse | null> {
  const q = new URLSearchParams({ window })
  if (params.snapshot_id != null && params.snapshot_id.trim() !== '') q.set('snapshot_id', params.snapshot_id.trim())
  return safeRequestJson<ObservabilitySummaryResponse>(`${RT}/observability/summary?${q.toString()}`, readJsonOpts)
}

export function clearObservabilitySummaryCache(key?: string): void {
  if (key == null) {
    summaryCache.clear()
    return
  }
  summaryCache.delete(key)
}

export async function fetchObservabilitySummary(
  window: MetricsWindow = '24h',
  params: { snapshot_id?: string } = {},
): Promise<ObservabilitySummaryResponse | null> {
  const snapshotId = normalizeSnapshotId(params.snapshot_id)
  const key = observabilitySummaryRequestKey(window, snapshotId)
  const cached = summaryCache.get(key)
  if (cached?.promise != null) return cached.promise

  const cachedAge = cached?.updatedAt == null ? Number.POSITIVE_INFINITY : nowMs() - cached.updatedAt
  if (cached != null && cachedAge < SUMMARY_CACHE_TTL_MS) return cached.value ?? null

  const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
  const promise = fetchObservabilitySummaryUncached(window, snapshotId === 'latest' ? {} : { snapshot_id: snapshotId })
    .then((value) => {
      summaryCache.set(key, { value, updatedAt: nowMs() })
      return value
    })
    .catch((err) => {
      summaryCache.delete(key)
      throw err
    })
    .finally(() => {
      logDevTiming(key, startedAt)
      const entry = summaryCache.get(key)
      if (entry?.promise === promise) {
        summaryCache.set(key, { value: entry.value, updatedAt: entry.updatedAt })
      }
    })

  summaryCache.set(key, { ...cached, promise })
  return promise
}

