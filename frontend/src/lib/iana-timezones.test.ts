import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  FALLBACK_TIMEZONES,
  filterTimezones,
  getIanaTimezones,
  isValidIanaTimezone,
  orderTimezoneOptions,
} from './iana-timezones'

describe('iana-timezones', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses Intl.supportedValuesOf when available and always includes UTC', () => {
    vi.stubGlobal('Intl', {
      ...Intl,
      supportedValuesOf: (key: string) => {
        expect(key).toBe('timeZone')
        return ['Asia/Tokyo', 'Europe/Berlin', 'America/Los_Angeles']
      },
      DateTimeFormat: Intl.DateTimeFormat,
    })
    const list = getIanaTimezones()
    expect(list[0]).toBeDefined()
    expect(list).toContain('UTC')
    expect(list).toContain('Asia/Tokyo')
    expect(list).toContain('Europe/Berlin')
    expect(list).toContain('America/Los_Angeles')
  })

  it('falls back to FALLBACK_TIMEZONES when supportedValuesOf is missing', () => {
    const intlWithout = { ...Intl } as typeof Intl & { supportedValuesOf?: unknown }
    delete intlWithout.supportedValuesOf
    vi.stubGlobal('Intl', intlWithout)
    const list = getIanaTimezones()
    expect(list).toEqual([...FALLBACK_TIMEZONES].sort((a, b) => a.localeCompare(b)))
    expect(list).toContain('UTC')
    expect(list).toContain('Asia/Seoul')
  })

  it('pins UTC first, then user preference, then browser timezone', () => {
    vi.stubGlobal('Intl', {
      ...Intl,
      supportedValuesOf: () => ['Asia/Seoul', 'Europe/London', 'UTC', 'America/New_York'],
      DateTimeFormat: class {
        resolvedOptions() {
          return { timeZone: 'Asia/Tokyo' }
        }
      },
    })
    const ordered = orderTimezoneOptions({
      browserTimezone: 'Asia/Tokyo',
      preferredUserTimezone: 'Europe/London',
    })
    expect(ordered[0]).toBe('UTC')
    expect(ordered[1]).toBe('Europe/London')
    expect(ordered[2]).toBe('Asia/Tokyo')
    expect(ordered).toContain('Asia/Seoul')
  })

  it('pins UTC first and includes browser timezone early', () => {
    vi.stubGlobal('Intl', {
      ...Intl,
      supportedValuesOf: () => ['Asia/Seoul', 'Europe/London', 'UTC', 'America/New_York'],
      DateTimeFormat: class {
        resolvedOptions() {
          return { timeZone: 'Asia/Tokyo' }
        }
      },
    })
    const ordered = orderTimezoneOptions({ browserTimezone: 'Asia/Tokyo' })
    expect(ordered[0]).toBe('UTC')
    expect(ordered[1]).toBe('Asia/Tokyo')
    expect(ordered).toContain('Asia/Seoul')
  })

  it('keeps a saved timezone even when missing from the catalog', () => {
    vi.stubGlobal('Intl', {
      ...Intl,
      supportedValuesOf: () => ['UTC', 'Asia/Seoul'],
      DateTimeFormat: Intl.DateTimeFormat,
    })
    const ordered = orderTimezoneOptions({
      currentValue: 'Custom/MissingZone',
      browserTimezone: 'UTC',
    })
    expect(ordered).toContain('Custom/MissingZone')
  })

  it('filters by substring search', () => {
    const hits = filterTimezones(['UTC', 'Asia/Seoul', 'Asia/Tokyo', 'Europe/Berlin'], 'asia')
    expect(hits).toEqual(['Asia/Seoul', 'Asia/Tokyo'])
  })

  it('validates IANA names via Intl', () => {
    expect(isValidIanaTimezone('Asia/Seoul')).toBe(true)
    expect(isValidIanaTimezone('UTC')).toBe(true)
    expect(isValidIanaTimezone('KST')).toBe(false)
    expect(isValidIanaTimezone('GMT+9')).toBe(false)
    expect(isValidIanaTimezone('')).toBe(false)
  })
})
