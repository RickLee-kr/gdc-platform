/** API helpers for Marketplace remote/private registries (M29.9). */

import { requestJson, resolveApiBaseUrl, safeRequestJson } from '../api'
import { getAccessToken } from '../auth/session'
import { GDC_API_PREFIX } from './gdcApiPrefix'
import { MarketplaceApiError, type MarketplacePackageInstallRead } from './gdcMarketplace'

const BASE = `${GDC_API_PREFIX}/connectors-registry`

export type MarketplaceRegistryRead = {
  id: string
  name: string
  registry_type: 'private' | 'remote_public' | string
  base_url: string
  enabled: boolean
  enabled_for_browse: boolean
  enabled_for_install: boolean
  authentication_reference?: string | null
  has_auth_secret: boolean
  trusted_key_policy?: Record<string, unknown> | null
  network_policy?: {
    allowed_hosts?: string[]
    allow_http?: boolean
    allow_private_networks?: boolean
    timeout_seconds?: number
    max_download_bytes?: number
    max_response_bytes?: number
  } | null
  created_at: string
  updated_at: string
}

export type MarketplaceRegistryListResponse = {
  registries: MarketplaceRegistryRead[]
  count: number
  remote_public_default_enabled: boolean
}

export type MarketplaceRegistryCreate = {
  name: string
  registry_type: 'private' | 'remote_public'
  base_url: string
  enabled?: boolean
  enabled_for_browse?: boolean
  enabled_for_install?: boolean
  authentication_reference?: string | null
  bearer_token?: string | null
  network_policy?: Record<string, unknown> | null
  trusted_key_policy?: Record<string, unknown> | null
}

export type MarketplaceRegistryUpdate = Partial<MarketplaceRegistryCreate> & {
  clear_auth_secret?: boolean
}

export type RegistryPackageSummary = {
  package_id: string
  name?: string | null
  vendor?: string | null
  pack_version?: string | null
  description?: string | null
  package_kind?: string | null
  versions: string[]
  declared_trust_tier?: string | null
  registry_id?: string | null
  registry_name?: string | null
  registry_type?: string | null
  origin?: string | null
}

export type RegistryCatalogResponse = {
  packages: RegistryPackageSummary[]
  count: number
  registry_id?: string | null
  unavailable: boolean
  unavailable_reason?: string | null
  error_code?: string | null
}

export type MarketplaceRegistryConnectionTestResult = {
  status: 'PASS' | 'FAIL' | string
  registry_id: string
  message: string
  latency_ms?: number | null
  error_code?: string | null
  details?: Record<string, unknown>
}

function toRegistryError(e: unknown): MarketplaceApiError {
  if (e instanceof MarketplaceApiError) return e
  const message = e instanceof Error ? e.message : String(e)
  const match = /^\d+:\s*\[([A-Z0-9_]+)]/.exec(message)
  return new MarketplaceApiError(message, { errorCode: match ? match[1] : undefined })
}

export async function fetchRegistries(): Promise<MarketplaceRegistryListResponse> {
  const raw = await safeRequestJson<MarketplaceRegistryListResponse>(`${BASE}/registries`)
  if (!raw || !Array.isArray(raw.registries)) {
    return { registries: [], count: 0, remote_public_default_enabled: false }
  }
  return raw
}

export async function createRegistry(payload: MarketplaceRegistryCreate): Promise<MarketplaceRegistryRead> {
  try {
    return await requestJson<MarketplaceRegistryRead>(`${BASE}/registries`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  } catch (e) {
    throw toRegistryError(e)
  }
}

export async function updateRegistry(
  registryId: string,
  payload: MarketplaceRegistryUpdate,
): Promise<MarketplaceRegistryRead> {
  try {
    return await requestJson<MarketplaceRegistryRead>(`${BASE}/registries/${encodeURIComponent(registryId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
  } catch (e) {
    throw toRegistryError(e)
  }
}

export async function disableRegistry(registryId: string): Promise<MarketplaceRegistryRead> {
  try {
    return await requestJson<MarketplaceRegistryRead>(
      `${BASE}/registries/${encodeURIComponent(registryId)}/disable`,
      { method: 'POST' },
    )
  } catch (e) {
    throw toRegistryError(e)
  }
}

export async function deleteRegistry(registryId: string): Promise<MarketplaceRegistryRead> {
  try {
    return await requestJson<MarketplaceRegistryRead>(`${BASE}/registries/${encodeURIComponent(registryId)}`, {
      method: 'DELETE',
    })
  } catch (e) {
    throw toRegistryError(e)
  }
}

export async function testRegistryConnection(
  registryId: string,
): Promise<MarketplaceRegistryConnectionTestResult> {
  try {
    return await requestJson<MarketplaceRegistryConnectionTestResult>(
      `${BASE}/registries/${encodeURIComponent(registryId)}/test-connection`,
      { method: 'POST' },
    )
  } catch (e) {
    throw toRegistryError(e)
  }
}

export async function fetchRegistryPackages(
  registryId: string,
  q?: string,
): Promise<RegistryCatalogResponse> {
  const qs = q ? `?q=${encodeURIComponent(q)}` : ''
  const raw = await safeRequestJson<RegistryCatalogResponse>(
    `${BASE}/registries/${encodeURIComponent(registryId)}/packages${qs}`,
  )
  if (!raw || !Array.isArray(raw.packages)) {
    return {
      packages: [],
      count: 0,
      unavailable: true,
      unavailable_reason: 'Registry unavailable',
      error_code: 'REGISTRY_UNAVAILABLE',
    }
  }
  return raw
}

export async function fetchAllRegistryPackages(q?: string): Promise<RegistryCatalogResponse> {
  const qs = q ? `?q=${encodeURIComponent(q)}` : ''
  const raw = await safeRequestJson<RegistryCatalogResponse>(`${BASE}/registries/packages${qs}`)
  if (!raw || !Array.isArray(raw.packages)) {
    return { packages: [], count: 0, unavailable: false }
  }
  return raw
}

export async function installFromRegistry(
  registryId: string,
  packageId: string,
  packVersion?: string,
): Promise<MarketplacePackageInstallRead> {
  try {
    return await requestJson<MarketplacePackageInstallRead>(
      `${BASE}/registries/${encodeURIComponent(registryId)}/packages/install`,
      {
        method: 'POST',
        body: JSON.stringify({ package_id: packageId, pack_version: packVersion ?? null }),
      },
    )
  } catch (e) {
    throw toRegistryError(e)
  }
}

async function uploadMultipart<T>(path: string, file: File): Promise<T> {
  const form = new FormData()
  form.append('file', file)
  const token = getAccessToken()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  const base = resolveApiBaseUrl()
  const res = await fetch(`${base}${path}`, { method: 'POST', headers, body: form })
  const raw = await res.text()
  const body = raw.trim() ? (JSON.parse(raw) as unknown) : null
  if (!res.ok) {
    const detail =
      body !== null && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>).detail
        : undefined
    const d =
      detail !== null && typeof detail === 'object' && !Array.isArray(detail)
        ? (detail as Record<string, unknown>)
        : undefined
    const message = typeof d?.message === 'string' ? d.message : `${res.status}: request failed`
    const errorCode = typeof d?.error_code === 'string' ? d.error_code : undefined
    throw new MarketplaceApiError(errorCode ? `${message} [${errorCode}]` : message, { errorCode })
  }
  return body as T
}

export async function installOfflineSignedBundle(file: File): Promise<MarketplacePackageInstallRead> {
  return uploadMultipart<MarketplacePackageInstallRead>(`${BASE}/packages/install-offline-bundle`, file)
}

export async function installFromGitUrl(url: string): Promise<MarketplacePackageInstallRead> {
  try {
    return await requestJson<MarketplacePackageInstallRead>(`${BASE}/marketplace/git/install`, {
      method: 'POST',
      body: JSON.stringify({ url }),
    })
  } catch (e) {
    throw toRegistryError(e)
  }
}
