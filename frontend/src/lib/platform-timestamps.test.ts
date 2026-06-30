import { describe, expect, it } from 'vitest'
import { setDisplayTimezoneCache } from './display-timezone-cache'
import {
  formatPlatformRelative,
  formatPlatformTimestamp,
  parseApiTimestampMs,
  resolveDisplayTimezone,
} from './platform-timestamps'

describe('parseApiTimestampMs', () => {
  it('parses Z-suffixed UTC ISO', () => {
    const ms = parseApiTimestampMs('2026-06-29T07:10:00Z')
    expect(ms).toBe(Date.parse('2026-06-29T07:10:00Z'))
  })

  it('treats naive API strings as UTC', () => {
    const withZ = parseApiTimestampMs('2026-06-29T07:10:00Z')
    const naive = parseApiTimestampMs('2026-06-29T07:10:00')
    expect(naive).toBe(withZ)
  })
})

describe('resolveDisplayTimezone', () => {
  it('prefers user over platform over browser', () => {
    expect(
      resolveDisplayTimezone({
        userTimezone: 'Asia/Seoul',
        platformDefaultTimezone: 'Europe/London',
      }),
    ).toBe('Asia/Seoul')
    expect(resolveDisplayTimezone({ userTimezone: '', platformDefaultTimezone: 'Asia/Seoul' })).toBe('Asia/Seoul')
  })
})

describe('formatPlatformTimestamp', () => {
  it('converts UTC to Asia/Seoul with zone label', () => {
    setDisplayTimezoneCache({ platformDefaultTimezone: 'Asia/Seoul', userTimezone: null })
    const out = formatPlatformTimestamp('2026-06-29T07:10:00Z', 'Asia/Seoul')
    expect(out).toMatch(/2026-06-29 16:10/)
    expect(out).toMatch(/GMT\+9|KST/)
  })
})

describe('formatPlatformRelative', () => {
  it('uses UTC epoch for relative labels', () => {
    const twoMinAgoUtc = new Date(Date.now() - 120_000).toISOString()
    expect(formatPlatformRelative(twoMinAgoUtc)).toBe('2m ago')
  })
})
