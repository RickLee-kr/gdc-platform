import { useCallback, useMemo, useRef, useState } from 'react'
import type { OperationalRouteSnapshot, OperationalStreamSnapshot } from '../../api/operationalSnapshot'
import { useGridColumns } from '../../hooks/use-grid-columns'
import {
  buildStreamGridRows,
  buildStreamVirtualItems,
  type StreamTopologyGroupMode,
} from '../../lib/runtime-stream-selectors'
import { recordVirtualWindow } from '../../lib/runtime-ui-instrumentation'
import { cn } from '../../lib/utils'
import { RuntimeStreamCard } from './runtime-stream-card'

const STREAM_CARD_ROW_HEIGHT = 148
const GROUP_HEADER_ROW_HEIGHT = 36
const VIRTUAL_OVERSCAN = 1

export function VirtualizedStreamGrid({
  streams,
  routes,
  focusStreamId,
  onFocusStream,
  groupMode,
  collapsedGroups,
  onToggleGroup,
}: {
  streams: readonly OperationalStreamSnapshot[]
  routes: readonly OperationalRouteSnapshot[]
  focusStreamId: number | null
  onFocusStream: (id: number) => void
  groupMode: StreamTopologyGroupMode
  collapsedGroups: ReadonlySet<string>
  onToggleGroup: (groupKey: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const columns = useGridColumns(measureRef)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(420)

  const virtualItems = useMemo(
    () => buildStreamVirtualItems(streams, groupMode, routes, collapsedGroups),
    [streams, groupMode, routes, collapsedGroups],
  )

  const gridRows = useMemo(() => buildStreamGridRows(virtualItems, columns), [virtualItems, columns])

  const rowHeights = useMemo(
    () => gridRows.map((r) => (r.kind === 'group-header' ? GROUP_HEADER_ROW_HEIGHT : STREAM_CARD_ROW_HEIGHT)),
    [gridRows],
  )

  const prefixHeights = useMemo(() => {
    const prefixes: number[] = []
    let sum = 0
    for (const h of rowHeights) {
      prefixes.push(sum)
      sum += h
    }
    return { prefixes, total: sum }
  }, [rowHeights])

  const range = useMemo(() => {
    let acc = 0
    let startIndex = 0
    for (let i = 0; i < rowHeights.length; i++) {
      if (acc + rowHeights[i]! > scrollTop) {
        startIndex = Math.max(0, i - VIRTUAL_OVERSCAN)
        break
      }
      acc += rowHeights[i]!
    }
    let endIndex = startIndex
    let visible = 0
    for (let i = startIndex; i < rowHeights.length; i++) {
      endIndex = i
      visible += rowHeights[i]!
      if (visible >= viewportHeight + rowHeights[i]! * VIRTUAL_OVERSCAN * 2) break
    }
    endIndex = Math.min(rowHeights.length - 1, endIndex + VIRTUAL_OVERSCAN)
    const offsetTop = prefixHeights.prefixes[startIndex] ?? 0
    return { startIndex, endIndex, offsetTop, totalSize: prefixHeights.total }
  }, [scrollTop, viewportHeight, rowHeights, prefixHeights])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (el == null) return
    setScrollTop(el.scrollTop)
    setViewportHeight(el.clientHeight)
  }, [])

  const stableOnSelect = useCallback((id: number) => onFocusStream(id), [onFocusStream])

  const visibleRows = useMemo(() => {
    if (range.endIndex < range.startIndex) return []
    return gridRows.slice(range.startIndex, range.endIndex + 1)
  }, [gridRows, range.startIndex, range.endIndex])

  const mountedCards = useMemo(
    () => visibleRows.reduce((n, r) => n + (r.kind === 'cards' ? r.streams.length : 0), 0),
    [visibleRows],
  )

  recordVirtualWindow(range.startIndex, range.endIndex, mountedCards)

  return (
    <div ref={measureRef} className="min-h-0 flex-1">
      <div
        ref={scrollRef}
        data-testid="runtime-stream-virtual-scroll"
        className="max-h-[420px] overflow-y-auto p-2"
        onScroll={onScroll}
      >
        <div style={{ height: range.totalSize, position: 'relative' }}>
          <div
            style={{
              position: 'absolute',
              top: range.offsetTop,
              left: 0,
              right: 0,
            }}
          >
            {visibleRows.map((row) => {
              if (row.kind === 'group-header') {
                return (
                  <button
                    key={row.key}
                    type="button"
                    data-testid={`runtime-stream-group-${row.groupKey}`}
                    onClick={() => onToggleGroup(row.groupKey)}
                    className="mb-2 flex w-full items-center justify-between rounded-md border border-slate-200/80 bg-slate-50/90 px-2 py-1.5 text-left text-[11px] font-semibold text-slate-700 dark:border-gdc-border dark:bg-gdc-elevated dark:text-slate-200"
                  >
                    <span>
                      {row.collapsed ? '▸' : '▾'} {row.label}
                    </span>
                    <span className="tabular-nums text-slate-500">{row.count}</span>
                  </button>
                )
              }
              return (
                <div
                  key={row.key}
                  className={cn('mb-2 grid gap-2', {
                    'grid-cols-1': columns === 1,
                    'grid-cols-2': columns === 2,
                    'grid-cols-3': columns === 3,
                    'grid-cols-4': columns === 4,
                  })}
                >
                  {row.streams.map((s) => (
                    <RuntimeStreamCard
                      key={s.stream_id}
                      stream={s}
                      selected={focusStreamId === s.stream_id}
                      onSelect={stableOnSelect}
                    />
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        Showing {mountedCards} of {streams.length} stream cards in viewport
      </p>
    </div>
  )
}
