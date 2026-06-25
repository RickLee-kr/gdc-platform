import { getAdminDevValidationStatus } from '../api/gdcAdmin'
import type { OperationalSnapshotResponse } from '../api/operationalSnapshot'
import type { RouteRead } from '../api/gdcRoutes'
import { readSession } from '../auth/session'
import { isDevValidationLabUiEnabled, isOssReleaseMode } from './feature-flags'

export const RUNTIME_FIXTURE_MODE_KEY = 'GDC_RUNTIME_FIXTURE_MODE'
export const RUNTIME_FIXTURE_FILE_KEY = 'GDC_RUNTIME_FIXTURE_FILE'
export const RUNTIME_FIXTURE_URL_PARAM = 'runtime_fixture'
export const RUNTIME_FIXTURE_FILE_URL_PARAM = 'runtime_fixture_file'
export const DEFAULT_RUNTIME_FIXTURE_FILE = 'runtime-operational-snapshot-320x120.json'

const FIXTURE_BASE = `${import.meta.env.BASE_URL}dev-fixtures/`

export type RuntimeFixtureRejectionReason = 'not-admin' | 'disabled' | 'no-opt-in' | 'missing-file' | 'invalid-fixture'

export type RuntimeFixtureSummary = {
  fileName: string
  streamCount: number
  routeCount: number
  destinationCount: number
}

let cachedFixture: OperationalSnapshotResponse | null = null
let cachedFixtureFile: string | null = null
let platformDevValidationEnabled: boolean | null = null
let platformDevValidationPromise: Promise<boolean> | null = null
let lastActivationLogKey: string | null = null

function readLocalStorage(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    /* ignore */
  }
}

function removeLocalStorage(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key)
  } catch {
    /* ignore */
  }
}

function currentSearchParams(): URLSearchParams | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search)
}

export function isRuntimeFixtureAdministrator(): boolean {
  return readSession()?.user.role === 'ADMINISTRATOR'
}

export async function isPlatformDevValidationEnabled(): Promise<boolean> {
  if (isDevValidationLabUiEnabled()) return true
  if (platformDevValidationEnabled != null) return platformDevValidationEnabled
  if (platformDevValidationPromise != null) return platformDevValidationPromise
  platformDevValidationPromise = (async () => {
    try {
      const status = await getAdminDevValidationStatus()
      platformDevValidationEnabled = status.enable_dev_validation_lab === true
    } catch {
      platformDevValidationEnabled = false
    } finally {
      platformDevValidationPromise = null
    }
    return platformDevValidationEnabled
  })()
  return platformDevValidationPromise
}

/** ADMINISTRATOR session or platform dev-validation lab enabled on the server. Never in OSS production builds. */
export async function isRuntimeFixturePolicyGranted(): Promise<boolean> {
  if (isOssReleaseMode()) return false
  if (isRuntimeFixtureAdministrator()) return true
  return isPlatformDevValidationEnabled()
}

/** Operator opt-in plus policy — use before serving fixture JSON in API adapters. */
export async function canUseOperationalFixture(): Promise<boolean> {
  return hasRuntimeFixtureUserOptIn() && (await isRuntimeFixturePolicyGranted())
}

/** Explicit operator opt-in via localStorage or current URL. */
export function hasRuntimeFixtureUserOptIn(): boolean {
  if (readLocalStorage(RUNTIME_FIXTURE_MODE_KEY) === '1') return true
  const params = currentSearchParams()
  return params?.get(RUNTIME_FIXTURE_URL_PARAM) === '1'
}

export function getRuntimeFixtureFileName(): string {
  const params = currentSearchParams()
  const fromUrl = params?.get(RUNTIME_FIXTURE_FILE_URL_PARAM)?.trim()
  if (fromUrl) return fromUrl
  return readLocalStorage(RUNTIME_FIXTURE_FILE_KEY) ?? DEFAULT_RUNTIME_FIXTURE_FILE
}

export function logRuntimeFixtureRejected(reason: RuntimeFixtureRejectionReason): void {
  console.warn('[runtime-fixture]', { rejected: true, reason })
}

export function logRuntimeFixtureActivated(file: string, snapshot: OperationalSnapshotResponse): void {
  const key = `${file}:${snapshot.updated_at}`
  if (lastActivationLogKey === key) return
  lastActivationLogKey = key
  console.info('[runtime-fixture]', {
    enabled: true,
    file,
    streams: snapshot.streams.length,
    routes: snapshot.routes.length,
  })
}

export function enableRuntimeFixtureMode(fileName = DEFAULT_RUNTIME_FIXTURE_FILE): void {
  writeLocalStorage(RUNTIME_FIXTURE_MODE_KEY, '1')
  writeLocalStorage(RUNTIME_FIXTURE_FILE_KEY, fileName)
  clearOperationalSnapshotFixtureCache()
}

export function disableRuntimeFixtureMode(): void {
  removeLocalStorage(RUNTIME_FIXTURE_MODE_KEY)
  removeLocalStorage(RUNTIME_FIXTURE_FILE_KEY)
  clearOperationalSnapshotFixtureCache()
  lastActivationLogKey = null
}

/** Persist URL opt-in when policy allows (call after auth/session is ready). */
export async function syncRuntimeFixtureModeFromSearchParams(params: URLSearchParams): Promise<void> {
  if (params.get(RUNTIME_FIXTURE_URL_PARAM) !== '1') return
  if (!(await isRuntimeFixturePolicyGranted())) {
    logRuntimeFixtureRejected('not-admin')
    return
  }
  enableRuntimeFixtureMode(params.get(RUNTIME_FIXTURE_FILE_URL_PARAM) ?? DEFAULT_RUNTIME_FIXTURE_FILE)
}

export function clearOperationalSnapshotFixtureCache(): void {
  cachedFixture = null
  cachedFixtureFile = null
}

export function resetRuntimeFixturePolicyCacheForTests(): void {
  platformDevValidationEnabled = null
  platformDevValidationPromise = null
  lastActivationLogKey = null
}

/** @deprecated Use {@link hasRuntimeFixtureUserOptIn} + {@link isRuntimeFixtureModeActive}. */
export function isRuntimeFixtureModeEnabled(): boolean {
  return hasRuntimeFixtureUserOptIn()
}

export async function isRuntimeFixtureModeActive(): Promise<boolean> {
  if (!hasRuntimeFixtureUserOptIn()) return false
  if (!(await isRuntimeFixturePolicyGranted())) {
    logRuntimeFixtureRejected('not-admin')
    return false
  }
  const snap = await loadOperationalSnapshotFixture()
  return snap != null
}

export function isOperationalSnapshotShape(value: unknown): value is OperationalSnapshotResponse {
  if (value == null || typeof value !== 'object') return false
  const v = value as OperationalSnapshotResponse
  return (
    v.global != null &&
    typeof v.global === 'object' &&
    Array.isArray(v.streams) &&
    Array.isArray(v.routes) &&
    Array.isArray(v.destinations) &&
    Array.isArray(v.problems) &&
    typeof v.updated_at === 'string'
  )
}

export function routeReadsFromOperationalSnapshot(snapshot: OperationalSnapshotResponse): RouteRead[] {
  return (snapshot.routes ?? []).map((r) => ({
    id: r.route_id,
    stream_id: r.stream_id,
    destination_id: r.destination_id,
    enabled: r.enabled,
    failure_policy: r.failure_policy,
    formatter_config_json: {},
    rate_limit_json: { enabled: false },
    status: r.enabled ? 'ENABLED' : 'DISABLED',
  }))
}

export function summarizeRuntimeFixture(snapshot: OperationalSnapshotResponse, fileName: string): RuntimeFixtureSummary {
  return {
    fileName,
    streamCount: snapshot.streams.length,
    routeCount: snapshot.routes.length,
    destinationCount: snapshot.destinations.length,
  }
}

export async function loadOperationalSnapshotFixture(): Promise<OperationalSnapshotResponse | null> {
  if (!hasRuntimeFixtureUserOptIn()) {
    return null
  }
  if (!(await isRuntimeFixturePolicyGranted())) {
    logRuntimeFixtureRejected('not-admin')
    return null
  }

  const fileName = getRuntimeFixtureFileName()
  if (!fileName.trim()) {
    logRuntimeFixtureRejected('missing-file')
    return null
  }

  if (cachedFixture != null && cachedFixtureFile === fileName) {
    return cachedFixture
  }

  const url = `${FIXTURE_BASE}${encodeURIComponent(fileName)}`
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    logRuntimeFixtureRejected('missing-file')
    return null
  }
  if (!res.ok) {
    logRuntimeFixtureRejected('missing-file')
    return null
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    logRuntimeFixtureRejected('invalid-fixture')
    return null
  }
  if (!isOperationalSnapshotShape(body)) {
    logRuntimeFixtureRejected('invalid-fixture')
    return null
  }

  cachedFixture = body
  cachedFixtureFile = fileName
  logRuntimeFixtureActivated(fileName, body)
  return body
}
