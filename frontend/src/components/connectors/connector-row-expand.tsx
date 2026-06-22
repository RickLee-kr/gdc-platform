import { Link } from 'react-router-dom'
import type { ConnectorStreamOpsSummary } from '../../api/gdcConnectorsOperations'
import { streamRuntimePath } from '../../config/nav-paths'
import {
  connectorHealthBadgeClass,
  formatStreamOpsEps,
  sortConnectorStreamsProblemFirst,
  type ConnectorHealthLabel,
} from '../../lib/connector-operational-health'
import { formatRelativeShort } from '../../lib/stream-console-metrics'

function streamHealthLabel(health: ConnectorStreamOpsSummary['health']): ConnectorHealthLabel {
  switch (health) {
    case 'critical':
      return 'Critical'
    case 'warning':
      return 'Warning'
    case 'stopped':
      return 'Stopped'
    default:
      return 'Healthy'
  }
}

type ConnectorRowExpandProps = {
  connectorName: string
  streams: readonly ConnectorStreamOpsSummary[]
  loading?: boolean
}

export function ConnectorRowExpand({ connectorName, streams, loading }: ConnectorRowExpandProps) {
  const sorted = sortConnectorStreamsProblemFirst(streams)

  return (
    <tr data-testid="connector-row-expand">
      <td colSpan={11} className="border-t border-slate-200/70 bg-slate-50/60 px-3 py-3 dark:border-gdc-divider dark:bg-gdc-elevated/40">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-gdc-muted">
            Connected Streams — {connectorName}
          </p>
          {loading ? (
            <span className="text-[10px] text-slate-500 dark:text-gdc-muted">Loading runtime…</span>
          ) : null}
        </div>
        {sorted.length === 0 ? (
          <p className="text-[12px] text-slate-500 dark:text-gdc-muted">No streams linked to this connector.</p>
        ) : (
          <ul className="space-y-1.5">
            {sorted.map((stream) => (
              <li key={stream.stream_id}>
                <Link
                  to={streamRuntimePath(String(stream.stream_id))}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-slate-200/80 bg-white px-3 py-2 text-[12px] hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:hover:bg-gdc-rowHover"
                  data-testid={`connector-expand-stream-${stream.stream_id}`}
                >
                  <span className="min-w-[8rem] font-medium text-slate-800 dark:text-gdc-foreground">{stream.stream_name}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${connectorHealthBadgeClass(streamHealthLabel(stream.health))}`}
                  >
                    {streamHealthLabel(stream.health)}
                  </span>
                  {stream.primary_issue ? (
                    <span className="text-[11px] text-slate-600 dark:text-gdc-muted">{stream.primary_issue}</span>
                  ) : null}
                  <span className="tabular-nums text-[11px] text-slate-600 dark:text-gdc-muted">
                    {formatStreamOpsEps(stream.events_1h)} EPS
                  </span>
                  <span className="text-[11px] text-slate-600 dark:text-gdc-muted">
                    Last Event {stream.last_success_at ? formatRelativeShort(stream.last_success_at) : 'Never'}
                  </span>
                  <span className="text-[11px] text-slate-600 dark:text-gdc-muted">
                    {stream.destination_count} Destination{stream.destination_count === 1 ? '' : 's'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  )
}
