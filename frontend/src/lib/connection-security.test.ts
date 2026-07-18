import { describe, expect, it } from 'vitest'
import {
  resolveConnectionSecurity,
  shouldShowInsecureConnectionWarning,
} from './connection-security'

describe('resolveConnectionSecurity', () => {
  it('treats page HTTPS as secure even if backend scheme is missing', () => {
    expect(
      resolveConnectionSecurity({
        pageProtocol: 'https:',
        requestScheme: 'unknown',
        currentAccessUrl: null,
      }),
    ).toEqual({ secure: true, source: 'page_https' })
    expect(
      shouldShowInsecureConnectionWarning({
        pageProtocol: 'https:',
        requestScheme: 'http',
      }),
    ).toBe(false)
  })

  it('warns for page HTTP regardless of backend HTTPS availability', () => {
    expect(
      resolveConnectionSecurity({
        pageProtocol: 'http:',
        requestScheme: 'https',
        currentAccessUrl: 'https://gdc.example/',
      }),
    ).toEqual({ secure: false, source: 'page_http' })
    expect(
      shouldShowInsecureConnectionWarning({
        pageProtocol: 'http:',
        requestScheme: 'https',
        currentAccessUrl: 'https://gdc.example/',
      }),
    ).toBe(true)
  })

  it('uses request_scheme when page protocol is unusual', () => {
    expect(
      resolveConnectionSecurity({
        pageProtocol: 'file:',
        requestScheme: 'https',
      }),
    ).toEqual({ secure: true, source: 'request_scheme' })
    expect(
      resolveConnectionSecurity({
        pageProtocol: 'file:',
        requestScheme: 'http',
      }),
    ).toEqual({ secure: false, source: 'request_scheme' })
  })

  it('uses current_access_url when scheme signals are missing', () => {
    expect(
      resolveConnectionSecurity({
        pageProtocol: 'file:',
        requestScheme: 'unknown',
        currentAccessUrl: 'https://gdc.example:18443/',
      }),
    ).toEqual({ secure: true, source: 'current_access_url' })
  })
})
