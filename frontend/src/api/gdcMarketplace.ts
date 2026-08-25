import { requestJson, resolveApiBaseUrl, safeRequestJson } from '../api'
import { getAccessToken } from '../auth/session'
import { GDC_API_PREFIX } from './gdcApiPrefix'

const BASE = `${GDC_API_PREFIX}/connectors-registry`

export type MarketplaceStreamRef = {
  id: string
  name: string
}

export type MarketplaceStreamExtensionRef = {
  package_id: string
  name: string
  pack_version?: string | null
  installed: boolean
}

export type MarketplaceVerificationRead = {
  signature_status: string
  signing_key_id?: string | null
  digest?: string | null
  evidence_date?: string | null
}

export type MarketplaceLicenseRead = {
  declared?: string | null
  decision?: string | null
  decision_code?: string | null
  decision_reason?: string | null
}

export type MarketplaceProvenanceRead = {
  upstream_project?: string | null
  upstream_url?: string | null
  upstream_path?: string | null
  upstream_commit_or_version?: string | null
  modified_from_upstream?: boolean | null
  import_method?: string | null
}

export type MarketplaceCompatibilityRead = {
  warnings: string[]
  requires?: Array<{ package_id: string; version?: string | null }> | null
}

export type MarketplacePackageCard = {
  package_id: string
  name: string
  vendor: string
  product?: string | null
  description: string
  package_kind: string
  pack_version?: string | null
  api_version?: string | null
  origin?: string | null
  trust_tier: string
  validation_status: string
  verification: MarketplaceVerificationRead
  license: MarketplaceLicenseRead
  provenance: MarketplaceProvenanceRead
  compatibility: MarketplaceCompatibilityRead
  available_streams: MarketplaceStreamRef[]
  installed: boolean
  installed_version?: string | null
  update_available: boolean
  previous_version?: string | null
  stream_extensions: MarketplaceStreamExtensionRef[]
  requires?: Array<{ package_id: string; version?: string | null }> | null
}

export type MarketplaceCatalogResponse = {
  packages: MarketplacePackageCard[]
  count: number
}

export type MarketplaceCatalogFilters = {
  q?: string
  trust_tier?: string
  origin?: string
  installed?: boolean
  compatibility?: string
  package_kind?: string
}

export type MarketplaceCapabilitiesRead = {
  git_acquisition: boolean
  git_acquisition_reason: string
  remote_registry: boolean
  production_ai_provider_implemented: boolean
  deterministic_builder_providers: string[]
  auto_install: boolean
  auto_stream_create: boolean
  auto_stream_enable: boolean
  auto_credential_create: boolean
  trust_auto_promotion: boolean
  supported_upload_formats: string[]
}

export type MarketplaceValidateResultRead = {
  status: 'PASS' | 'FAIL' | 'WARNING'
  package_id?: string | null
  package_kind?: string | null
  pack_version?: string | null
  name?: string | null
  vendor?: string | null
  issues: string[]
  signature_status: string
  signing_key_id?: string | null
  digest?: string | null
  license_decision?: string | null
  license_decision_code?: string | null
  license_decision_reason?: string | null
  compatibility_warnings: string[]
  blocked_reasons: string[]
}

export type MarketplaceBuilderDraftRequest = {
  provider_name?: string
  vendor?: string
  product?: string
  desired_streams?: string[]
  harvested_knowledge?: Record<string, unknown> | null
  openapi?: Record<string, unknown> | null
  sample?: unknown
  documentation?: string
  script_reference?: string
  supplied_translation?: Record<string, unknown> | null
  trust_candidate?: 'Local Draft' | 'Imported Draft'
  output_dir?: string
}

export type MarketplaceBuilderDraftResponse = {
  status: 'READY_DRAFT' | 'NEEDS_REVIEW' | 'INCOMPLETE' | 'BLOCKED'
  package_generated: boolean
  package_path?: string | null
  validation_status: string
  validation_issues: Array<{ code: string; message: string; severity: string }>
  open_questions: Array<{ code: string; message: string; field?: string | null; severity: string }>
  conflicts: Array<Record<string, unknown>>
  confidence_summary: Record<string, unknown>
  evidence_summary: Record<string, unknown>
  license_decision?: string | null
  license_decision_code?: string | null
  license_decision_reason?: string | null
  trust_candidate: string
  validation_details: Record<string, unknown>
  provider_name?: string | null
}

export type MarketplacePackageInstallRead = {
  package_id: string
  package_kind: string
  pack_version: string
  origin: string
  status: string
  digest: string
  signature_status: string
  signing_key_id?: string | null
  installed_path: string
  previous_version?: string | null
  previous_digest?: string | null
  installed_at: string
  updated_at: string
}

export type MarketplaceInstalledPackagesResponse = {
  packages: MarketplacePackageInstallRead[]
  count: number
}

/** Structured API error carrying the backend error_code (when available). */
export class MarketplaceApiError extends Error {
  errorCode?: string
  details?: Record<string, unknown>

  constructor(message: string, opts?: { errorCode?: string; details?: Record<string, unknown> }) {
    super(message)
    this.name = 'MarketplaceApiError'
    this.errorCode = opts?.errorCode
    this.details = opts?.details
  }
}

function buildQuery(filters?: MarketplaceCatalogFilters): string {
  if (!filters) return ''
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.trust_tier) params.set('trust_tier', filters.trust_tier)
  if (filters.origin) params.set('origin', filters.origin)
  if (typeof filters.installed === 'boolean') params.set('installed', String(filters.installed))
  if (filters.compatibility) params.set('compatibility', filters.compatibility)
  if (filters.package_kind) params.set('package_kind', filters.package_kind)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export async function fetchMarketplaceCatalog(
  filters?: MarketplaceCatalogFilters,
): Promise<MarketplaceCatalogResponse> {
  const raw = await safeRequestJson<MarketplaceCatalogResponse>(`${BASE}/marketplace/catalog${buildQuery(filters)}`)
  if (!raw || !Array.isArray(raw.packages)) return { packages: [], count: 0 }
  return raw
}

export async function fetchMarketplacePackageDetail(packageId: string): Promise<MarketplacePackageCard | null> {
  return safeRequestJson<MarketplacePackageCard>(`${BASE}/marketplace/packages/${encodeURIComponent(packageId)}`)
}

export async function fetchMarketplaceCapabilities(): Promise<MarketplaceCapabilitiesRead | null> {
  return safeRequestJson<MarketplaceCapabilitiesRead>(`${BASE}/marketplace/capabilities`)
}

export async function fetchInstalledPackages(): Promise<MarketplaceInstalledPackagesResponse> {
  const raw = await safeRequestJson<MarketplaceInstalledPackagesResponse>(`${BASE}/packages`)
  if (!raw || !Array.isArray(raw.packages)) return { packages: [], count: 0 }
  return raw
}

function extractErrorMessage(body: unknown, status: number): { message: string; errorCode?: string; details?: Record<string, unknown> } {
  if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
    const o = body as Record<string, unknown>
    const detail = o.detail
    if (detail !== null && typeof detail === 'object' && !Array.isArray(detail)) {
      const d = detail as Record<string, unknown>
      const message = typeof d.message === 'string' ? d.message : `${status}: request failed`
      const errorCode = typeof d.error_code === 'string' ? d.error_code : undefined
      const details = typeof d.details === 'object' && d.details !== null ? (d.details as Record<string, unknown>) : undefined
      return { message: errorCode ? `${message} [${errorCode}]` : message, errorCode, details }
    }
    if (typeof detail === 'string') return { message: `${status}: ${detail}` }
  }
  return { message: `${status}: request failed` }
}

/**
 * Multipart upload helper. `requestJson` always forces `Content-Type:
 * application/json`, which breaks multipart boundaries — this issues a raw
 * `fetch` instead so the browser sets the boundary, while still attaching the
 * bearer token the same way `doFetch` does.
 */
async function uploadMultipart<T>(path: string, file: File, method: 'POST' = 'POST'): Promise<T> {
  const form = new FormData()
  form.append('file', file)
  const token = getAccessToken()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  const base = resolveApiBaseUrl()
  const res = await fetch(`${base}${path}`, { method, headers, body: form })
  const raw = await res.text()
  const body = raw.trim() ? (JSON.parse(raw) as unknown) : null
  if (!res.ok) {
    const { message, errorCode, details } = extractErrorMessage(body, res.status)
    throw new MarketplaceApiError(message, { errorCode, details })
  }
  return body as T
}

export async function validatePackageUpload(file: File): Promise<MarketplaceValidateResultRead> {
  return uploadMultipart<MarketplaceValidateResultRead>(`${BASE}/packages/validate`, file)
}

export async function installPackageUpload(file: File): Promise<MarketplacePackageInstallRead> {
  return uploadMultipart<MarketplacePackageInstallRead>(`${BASE}/packages/install`, file)
}

export async function upgradePackageUpload(packageId: string, file: File): Promise<MarketplacePackageInstallRead> {
  return uploadMultipart<MarketplacePackageInstallRead>(`${BASE}/packages/${encodeURIComponent(packageId)}/upgrade`, file)
}

export async function rollbackPackage(packageId: string): Promise<MarketplacePackageInstallRead> {
  try {
    return await requestJson<MarketplacePackageInstallRead>(`${BASE}/packages/${encodeURIComponent(packageId)}/rollback`, {
      method: 'POST',
    })
  } catch (e) {
    throw toMarketplaceError(e)
  }
}

export async function uninstallPackage(packageId: string): Promise<MarketplacePackageInstallRead> {
  try {
    return await requestJson<MarketplacePackageInstallRead>(`${BASE}/packages/${encodeURIComponent(packageId)}`, {
      method: 'DELETE',
    })
  } catch (e) {
    throw toMarketplaceError(e)
  }
}

function toMarketplaceError(e: unknown): MarketplaceApiError {
  if (e instanceof MarketplaceApiError) return e
  const message = e instanceof Error ? e.message : String(e)
  // `requestJson` formats errors as `${status}: [${error_code}] ${message}`.
  const match = /^\d+:\s*\[([A-Z0-9_]+)]/.exec(message)
  return new MarketplaceApiError(message, { errorCode: match ? match[1] : undefined })
}

export async function createBuilderDraft(payload: MarketplaceBuilderDraftRequest): Promise<MarketplaceBuilderDraftResponse> {
  try {
    return await requestJson<MarketplaceBuilderDraftResponse>(`${BASE}/marketplace/builder/draft`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  } catch (e) {
    throw toMarketplaceError(e)
  }
}
