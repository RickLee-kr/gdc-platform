import { useCallback, useEffect, useState } from 'react'
import { fetchConnectorsList, type ConnectorRead } from '../api/gdcConnectors'
import { fetchStreamMappingUiConfig } from '../api/gdcRuntime'
import { fetchStreamsList } from '../api/gdcStreams'
import type { StreamRead } from '../api/types/gdcApi'
import { formatStreamLabel } from '../utils/entityLabels'

export type MappingOverviewRow = {
  id: string
  name: string
  streamId: string
  streamLabel: string
  connectorName: string
  description: string
  fieldCount: number
  enableStatus: 'ENABLED' | 'DISABLED'
  mappingType: 'MANUAL' | 'AUTOMATIC'
  hasMapping: boolean
  sourceType: string
}

export type MappingsOverviewKpi = {
  total: number
  enabled: number
  withMapping: number
  avgFields: number
}

export type MappingsOverviewData = {
  rows: MappingOverviewRow[]
  kpi: MappingsOverviewKpi
  connectorNames: string[]
  streamLabels: string[]
  apiBacked: boolean
  loading: boolean
  error: string | null
  reload: () => void
}

function connectorNameForStream(stream: StreamRead, connectors: ConnectorRead[]): string {
  const cid = stream.connector_id
  if (cid == null) return '—'
  const hit = connectors.find((c) => c.id === cid)
  return (hit?.name ?? '').trim() || `Connector ${cid}`
}

async function loadMappingRowsPlaceholder(
  streams: StreamRead[],
  connectors: ConnectorRead[],
): Promise<MappingOverviewRow[]> {
  return streams.map((stream) => {
    const sid = String(stream.id)
    const streamLabel = formatStreamLabel(sid, stream.name)
    const enabled = stream.enabled !== false
    return {
      id: sid,
      name: `${streamLabel} (loading…)`,
      streamId: sid,
      streamLabel,
      connectorName: connectorNameForStream(stream, connectors),
      description: 'Loading mapping configuration…',
      fieldCount: 0,
      enableStatus: enabled ? ('ENABLED' as const) : ('DISABLED' as const),
      mappingType: 'MANUAL' as const,
      hasMapping: false,
      sourceType: String(stream.stream_type ?? '').trim() || '—',
    }
  })
}

async function enrichMappingRows(
  rows: MappingOverviewRow[],
  streams: StreamRead[],
): Promise<MappingOverviewRow[]> {
  const streamById = new Map(streams.map((s) => [String(s.id), s]))
  const limit = 4
  const out = [...rows]
  for (let i = 0; i < out.length; i += limit) {
    const chunk = out.slice(i, i + limit)
    await Promise.all(
      chunk.map(async (row, idx) => {
        const streamId = Number(row.streamId)
        const stream = streamById.get(row.streamId)
        if (!Number.isFinite(streamId) || stream == null) return
        try {
          const cfg = await fetchStreamMappingUiConfig(streamId)
          let fieldCount = 0
          let hasMapping = false
          if (cfg?.mapping?.exists) {
            hasMapping = true
            fieldCount = Object.keys(cfg.mapping.field_mappings ?? {}).length
          }
          const streamLabel = formatStreamLabel(row.streamId, stream.name)
          out[i + idx] = {
            ...row,
            name: hasMapping ? `${streamLabel} mapping` : `${streamLabel} (no mapping)`,
            description: hasMapping
              ? `${fieldCount} field mapping${fieldCount === 1 ? '' : 's'} · ${stream.stream_type ?? 'stream'}`
              : 'No persisted mapping — open stream mapping to configure',
            fieldCount,
            hasMapping,
            mappingType: fieldCount > 0 ? 'MANUAL' : 'AUTOMATIC',
          }
        } catch {
          /* keep placeholder row */
        }
      }),
    )
  }
  return out
}

function buildKpi(rows: MappingOverviewRow[]): MappingsOverviewKpi {
  const total = rows.length
  const enabled = rows.filter((r) => r.enableStatus === 'ENABLED').length
  const withMapping = rows.filter((r) => r.hasMapping).length
  const fieldSum = rows.reduce((acc, r) => acc + r.fieldCount, 0)
  const avgFields = total > 0 ? Math.round((fieldSum / total) * 10) / 10 : 0
  return { total, enabled, withMapping, avgFields }
}

export function useMappingsOverviewData(): MappingsOverviewData {
  const [rows, setRows] = useState<MappingOverviewRow[]>([])
  const [kpi, setKpi] = useState<MappingsOverviewKpi>({ total: 0, enabled: 0, withMapping: 0, avgFields: 0 })
  const [connectorNames, setConnectorNames] = useState<string[]>([])
  const [streamLabels, setStreamLabels] = useState<string[]>([])
  const [apiBacked, setApiBacked] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [streams, connectors] = await Promise.all([fetchStreamsList(), fetchConnectorsList()])
      if (!streams?.length) {
        setApiBacked(streams !== null)
        setRows([])
        setKpi({ total: 0, enabled: 0, withMapping: 0, avgFields: 0 })
        setConnectorNames([])
        setStreamLabels([])
        setLoading(false)
        return
      }
      const placeholderRows = await loadMappingRowsPlaceholder(streams, connectors ?? [])
      setApiBacked(true)
      setRows(placeholderRows)
      setKpi(buildKpi(placeholderRows))
      setConnectorNames(
        [...new Set(placeholderRows.map((r) => r.connectorName).filter((n) => n && n !== '—'))].sort((a, b) =>
          a.localeCompare(b),
        ),
      )
      setStreamLabels([...new Set(placeholderRows.map((r) => r.streamLabel))].sort((a, b) => a.localeCompare(b)))
      setLoading(false)

      const nextRows = await enrichMappingRows(placeholderRows, streams)
      setRows(nextRows)
      setKpi(buildKpi(nextRows))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setRows([])
      setKpi({ total: 0, enabled: 0, withMapping: 0, avgFields: 0 })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return { rows, kpi, connectorNames, streamLabels, apiBacked, loading, error, reload: load }
}
