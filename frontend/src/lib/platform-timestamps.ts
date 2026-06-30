/**
 * Platform timestamp parsing and display.
 *
 * All API timestamps are UTC ISO strings. Parsing always treats naive strings as UTC.
 * Display conversion uses an explicit IANA timezone — never the server OS or stripped offsets.
 */

import { getDisplayTimezoneCache } from './display-timezone-cache'

export type FormatPlatformTimestampOptions = {
  /** When true (default), append timezone abbreviation (e.g. KST). */
  withTimezoneLabel?: boolean
}

/** Parse API UTC ISO timestamp to epoch ms. Naive strings are interpreted as UTC. */
export function parseApiTimestampMs(iso: string | null | undefined): number | null {
  if (iso == null) return null
  const raw = String(iso).trim()
  if (!raw || raw === '—') return null
  if (/[zZ]$/.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw)) {
    const t = Date.parse(raw)
    return Number.isFinite(t) ? t : null
  }
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
  const t = Date.parse(`${normalized}Z`)
  return Number.isFinite(t) ? t : null
}

export function resolveBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function resolveDisplayTimezone(input: {
  userTimezone?: string | null
  platformDefaultTimezone?: string | null
}): string {
  const user = (input.userTimezone ?? '').trim()
  if (user) return user
  const platform = (input.platformDefaultTimezone ?? '').trim()
  if (platform) return platform
  try {
    return resolveBrowserTimezone()
  } catch {
    return 'UTC'
  }
}

export function getTimezoneAbbreviation(timezone: string, at: Date = new Date()): string {
  if (timezone === 'UTC') return 'UTC'
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'short',
    }).formatToParts(at)
    const label = parts.find((p) => p.type === 'timeZoneName')?.value
    if (label) return label
  } catch {
    /* fall through */
  }
  return timezone
}

function formatLocalParts(d: Date, timezone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d)
    const y = parts.find((p) => p.type === 'year')?.value
    const m = parts.find((p) => p.type === 'month')?.value
    const day = parts.find((p) => p.type === 'day')?.value
    const h = parts.find((p) => p.type === 'hour')?.value
    const min = parts.find((p) => p.type === 'minute')?.value
    if (!y || !m || !day || !h || !min) return null
    return `${y}-${m}-${day} ${h}:${min}`
  } catch {
    return null
  }
}

/** Format UTC ISO timestamp for display in the given IANA timezone. */
export function formatPlatformTimestamp(
  iso: string | null | undefined,
  timezone: string,
  options: FormatPlatformTimestampOptions = {},
): string {
  if (!iso) return '—'
  const t = parseApiTimestampMs(iso)
  if (t == null) {
    const trimmed = String(iso).trim()
    return trimmed && trimmed !== '—' ? trimmed : '—'
  }
  const d = new Date(t)
  const formatted = formatLocalParts(d, timezone)
  if (!formatted) return '—'
  const withZone = options.withTimezoneLabel !== false
  if (!withZone) return formatted
  return `${formatted} ${getTimezoneAbbreviation(timezone, d)}`
}

/** Relative time label (timezone-independent; compares UTC epoch ms). */
export function formatPlatformRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const t = parseApiTimestampMs(iso)
  if (t == null) {
    const trimmed = String(iso).trim()
    return trimmed && trimmed !== '—' ? trimmed : '—'
  }
  const diffMs = Date.now() - t
  if (diffMs < 0) return '—'
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

/** @deprecated Use formatPlatformTimestamp with explicit timezone. */
export function formatShortTs(iso: string | null | undefined, timezone: string): string {
  return formatPlatformTimestamp(iso, timezone, { withTimezoneLabel: true })
}

/** Format using cached user/platform/browser timezone (for non-React helpers). */
export function formatTimestampWithResolvedTimezone(
  iso: string | null | undefined,
  options?: FormatPlatformTimestampOptions,
): string {
  const cache = getDisplayTimezoneCache()
  const tz = resolveDisplayTimezone(cache)
  return formatPlatformTimestamp(iso, tz, options)
}

/** @deprecated Use formatPlatformRelative. */
export function formatRelativeShort(iso: string | null | undefined): string {
  return formatPlatformRelative(iso)
}
