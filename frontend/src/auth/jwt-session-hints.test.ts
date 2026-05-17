import { describe, expect, it } from 'vitest'
import { accessTokenRequiresPasswordChange } from './jwt-session-hints'

function b64url(obj: Record<string, unknown>): string {
  const json = JSON.stringify(obj)
  const b64 = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `hdr.${b64}.sig`
}

describe('accessTokenRequiresPasswordChange', () => {
  it('returns true when mcp claim is present', () => {
    const token = b64url({ sub: '1', mcp: 1 })
    expect(accessTokenRequiresPasswordChange(token)).toBe(true)
  })

  it('returns false when mcp claim is absent', () => {
    const token = b64url({ sub: '1' })
    expect(accessTokenRequiresPasswordChange(token)).toBe(false)
  })
})
