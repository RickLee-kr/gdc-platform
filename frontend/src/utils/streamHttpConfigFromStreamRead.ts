import type { MappingUIConfigResponse, StreamRead } from '../api/types/gdcApi'

/**
 * Build `stream_config` for `POST /runtime/api-test/http` from persisted stream + mapping-ui rows.
 * Mirrors {@link StreamApiTestPage} load logic so Mapping and API Test stay aligned.
 */
export function buildStreamHttpConfigFromStreamRead(
  stream: StreamRead,
  cfg: MappingUIConfigResponse,
): Record<string, unknown> {
  const sc = cfg.source_config ?? {}
  const cfgj = (stream.config_json ?? {}) as Record<string, unknown>
  const ep = String(cfgj.endpoint ?? cfgj.endpoint_path ?? (sc as { endpoint_path?: string }).endpoint_path ?? '').trim()
  const m = String(cfgj.method ?? cfgj.http_method ?? (sc as { http_method?: string }).http_method ?? 'GET').toUpperCase()
  const method = m === 'POST' ? 'POST' : 'GET'
  const params = (cfgj.params ?? {}) as Record<string, unknown>
  const hdrRaw = cfgj.headers
  const headers: Record<string, unknown> = {}
  if (hdrRaw && typeof hdrRaw === 'object' && !Array.isArray(hdrRaw)) {
    Object.assign(headers, hdrRaw as Record<string, unknown>)
  }
  const body = cfgj.body ?? cfgj.request_body
  const ts = cfgj.timeout_seconds ?? cfgj.timeout_sec ?? (sc as { timeout_sec?: unknown }).timeout_sec
  const timeoutSeconds =
    typeof ts === 'number' && Number.isFinite(ts)
      ? ts
      : typeof ts === 'string' && ts.trim()
        ? Number.parseInt(ts.trim(), 10) || 30
        : 30

  const streamCfg: Record<string, unknown> = {
    method,
    endpoint: ep,
    timeout_seconds: timeoutSeconds,
    params,
  }
  if (Object.keys(headers).length) streamCfg.headers = headers
  if (body !== undefined) streamCfg.body = body
  return streamCfg
}

export function connectorBaseUrlFromMappingUi(
  stream: StreamRead,
  cfg: MappingUIConfigResponse,
): string {
  const sc = cfg.source_config ?? {}
  const cfgj = (stream.config_json ?? {}) as Record<string, unknown>
  const baseFromSource = String((sc as { base_url?: string }).base_url ?? '').trim()
  const baseFromStream = String(cfgj.base_url ?? '').trim()
  return baseFromStream || baseFromSource
}
