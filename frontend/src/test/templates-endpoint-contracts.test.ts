import { describe, expect, it } from 'vitest'
import { TEMPLATE_API_PATH_TEMPLATES } from './endpointContracts'

describe('template API path templates', () => {
  it('lists unique template endpoints', () => {
    expect(new Set(TEMPLATE_API_PATH_TEMPLATES).size).toBe(TEMPLATE_API_PATH_TEMPLATES.length)
    expect(TEMPLATE_API_PATH_TEMPLATES).toContain('/api/v1/templates/')
    expect(TEMPLATE_API_PATH_TEMPLATES).toContain('/api/v1/templates/{template_id}/instantiate')
  })
})
