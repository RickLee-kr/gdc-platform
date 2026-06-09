import { describe, expect, it } from 'vitest'
import { appNavKeyFromPathname, legacyRuntimeRedirectTarget, NAV_PATH, runtimeOverviewPath } from './nav-paths'

describe('nav-paths M17.1', () => {
  it('maps templates to templates nav key under Streams IA', () => {
    expect(appNavKeyFromPathname('/templates')).toBe('templates')
    expect(appNavKeyFromPathname('/streams')).toBe('streams')
  })

  it('maps canonical monitoring and legacy runtime paths to monitoring nav key', () => {
    expect(appNavKeyFromPathname('/monitoring')).toBe('monitoring')
    expect(appNavKeyFromPathname('/runtime')).toBe('monitoring')
    expect(appNavKeyFromPathname('/runtime/topology')).toBe('monitoring')
    expect(appNavKeyFromPathname('/monitoring/analytics')).toBe('monitoring')
    expect(appNavKeyFromPathname('/')).toBe('monitoring')
  })

  it('maps administration enclave paths', () => {
    expect(appNavKeyFromPathname('/admin')).toBe('administration')
    expect(appNavKeyFromPathname('/connectors')).toBe('connectors')
    expect(appNavKeyFromPathname('/settings')).toBe('settings')
    expect(appNavKeyFromPathname('/validation')).toBe('validation')
  })

  it('maps governance sub-routes', () => {
    expect(appNavKeyFromPathname('/governance')).toBe('governance')
    expect(appNavKeyFromPathname('/governance/ai')).toBe('aiGateway')
    expect(appNavKeyFromPathname('/governance/data-protection')).toBe('governanceDataProtection')
  })

  it('provides legacy runtime redirect targets', () => {
    expect(legacyRuntimeRedirectTarget('/runtime', '?stream_id=1', '')).toBe('/monitoring?stream_id=1')
    expect(legacyRuntimeRedirectTarget('/runtime/topology', '', '#x')).toBe('/monitoring/topology#x')
    expect(legacyRuntimeRedirectTarget('/runtime/ai-gateway', '', '')).toBe('/governance/ai')
    expect(legacyRuntimeRedirectTarget('/streams', '', '')).toBeNull()
  })

  it('uses /monitoring/streams for runtimeOverviewPath', () => {
    expect(runtimeOverviewPath({ stream_id: 3 })).toBe('/monitoring/streams?stream_id=3')
    expect(NAV_PATH.aiGateway).toBe('/governance/ai')
  })
})
