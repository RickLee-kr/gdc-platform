import type { RecentLogLine, RunHistoryRow } from '../components/streams/stream-runtime-detail-model'
import type { RuntimeTimelineItem } from './types/gdcApi'

function safeNonNegInt(n: unknown): number {
  const x = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(x) || x < 0) return 0
  return Math.floor(x)
}

function normalizeRecentLevel(raw: string | null | undefined): RecentLogLine['level'] {
  const u = String(raw ?? '').trim().toUpperCase()
  if (u === 'ERROR') return 'ERROR'
  if (u === 'WARN' || u === 'WARNING') return 'WARN'
  if (u === 'DEBUG') return 'DEBUG'
  return 'INFO'
}

function formatTimelineTimestamp(iso: string | null | undefined): string {
  if (iso == null || typeof iso !== 'string') return '—'
  const t = iso.trim()
  if (!t) return '—'
  if (t.length >= 19) return t.slice(0, 19).replace('T', ' ')
  return t.slice(0, 16).replace('T', ' ')
}

function formatClockTime(iso: string | null | undefined): string {
  if (iso == null || typeof iso !== 'string') return '—'
  const t = iso.trim()
  if (!t) return '—'
  if (t.length >= 19) return t.slice(11, 19)
  return t.slice(0, 16).replace('T', ' ')
}

function formatLatencyMs(ms: number | null | undefined): string {
  if (ms == null) return '—'
  const n = typeof ms === 'number' ? ms : Number(ms)
  if (!Number.isFinite(n) || n < 0) return '—'
  return `${safeNonNegInt(n)} ms`
}

/** Maps timeline delivery rows into the Run History table shape (one row per timeline event). */
export function timelineItemsToRunHistoryRows(items: readonly RuntimeTimelineItem[] | null | undefined): RunHistoryRow[] {
  if (!items?.length) return []
  return items.map((t) => {
    const level = String(t.level ?? '').toUpperCase()
    const st = String(t.status ?? '').toLowerCase()
    let status: RunHistoryRow['status'] = 'Success'
    if (level === 'ERROR' || st.includes('fail') || st === 'error') status = 'Failed'
    else if (level === 'WARN' || st.includes('partial')) status = 'Partial'

    const failed = status === 'Failed' ? 1 : 0
    const delivered = status === 'Success' ? 1 : 0

    const idPart = t.id != null && Number.isFinite(Number(t.id)) ? String(t.id) : '—'

    return {
      runId: `evt-${idPart}`,
      startedAt: formatTimelineTimestamp(t.created_at),
      duration: formatLatencyMs(t.latency_ms),
      status,
      events: 1,
      delivered,
      failed,
    }
  })
}

/** Sidebar recent log lines derived from the same timeline payload (newest-first preserved). */
export function timelineItemsToRecentLogLines(items: readonly RuntimeTimelineItem[] | null | undefined, max = 12): RecentLogLine[] {
  if (!items?.length) return []
  const slice = items.slice(0, max)
  return slice.map((t) => {
    const msg = String(t.message ?? '')
    return {
      at: formatClockTime(t.created_at),
      level: normalizeRecentLevel(t.level),
      message: msg.length > 140 ? `${msg.slice(0, 137)}…` : msg,
      duration: formatLatencyMs(t.latency_ms),
    }
  })
}
