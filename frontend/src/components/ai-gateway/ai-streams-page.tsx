import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchAiProvidersList, type AiProviderRead } from '../../api/gdcAiProviders'
import { fetchAiStreamsList, type AiStreamRead } from '../../api/gdcAiStreams'
import { fetchStreamsList } from '../../api/gdcStreams'
import type { StreamRead } from '../../api/types/gdcApi'
import { streamRuntimePath } from '../../config/nav-paths'
import { AiGatewayEmptyState, aiStreamsEmptyState } from './ai-gateway-empty-state'

export function AiStreamsPage() {
  const [rows, setRows] = useState<AiStreamRead[]>([])
  const [providers, setProviders] = useState<AiProviderRead[]>([])
  const [streams, setStreams] = useState<StreamRead[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [aiRows, providerRows, streamRows] = await Promise.all([
        fetchAiStreamsList(),
        fetchAiProvidersList(),
        fetchStreamsList(),
      ])
      setRows(aiRows)
      setProviders(providerRows)
      setStreams(streamRows ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const providerNameById = useMemo(() => {
    const m = new Map<number, string>()
    for (const p of providers) m.set(p.id, p.name)
    return m
  }, [providers])

  const streamNameById = useMemo(() => {
    const m = new Map<number, string>()
    for (const s of streams) {
      if (typeof s.id === 'number') m.set(s.id, s.name)
    }
    return m
  }, [streams])

  const empty = aiStreamsEmptyState()

  return (
    <section data-testid="ai-streams-page" className="space-y-4">
      {loading ? (
        <p className="text-sm text-slate-600 dark:text-gdc-muted">Loading AI streams…</p>
      ) : rows.length === 0 ? (
        <AiGatewayEmptyState testId="ai-streams-empty-state" {...empty} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-gdc-border">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-gdc-card dark:text-gdc-muted">
              <tr>
                <th className="px-3 py-2">Slug</th>
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2">Stream</th>
                <th className="px-3 py-2">Provider</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const streamName = streamNameById.get(row.stream_id) ?? `stream-${row.stream_id}`
                const providerName = providerNameById.get(row.provider_id) ?? `provider-${row.provider_id}`
                return (
                  <tr key={row.id} className="border-t border-slate-200 dark:border-gdc-border">
                    <td className="px-3 py-2 font-mono text-xs">{row.slug}</td>
                    <td className="px-3 py-2">{row.model}</td>
                    <td className="px-3 py-2">
                      <Link
                        to={streamRuntimePath(String(row.stream_id))}
                        className="font-medium text-violet-700 hover:underline dark:text-violet-300"
                      >
                        {streamName}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{providerName}</td>
                    <td className="px-3 py-2">{row.enabled ? 'Enabled' : 'Disabled'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
