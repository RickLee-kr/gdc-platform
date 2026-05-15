import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { deleteConnector, fetchConnectorsList, type ConnectorRead } from '../../api/gdcConnectors'
import { connectorDetailPath } from '../../config/nav-paths'
import { DevValidationBadge } from '../shell/dev-validation-badge'
import { isDevValidationLabEntityName } from '../../utils/devValidationLab'

export function ConnectorsOverviewPage() {
  const [rows, setRows] = useState<ConnectorRead[]>([])
  const [loading, setLoading] = useState(true)
  const [apiBacked, setApiBacked] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [labFilterOnly, setLabFilterOnly] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    const list = await fetchConnectorsList()
    if (!list) {
      setApiBacked(false)
      setRows([])
      setLoading(false)
      return
    }
    setApiBacked(true)
    setRows(list)
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const visibleRows = useMemo(
    () => (labFilterOnly ? rows.filter((r) => isDevValidationLabEntityName(r.name)) : rows),
    [rows, labFilterOnly],
  )
  const hasRows = useMemo(() => visibleRows.length > 0, [visibleRows.length])
  const labCount = useMemo(() => rows.filter((r) => isDevValidationLabEntityName(r.name)).length, [rows])

  async function onDelete(row: ConnectorRead) {
    const ok = window.confirm(`Delete connector "${row.name}"?`)
    if (!ok) return
    try {
      await deleteConnector(row.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-gdc-foreground">Connectors</h2>
          <p className="text-[13px] text-slate-600 dark:text-gdc-muted">Manage your Generic HTTP connectors.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex h-9 cursor-pointer select-none items-center gap-1.5 rounded-md border border-amber-200/80 bg-amber-50/80 px-2 text-[11px] font-medium text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-50">
            <input
              type="checkbox"
              className="rounded border-amber-400 text-amber-700 focus:ring-amber-500"
              checked={labFilterOnly}
              onChange={(e) => setLabFilterOnly(e.target.checked)}
              aria-label="Dev validation lab only filter"
            />
            Dev validation lab only
            <span className="ml-1 rounded bg-amber-100 px-1 font-mono text-[10px] text-amber-900 dark:bg-amber-900/60 dark:text-amber-50">{labCount}</span>
          </label>
          <Link to="/connectors/new" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white hover:bg-violet-700">
            <Plus className="h-3.5 w-3.5" />
            Create Connector
          </Link>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-[12px] dark:border-gdc-border dark:bg-gdc-card dark:text-gdc-mutedStrong">
        <span
          className={`inline-flex rounded px-2 py-0.5 font-semibold ${
            apiBacked
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-100'
              : 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-100'
          }`}
        >
          {apiBacked ? 'API-backed' : 'Local preview'}
        </span>
        <span className="ml-2 text-[11px] text-slate-500 dark:text-gdc-muted">
          {rows.length} total · {labCount} Dev validation lab
        </span>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 p-2 text-[12px] text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
          {error}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card">
        <table className="min-w-full text-left text-[12px] text-slate-700 dark:text-gdc-mutedStrong">
          <thead className="border-b border-slate-200/80 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:border-gdc-divider dark:bg-gdc-tableHeader dark:text-gdc-mutedStrong">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Host/Base URL</th>
              <th className="px-3 py-2">Auth Type</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Streams</th>
              <th className="px-3 py-2">Updated</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-3 py-5 text-slate-500 dark:text-gdc-muted" colSpan={7}>
                  Loading connectors...
                </td>
              </tr>
            ) : !hasRows ? (
              <tr>
                <td className="px-3 py-5 text-slate-500 dark:text-gdc-muted" colSpan={7}>
                {labFilterOnly && rows.length > 0
                  ? 'No Dev validation lab connectors. Toggle off the filter to see all connectors.'
                  : 'No connectors found.'}
              </td></tr>
            ) : visibleRows.map((row) => (
              <tr
                key={row.id}
                className="border-t border-slate-200/70 transition-colors hover:bg-slate-50/80 dark:border-gdc-divider dark:hover:bg-gdc-rowHover"
              >
                <td className="px-3 py-2 font-medium text-slate-800 dark:text-gdc-foreground">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link to={connectorDetailPath(String(row.id))} className="text-violet-700 hover:underline dark:text-violet-300">
                      {row.name}
                    </Link>
                    <DevValidationBadge name={row.name} />
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-slate-700 dark:text-gdc-mutedStrong">{row.base_url ?? row.host ?? '-'}</td>
                <td className="px-3 py-2 text-slate-700 dark:text-gdc-mutedStrong">{row.auth_type}</td>
                <td className="px-3 py-2 text-slate-700 dark:text-gdc-mutedStrong">{row.status ?? 'STOPPED'}</td>
                <td className="px-3 py-2 tabular-nums text-slate-700 dark:text-gdc-mutedStrong">{row.stream_count}</td>
                <td className="px-3 py-2 text-slate-700 dark:text-gdc-mutedStrong">{row.updated_at ?? '-'}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    <Link to={connectorDetailPath(String(row.id))} className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-600 hover:bg-slate-100 dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover">
                      <Pencil className="h-3.5 w-3.5" />
                    </Link>
                    <button type="button" onClick={() => void onDelete(row)} className="inline-flex h-7 w-7 items-center justify-center rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
