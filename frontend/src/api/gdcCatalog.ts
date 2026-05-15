import { fetchConnectorsList } from './gdcConnectors'
import { fetchSourcesList } from './gdcSources'

/**
 * Connector / Source catalog discovery for the new-stream wizard.
 *
 * Backend constraints:
 *   - `GET /api/v1/connectors/` and `GET /api/v1/sources/` are still placeholders
 *     (see `app/connectors/router.py`, `app/sources/router.py`) — they return
 *     `{ "message": ... }` instead of a list. We must not invent new endpoints.
 *   - Real metadata is reachable per-id via:
 *       `GET /api/v1/runtime/connectors/{id}/ui/config`
 *       `GET /api/v1/runtime/sources/{id}/ui/config`
 *   - Existing `Stream` rows from `GET /api/v1/streams/` carry `connector_id`
 *     and `source_id`, so we use them as a discovery seed.
 *
 * Strategy:
 *   1. Pull existing streams (already DB-backed).
 *   2. Collect unique `connector_id`s referenced by those streams.
 *   3. Fetch connector + source detail per id in parallel.
 *   4. If none of the above yields results → callers fall back to demo data.
 */

export type CatalogConnector = {
  id: number
  name: string
  description: string | null
  status: string
  source_count: number
  stream_count: number
}

export type CatalogSource = {
  id: number
  connector_id: number
  source_type: string
  enabled: boolean
  display_name: string
  /** Stream rows already attached to this source (preview only). */
  stream_count: number
}

export type CatalogSnapshot = {
  connectors: CatalogConnector[]
  sources: CatalogSource[]
  /** True when at least one connector/source was loaded via real API. */
  apiBacked: boolean
}

/**
 * Best-effort connector + source catalog. Returns empty arrays + apiBacked=false
 * when no real backend rows are reachable; callers are expected to render the
 * mock catalog from `new-stream-wizard-mock-data.ts` in that case.
 */
export async function fetchCatalogSnapshot(): Promise<CatalogSnapshot> {
  const [connectorsRaw, sourcesRaw] = await Promise.all([fetchConnectorsList(), fetchSourcesList()])
  if (!connectorsRaw?.length || !sourcesRaw?.length) {
    return { connectors: [], sources: [], apiBacked: false }
  }
  const sourceCountByConnector = new Map<number, number>()
  for (const source of sourcesRaw) {
    const cid = Number(source.connector_id ?? 0)
    sourceCountByConnector.set(cid, (sourceCountByConnector.get(cid) ?? 0) + 1)
  }
  const connectors: CatalogConnector[] = connectorsRaw.map((c) => ({
    id: c.id,
    name: c.name ?? `Connector #${c.id}`,
    description: c.description ?? null,
    status: c.status ?? 'STOPPED',
    source_count: sourceCountByConnector.get(c.id) ?? 0,
    stream_count: 0,
  }))
  const sources: CatalogSource[] = sourcesRaw.map((s) => {
    const owner = connectors.find((c) => c.id === s.connector_id)
    return {
      id: s.id,
      connector_id: Number(s.connector_id ?? 0),
      source_type: s.source_type ?? 'HTTP_API_POLLING',
      enabled: Boolean(s.enabled),
      display_name: owner ? `${owner.name} · ${s.source_type ?? 'HTTP_API_POLLING'}` : `Source #${s.id}`,
      stream_count: 0,
    }
  })

  return {
    connectors,
    sources,
    apiBacked: connectors.length > 0 && sources.length > 0,
  }
}
