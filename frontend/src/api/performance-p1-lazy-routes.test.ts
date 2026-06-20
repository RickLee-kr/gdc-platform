import { describe, expect, it } from 'vitest'
import {
  LazyDashboardOverview,
  LazyStreamRuntimeDetailPage,
} from '../routes/lazy-routes'

describe('performance P1 — lazy route exports', () => {
  it('exposes lazy StreamRuntimeDetailPage wrapper', () => {
    expect(typeof LazyStreamRuntimeDetailPage).toBe('function')
  })

  it('exposes lazy DashboardOverview wrapper', () => {
    expect(typeof LazyDashboardOverview).toBe('function')
  })
})
