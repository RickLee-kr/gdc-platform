/**
 * IANA timezone catalog for display-timezone settings.
 * Prefer Intl.supportedValuesOf("timeZone"); fall back to a curated list.
 */

/** Minimal fallback when Intl.supportedValuesOf is unavailable. */
export const FALLBACK_TIMEZONES: readonly string[] = [
  'UTC',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/New_York',
  'America/Sao_Paulo',
  'America/Toronto',
  'Asia/Bangkok',
  'Asia/Dubai',
  'Asia/Hong_Kong',
  'Asia/Kolkata',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Melbourne',
  'Australia/Sydney',
  'Europe/Amsterdam',
  'Europe/Berlin',
  'Europe/London',
  'Europe/Moscow',
  'Europe/Paris',
  'Pacific/Auckland',
] as const

export function resolveBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** True when the runtime can resolve `tz` as an IANA zone for formatting. */
export function isValidIanaTimezone(tz: string | null | undefined): boolean {
  const name = (tz ?? '').trim()
  if (!name) return false
  try {
    Intl.DateTimeFormat(undefined, { timeZone: name })
    return true
  } catch {
    return false
  }
}

/**
 * Full IANA list from the browser when available; otherwise FALLBACK_TIMEZONES.
 * Always includes UTC.
 */
export function getIanaTimezones(): string[] {
  let raw: string[] = []
  try {
    const intl = Intl as typeof Intl & {
      supportedValuesOf?: (key: string) => string[]
    }
    if (typeof intl.supportedValuesOf === 'function') {
      raw = intl.supportedValuesOf('timeZone')
    }
  } catch {
    raw = []
  }
  if (!raw.length) {
    raw = [...FALLBACK_TIMEZONES]
  }
  const set = new Set(raw.map((z) => z.trim()).filter(Boolean))
  set.add('UTC')
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

/**
 * Ordered options for timezone pickers:
 * UTC first, then user preference (if distinct), then browser zone (if distinct), then remaining A–Z.
 * `currentValue` is included even when missing from the catalog so the control does not blank out.
 */
export function orderTimezoneOptions(options?: {
  currentValue?: string | null
  browserTimezone?: string | null
  /** User display-timezone preference (IANA). Placed after UTC when distinct. */
  preferredUserTimezone?: string | null
}): string[] {
  const catalog = getIanaTimezones()
  const browser = (options?.browserTimezone ?? resolveBrowserTimezone()).trim() || 'UTC'
  const user = (options?.preferredUserTimezone ?? '').trim()
  const current = (options?.currentValue ?? '').trim()

  const ordered: string[] = []
  const seen = new Set<string>()
  const push = (tz: string) => {
    if (!tz || seen.has(tz)) return
    seen.add(tz)
    ordered.push(tz)
  }

  push('UTC')
  if (user && user !== 'UTC') push(user)
  if (browser !== 'UTC' && browser !== user) push(browser)
  for (const tz of catalog) push(tz)
  if (current) push(current)
  return ordered
}

export function filterTimezones(timezones: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...timezones]
  return timezones.filter((tz) => tz.toLowerCase().includes(q))
}
