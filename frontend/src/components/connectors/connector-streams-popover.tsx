import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ConnectorStreamOpsSummary } from '../../api/gdcConnectorsOperations'
import { streamRuntimePath } from '../../config/nav-paths'
import {
  connectorHealthBadgeClass,
  countStreamsByHealth,
  formatStreamOpsEps,
  formatStreamsHealthPopoverSummary,
  formatStreamsHealthSummary,
  sortConnectorStreamsProblemFirst,
  type ConnectorHealthLabel,
  type StreamHealthCounts,
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

type ConnectorStreamsPopoverProps = {
  streamCount: number
  streams: readonly ConnectorStreamOpsSummary[]
  streamCounts?: StreamHealthCounts
}

export function ConnectorStreamsPopover({ streamCount, streams, streamCounts }: ConnectorStreamsPopoverProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const counts = streamCounts ?? countStreamsByHealth(streams)
  const summary = formatStreamsHealthSummary(counts)
  const popoverSummary = formatStreamsHealthPopoverSummary(counts)
  const sortedStreams = sortConnectorStreamsProblemFirst(streams)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  if (streamCount <= 0) {
    return <span className="tabular-nums text-slate-500 dark:text-gdc-muted">0</span>
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex flex-col items-start gap-0 rounded px-1 py-0.5 text-left tabular-nums font-medium text-violet-700 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950/40"
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="connector-streams-popover-trigger"
      >
        <span className="inline-flex items-center gap-0.5">
          {streamCount}
          <ChevronDown className={`h-3 w-3 transition ${open ? 'rotate-180' : ''}`} aria-hidden />
        </span>
        {summary ? (
          <span className="text-[10px] font-normal text-slate-500 dark:text-gdc-muted" data-testid="connector-streams-summary">
            {summary}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          className="absolute left-0 z-30 mt-1 min-w-[280px] max-w-[360px] rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-gdc-border dark:bg-gdc-card"
          role="dialog"
          aria-label="Connector streams"
          data-testid="connector-streams-popover"
        >
          {popoverSummary.length > 0 ? (
            <div
              className="mb-2 space-y-0.5 rounded-md bg-slate-50 px-2 py-1.5 text-[10px] text-slate-600 dark:bg-gdc-elevated dark:text-gdc-muted"
              data-testid="connector-streams-popover-summary"
            >
              <p className="font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Health breakdown</p>
              {popoverSummary.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ) : null}
          <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
            Streams{summary ? ` ${summary}` : ''}
          </p>
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {sortedStreams.map((stream) => (
              <li key={stream.stream_id}>
                <Link
                  to={streamRuntimePath(String(stream.stream_id))}
                  className="block rounded-md px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-gdc-rowHover"
                  onClick={() => setOpen(false)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 truncate text-[12px] font-medium text-slate-800 dark:text-gdc-foreground">
                      {stream.stream_name}
                    </span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${connectorHealthBadgeClass(streamHealthLabel(stream.health))}`}
                    >
                      {streamHealthLabel(stream.health)}
                    </span>
                  </div>
                  {stream.primary_issue ? (
                    <p className="mt-0.5 text-[10px] text-slate-500 dark:text-gdc-muted">{stream.primary_issue}</p>
                  ) : null}
                  <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-slate-500 dark:text-gdc-muted">
                    <span className="tabular-nums">{formatStreamOpsEps(stream.events_1h)} EPS</span>
                    <span>
                      {stream.last_success_at ? formatRelativeShort(stream.last_success_at) : 'Never'}
                    </span>
                    <span>
                      {stream.destination_count} Destination{stream.destination_count === 1 ? '' : 's'}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
