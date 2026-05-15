import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { cn } from '../../lib/utils'

type RuntimeChartCardProps = {
  title: string
  subtitle?: string
  /** Optional header actions (e.g. deep-link to related workspace page). */
  actions?: ReactNode
  children: ReactNode
  className?: string
  chartClassName?: string
}

export function RuntimeChartCard({ title, subtitle, actions, children, className, chartClassName }: RuntimeChartCardProps) {
  return (
    <Card
      className={cn(
        'border border-slate-200/80 bg-white/95 shadow-none ring-1 ring-slate-200/40 dark:border-gdc-border dark:bg-gdc-card dark:ring-slate-800/60',
        className,
      )}
    >
      <CardHeader className="space-y-0.5 pb-2 pt-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-0.5">
            <CardTitle className="text-[13px] font-semibold leading-tight text-slate-900 dark:text-slate-100">{title}</CardTitle>
            {subtitle != null ? <p className="text-[11px] leading-snug text-slate-500 dark:text-gdc-muted">{subtitle}</p> : null}
          </div>
          {actions != null ? <div className="shrink-0">{actions}</div> : null}
        </div>
      </CardHeader>
      <CardContent className={cn('pb-3 pt-0', chartClassName)}>{children}</CardContent>
    </Card>
  )
}
