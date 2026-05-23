import type { CurlImportDraft } from '../api/gdcBackup'
import type { TemplateDraftImportSource, TemplateDraftRequestStructure } from '../api/gdcTemplateDrafts'

export function requestStructureFromImportDraft(draft: CurlImportDraft): TemplateDraftRequestStructure {
  const parsed = draft.parsed ?? {}
  const streamCfg = (draft.stream?.config_json ?? {}) as Record<string, unknown>
  return {
    method: String(parsed.method ?? streamCfg.method ?? 'GET'),
    base_url: String(parsed.base_url ?? draft.connector?.base_url ?? '') || null,
    endpoint: String(parsed.endpoint ?? streamCfg.endpoint ?? '/') || null,
    query_params: (parsed.query_params ?? streamCfg.params ?? {}) as Record<string, string>,
    headers_masked: (parsed.headers_masked ?? {}) as Record<string, string>,
    body: streamCfg.body ?? null,
    body_mode: (parsed as { body_mode?: string }).body_mode ?? null,
  }
}

export function importSourceFromDraftKind(draft: CurlImportDraft): TemplateDraftImportSource {
  return draft.draft_kind === 'postman_http' ? 'POSTMAN' : 'CURL'
}

export function defaultDraftDisplayName(draft: CurlImportDraft): string {
  const name = String(draft.connector?.name ?? '').trim()
  if (name) return name
  const endpoint = String(draft.parsed?.endpoint ?? '').trim()
  return endpoint ? `Draft ${endpoint}` : 'Imported HTTP draft'
}

export function requestStructureFromApiTest(opts: {
  method: string
  baseUrl: string
  endpoint: string
  queryParams?: Record<string, string>
  headersMasked?: Record<string, string>
  body?: unknown
}): TemplateDraftRequestStructure {
  return {
    method: opts.method.toUpperCase(),
    base_url: opts.baseUrl || null,
    endpoint: opts.endpoint || '/',
    query_params: opts.queryParams ?? {},
    headers_masked: opts.headersMasked ?? {},
    body: opts.body ?? null,
  }
}
