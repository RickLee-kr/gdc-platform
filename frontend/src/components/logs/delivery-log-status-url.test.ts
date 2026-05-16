import { describe, expect, it } from 'vitest'
import {
  resolveDeliveryLogApiFilters,
  statusUiLabelFromSearchParams,
  statusUrlParamFromUiLabel,
} from './delivery-log-status-url'

describe('resolveDeliveryLogApiFilters', () => {
  it('maps failed/success aliases to API status tokens', () => {
    expect(resolveDeliveryLogApiFilters(new URLSearchParams('status=failed')).status).toBe('FAILED')
    expect(resolveDeliveryLogApiFilters(new URLSearchParams('status=success')).status).toBe('OK')
  })

  it('maps retry to default retry failure stage when stage omitted', () => {
    const r = resolveDeliveryLogApiFilters(new URLSearchParams('status=retry'))
    expect(r.status).toBeUndefined()
    expect(r.stage).toBe('route_retry_failed')
  })

  it('preserves explicit stage when status=retry', () => {
    const r = resolveDeliveryLogApiFilters(new URLSearchParams('status=retry&stage=route_retry_success'))
    expect(r.stage).toBe('route_retry_success')
  })

  it('combines explicit stage with failed status', () => {
    const r = resolveDeliveryLogApiFilters(new URLSearchParams('status=failed&stage=route_send_failed'))
    expect(r.status).toBe('FAILED')
    expect(r.stage).toBe('route_send_failed')
  })
})

describe('status UI helpers', () => {
  it('reflects URL status in dropdown label', () => {
    expect(statusUiLabelFromSearchParams(new URLSearchParams('status=failed'))).toBe('Failed')
    expect(statusUiLabelFromSearchParams(new URLSearchParams('status=retry'))).toBe('Retry outcomes')
  })

  it('maps dropdown labels to URL params', () => {
    expect(statusUrlParamFromUiLabel('Failed')).toBe('failed')
    expect(statusUrlParamFromUiLabel('Retry outcomes')).toBe('retry')
    expect(statusUrlParamFromUiLabel('All status')).toBeUndefined()
  })
})
