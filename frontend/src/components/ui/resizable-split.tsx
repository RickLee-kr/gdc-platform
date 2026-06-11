import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../lib/utils'

export type ResizableSplitDirection = 'row' | 'column'

export type ResizableSplitProps = {
  direction: ResizableSplitDirection
  first: ReactNode
  second: ReactNode
  initialRatio?: number
  minFirstPx?: number
  minSecondPx?: number
  storageKey?: string
  className?: string
  firstClassName?: string
  secondClassName?: string
}

function clampRatio(ratio: number, minFirst: number, minSecond: number, size: number): number {
  if (size <= 0) return ratio
  const minFirstRatio = minFirst / size
  const minSecondRatio = minSecond / size
  return Math.min(1 - minSecondRatio, Math.max(minFirstRatio, ratio))
}

function readStoredRatio(key: string | undefined, fallback: number): number {
  if (!key || typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (raw == null) return fallback
    const n = Number.parseFloat(raw)
    if (!Number.isFinite(n)) return fallback
    return Math.min(0.88, Math.max(0.12, n))
  } catch {
    return fallback
  }
}

export function ResizableSplit({
  direction,
  first,
  second,
  initialRatio = direction === 'row' ? 0.42 : 0.55,
  minFirstPx = 200,
  minSecondPx = 160,
  storageKey,
  className,
  firstClassName,
  secondClassName,
}: ResizableSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [ratio, setRatio] = useState(() => readStoredRatio(storageKey, initialRatio))
  const [dragging, setDragging] = useState(false)
  const labelId = useId()

  const persistRatio = useCallback(
    (next: number) => {
      setRatio(next)
      if (storageKey) {
        try {
          window.localStorage.setItem(storageKey, String(next))
        } catch {
          /* ignore quota / private mode */
        }
      }
    },
    [storageKey],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const el = containerRef.current
      if (!el) return
      e.currentTarget.setPointerCapture(e.pointerId)
      setDragging(true)

      const updateFromPointer = (clientX: number, clientY: number) => {
        const rect = el.getBoundingClientRect()
        const size = direction === 'row' ? rect.width : rect.height
        const offset = direction === 'row' ? clientX - rect.left : clientY - rect.top
        const raw = offset / size
        persistRatio(clampRatio(raw, minFirstPx, minSecondPx, size))
      }

      updateFromPointer(e.clientX, e.clientY)

      const onMove = (ev: PointerEvent) => updateFromPointer(ev.clientX, ev.clientY)
      const onUp = (ev: PointerEvent) => {
        setDragging(false)
        try {
          e.currentTarget.releasePointerCapture(ev.pointerId)
        } catch {
          /* already released */
        }
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [direction, minFirstPx, minSecondPx, persistRatio],
  )

  useEffect(() => {
    if (!dragging) return
    const prev = document.body.style.cursor
    document.body.style.cursor = direction === 'row' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.cursor = prev
      document.body.style.userSelect = ''
    }
  }, [dragging, direction])

  const firstStyle =
    direction === 'row'
      ? { width: `${ratio * 100}%`, minWidth: minFirstPx }
      : { height: `${ratio * 100}%`, minHeight: minFirstPx }

  const isRow = direction === 'row'

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex min-h-0 min-w-0',
        isRow ? 'h-full flex-row' : 'h-full flex-col',
        dragging && 'select-none',
        className,
      )}
    >
      <div className={cn('min-h-0 min-w-0 shrink-0 overflow-hidden', firstClassName)} style={firstStyle}>
        {first}
      </div>

      <div
        role="separator"
        aria-orientation={isRow ? 'vertical' : 'horizontal'}
        aria-labelledby={labelId}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={12}
        aria-valuemax={88}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.08 : 0.03
          if (isRow) {
            if (e.key === 'ArrowLeft') {
              e.preventDefault()
              persistRatio(Math.max(0.12, ratio - step))
            } else if (e.key === 'ArrowRight') {
              e.preventDefault()
              persistRatio(Math.min(0.88, ratio + step))
            }
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            persistRatio(Math.max(0.12, ratio - step))
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            persistRatio(Math.min(0.88, ratio + step))
          }
        }}
        className={cn(
          'group relative z-10 shrink-0 touch-none bg-slate-200/80 dark:bg-gdc-border',
          isRow ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize',
          'hover:bg-violet-400/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-violet-500/60',
          dragging && 'bg-violet-500/45',
        )}
      >
        <span id={labelId} className="sr-only">
          {isRow ? 'Resize columns' : 'Resize panels'}
        </span>
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-400/70 opacity-0 transition-opacity group-hover:opacity-100 dark:bg-slate-500/80',
            isRow ? 'h-8 w-0.5' : 'h-0.5 w-8',
            dragging && 'opacity-100',
          )}
        />
      </div>

      <div className={cn('min-h-0 min-w-0 flex-1 overflow-hidden', secondClassName)}>{second}</div>
    </div>
  )
}
