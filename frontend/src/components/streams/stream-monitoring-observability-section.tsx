import { ChevronDown, ChevronUp } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { cn } from '../../lib/utils'

export type StreamMonitoringObservabilitySectionProps = {
  children: ReactNode
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function StreamMonitoringObservabilitySection({
  children,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
}: StreamMonitoringObservabilitySectionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const open = controlledOpen ?? internalOpen
  const setOpen = (next: boolean) => {
    setInternalOpen(next)
    onOpenChange?.(next)
  }

  return (
    <section aria-label="Observability" data-testid="stream-monitoring-observability" className="rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <div>
          <h3 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Observability</h3>
          <p className="text-[10px] text-slate-500 dark:text-gdc-muted">Charts, routes, checkpoint trace, run history, advanced tools</p>
        </div>
        {open ? <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" aria-hidden /> : <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />}
      </button>
      <div className={cn('border-t border-slate-200/80 dark:border-gdc-border', open ? 'block' : 'hidden')}>
        <div className="space-y-4 p-4">{children}</div>
      </div>
    </section>
  )
}
