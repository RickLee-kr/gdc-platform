import { describe, expect, it } from 'vitest'
import {
  appEnvDotClass,
  classifyAppEnvTier,
  formatAppEnvLabel,
  normalizeAppEnv,
} from './platform-environment'

describe('platform-environment', () => {
  it('normalizes and classifies app_env values', () => {
    expect(normalizeAppEnv('  production ')).toBe('production')
    expect(classifyAppEnvTier('prod')).toBe('production')
    expect(classifyAppEnvTier('development')).toBe('development')
    expect(classifyAppEnvTier('staging')).toBe('staging')
    expect(classifyAppEnvTier('')).toBe('unknown')
  })

  it('formats operator-facing labels consistently with admin footer source', () => {
    expect(formatAppEnvLabel('production')).toBe('Production')
    expect(formatAppEnvLabel('development')).toBe('Development')
    expect(formatAppEnvLabel(null)).toBe('Unknown environment')
    expect(formatAppEnvLabel('custom-lab')).toBe('custom-lab')
  })

  it('maps tier to distinct status dots', () => {
    expect(appEnvDotClass('production')).toContain('emerald')
    expect(appEnvDotClass('development')).toContain('sky')
    expect(appEnvDotClass(undefined)).toContain('slate')
  })
})
