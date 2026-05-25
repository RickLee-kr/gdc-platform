import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as rawApi from '../api'
import { readSession } from '../auth/session'
import {
  disableRuntimeFixtureMode,
  enableRuntimeFixtureMode,
  resetRuntimeFixturePolicyCacheForTests,
} from '../lib/runtime-operational-fixture-mode'
import testFixture from '../../public/dev-fixtures/runtime-operational-snapshot-test.json'
import { fetchRoutesList } from './gdcRoutes'

vi.mock('../auth/session', () => ({
  readSession: vi.fn(),
}))

vi.mock('../api/gdcAdmin', () => ({
  getAdminDevValidationStatus: vi.fn(),
}))

describe('fetchRoutesList fixture mode', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('MODE', 'production')
    disableRuntimeFixtureMode()
    resetRuntimeFixturePolicyCacheForTests()
    vi.restoreAllMocks()
    vi.mocked(readSession).mockReturnValue({
      access_token: 't',
      refresh_token: 'r',
      expires_at: '2099-01-01T00:00:00Z',
      user: { username: 'admin', role: 'ADMINISTRATOR', status: 'ACTIVE' },
    })
  })

  afterEach(() => {
    disableRuntimeFixtureMode()
    resetRuntimeFixturePolicyCacheForTests()
    vi.unstubAllEnvs()
  })

  it('returns route rows from fixture without calling /routes API in production builds', async () => {
    enableRuntimeFixtureMode('runtime-operational-snapshot-test.json')
    const apiSpy = vi.spyOn(rawApi, 'safeRequestJson')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(testFixture), { status: 200 }),
    )

    const routes = await fetchRoutesList()
    expect(routes).toHaveLength(10)
    expect(apiSpy).not.toHaveBeenCalled()
  })
})
