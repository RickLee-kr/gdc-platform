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

async function loadMappingRows(
  streams: StreamRead[],
  connectors: ConnectorRead[],
): Promise<MappingOverviewRow[]> {
  const rows = await Promise.all(
    streams.map(async (stream) => {
      const sid = String(stream.id)
      const streamLabel = formatStreamLabel(sid, stream.name)
      let fieldCount = 0
      let hasMapping = false
      if (typeof stream.id === 'number') {
        const cfg = await fetchStreamMappingUiConfig(stream.id)
        if (cfg?.mapping?.exists) {
          hasMapping = true
          fieldCount = Object.keys(cfg.mapping.field_mappings ?? {}).length
        }
      }
      const enabled = stream.enabled !== false
      return {
        id: sid,
        name: hasMapping ? `${streamLabel} mapping` : `${streamLabel} (no mapping)`,
        streamId: sid,
        streamLabel,
        connectorName: connectorNameForStream(stream, connectors),
        description: hasMapping
          ? `${fieldCount} field mapping${fieldCount === 1 ? '' : 's'} · ${stream.stream_type ?? 'stream'}`
          : 'No persisted mapping — open stream mapping to configure',
        fieldCount,
        enableStatus: enabled ? ('ENABLED' as const) : ('DISABLED' as const),
        mappingType: fieldCount > 0 ? ('MANUAL' as const) : ('AUTOMATIC' as const),
        hasMapping,
        sourceType: String(stream.stream_type ?? '').trim() || '—',
      }
    }),
  )
  return rows
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
      const nextRows = await loadMappingRows(streams, connectors ?? [])
      setApiBacked(true)
      setRows(nextRows)
      setKpi(buildKpi(nextRows))
      setConnectorNames(
        [...new Set(nextRows.map((r) => r.connectorName).filter((n) => n && n !== '—'))].sort((a, b) =>
          a.localeCompare(b),
        ),
      )
      setStreamLabels([...new Set(nextRows.map((r) => r.streamLabel))].sort((a, b) => a.localeCompare(b)))
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
