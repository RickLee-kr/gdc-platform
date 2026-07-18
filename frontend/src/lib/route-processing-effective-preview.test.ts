import { describe, expect, it } from 'vitest'
import { buildRouteProcessingEffectivePreview } from './route-processing-effective-preview'

describe('route-processing-effective-preview', () => {
  it('summarizes inherit vs override for each concern', () => {
    const rows = buildRouteProcessingEffectivePreview({
      transform: 'Inherited',
      protection: 'Overridden',
      classification: 'Mixed',
      policy: null,
    })
    expect(rows).toHaveLength(4)
    expect(rows[0]).toMatchObject({ concern: 'transform', status: 'Inherited' })
    expect(rows[1]).toMatchObject({ concern: 'protection', status: 'Overridden' })
    expect(rows[2]?.status).toBe('Mixed')
    expect(rows[3]?.status).toBe('Unknown')
  })
})
