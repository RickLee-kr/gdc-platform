import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readSession } from '../auth/session'
import { getAdminDevValidationStatus } from '../api/gdcAdmin'
import {
  clearOperationalSnapshotFixtureCache,
  disableRuntimeFixtureMode,
  enableRuntimeFixtureMode,
  hasRuntimeFixtureUserOptIn,
  isOperationalSnapshotShape,
  isRuntimeFixtureModeActive,
  isRuntimeFixturePolicyGranted,
  loadOperationalSnapshotFixture,
  resetRuntimeFixturePolicyCacheForTests,
  RUNTIME_FIXTURE_FILE_KEY,
  RUNTIME_FIXTURE_MODE_KEY,
  routeReadsFromOperationalSnapshot,
  syncRuntimeFixtureModeFromSearchParams,
} from './runtime-operational-fixture-mode'
import testFixture from '../../public/dev-fixtures/runtime-operational-snapshot-test.json'

vi.mock('../auth/session', () => ({
  readSession: vi.fn(),
}))

vi.mock('../api/gdcAdmin', () => ({
  getAdminDevValidationStatus: vi.fn(),
}))

function mockAdministrator(): void {
  vi.mocked(readSession).mockReturnValue({
    access_token: 't',
    refresh_token: 'r',
    expires_at: '2099-01-01T00:00:00Z',
    user: { username: 'admin', role: 'ADMINISTRATOR', status: 'ACTIVE' },
  })
}

function mockViewer(): void {
  vi.mocked(readSession).mockReturnValue({
    access_token: 't',
    refresh_token: 'r',
    expires_at: '2099-01-01T00:00:00Z',
    user: { username: 'viewer', role: 'VIEWER', status: 'ACTIVE' },
  })
}

describe('runtime-operational-fixture-mode', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('MODE', 'production')
    disableRuntimeFixtureMode()
    clearOperationalSnapshotFixtureCache()
    resetRuntimeFixturePolicyCacheForTests()
    localStorage.clear()
    mockAdministrator()
    vi.mocked(getAdminDevValidationStatus).mockResolvedValue({
      enable_dev_validation_lab: false,
      app_env: 'production',
      lab_available: false,
    } as never)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    disableRuntimeFixtureMode()
    resetRuntimeFixturePolicyCacheForTests()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('grants policy for administrator session in production builds', async () => {
    expect(await isRuntimeFixturePolicyGranted()).toBe(true)
  })

  it('grants policy when platform dev-validation is enabled', async () => {
    mockViewer()
    vi.mocked(getAdminDevValidationStatus).mockResolvedValue({
      enable_dev_validation_lab: true,
      app_env: 'staging',
      lab_available: true,
    } as never)
    expect(await isRuntimeFixturePolicyGranted()).toBe(true)
  })

  it('rejects fixture load for non-admin when dev-validation is off', async () => {
    mockViewer()
    enableRuntimeFixtureMode('runtime-operational-snapshot-test.json')
    const snap = await loadOperationalSnapshotFixture()
    expect(snap).toBeNull()
    expect(console.warn).toHaveBeenCalledWith('[runtime-fixture]', { rejected: true, reason: 'not-admin' })
  })

  it('requires explicit opt-in via localStorage or URL', () => {
    expect(hasRuntimeFixtureUserOptIn()).toBe(false)
    enableRuntimeFixtureMode('runtime-operational-snapshot-test.json')
    expect(hasRuntimeFixtureUserOptIn()).toBe(true)
    expect(localStorage.getItem(RUNTIME_FIXTURE_FILE_KEY)).toBe('runtime-operational-snapshot-test.json')
  })

  it('syncs from URL search params when policy is granted', async () => {
    await syncRuntimeFixtureModeFromSearchParams(
      new URLSearchParams('runtime_fixture=1&runtime_fixture_file=runtime-operational-snapshot-test.json'),
    )
    expect(localStorage.getItem(RUNTIME_FIXTURE_MODE_KEY)).toBe('1')
  })

  it('rejects URL sync when policy is not granted', async () => {
    mockViewer()
    await syncRuntimeFixtureModeFromSearchParams(new URLSearchParams('runtime_fixture=1'))
    expect(localStorage.getItem(RUNTIME_FIXTURE_MODE_KEY)).toBeNull()
  })

  it('loads fixture JSON via fetch without backend API when active', async () => {
    enableRuntimeFixtureMode('runtime-operational-snapshot-test.json')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(testFixture), { status: 200 }),
    )

    const snap = await loadOperationalSnapshotFixture()
    expect(snap?.streams).toHaveLength(5)
    expect(snap?.routes).toHaveLength(10)
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/dev-fixtures/runtime-operational-snapshot-test.json'))
    expect(console.info).toHaveBeenCalledWith(
      '[runtime-fixture]',
      expect.objectContaining({ enabled: true, file: 'runtime-operational-snapshot-test.json', streams: 5, routes: 10 }),
    )
    expect(await isRuntimeFixtureModeActive()).toBe(true)
    fetchSpy.mockRestore()
  })

  it('validates operational snapshot contract shape', () => {
    expect(isOperationalSnapshotShape(testFixture)).toBe(true)
    expect(isOperationalSnapshotShape({ streams: [] })).toBe(false)
  })

  it('derives route list rows from snapshot routes', () => {
    const rows = routeReadsFromOperationalSnapshot(testFixture as never)
    expect(rows).toHaveLength(10)
    expect(rows[0]?.id).toBe(1)
  })
})
