import { cn } from '../../../lib/utils'
import type { RouteProcessingStatus } from '../wizard/wizard-state'
import {
  routeDeployReadinessLabel,
  routeProcessingDeployModeLabel,
  routeProcessingStatusDisplayLabel,
  type RouteProcessingDeployMode,
} from './route-processing-labels'

function processingStatusBadgeClass(status: RouteProcessingStatus): string {
  switch (status) {
    case 'Inherited':
      return 'border-slate-200/90 bg-slate-100/80 text-slate-600 dark:border-gdc-border dark:bg-gdc-section/80 dark:text-gdc-muted'
    case 'Overridden':
      return 'border-amber-300/80 bg-amber-500/15 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-100'
    case 'Mixed':
      return 'border-violet-300/80 bg-violet-500/12 text-violet-900 dark:border-violet-500/35 dark:bg-violet-500/15 dark:text-violet-100'
    default:
      return 'border-slate-200/90 bg-slate-100/80 text-slate-600'
  }
}

function deployModeBadgeClass(mode: RouteProcessingDeployMode): string {
  return mode === 'shared'
    ? 'border-slate-200/90 bg-slate-100/80 text-slate-600 dark:border-gdc-border dark:bg-gdc-section/80 dark:text-gdc-muted'
    : 'border-amber-300/80 bg-amber-500/15 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-100'
}

function deliveryBadgeClass(enabled: boolean): string {
  return enabled
    ? 'border-emerald-300/80 bg-emerald-500/12 text-emerald-800 dark:border-emerald-500/35 dark:bg-emerald-500/15 dark:text-emerald-200'
    : 'border-slate-200/90 bg-slate-100/80 text-slate-500 dark:border-gdc-border dark:bg-gdc-section/80 dark:text-gdc-muted'
}

function deployReadinessBadgeClass(status: 'ready' | 'warning' | 'error'): string {
  switch (status) {
    case 'ready':
      return 'border-emerald-300/80 bg-emerald-500/12 text-emerald-800 dark:border-emerald-500/35 dark:bg-emerald-500/15 dark:text-emerald-200'
    case 'warning':
      return 'border-amber-300/80 bg-amber-500/15 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-100'
    case 'error':
      return 'border-red-300/80 bg-red-500/12 text-red-800 dark:border-red-500/35 dark:bg-red-500/15 dark:text-red-200'
  }
}

const badgeBase =
  'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none'

export function RouteProcessingStatusBadge({
  status,
  className,
  'data-testid': testId,
}: {
  status: RouteProcessingStatus
  className?: string
  'data-testid'?: string
}) {
  return (
    <span
      className={cn(badgeBase, processingStatusBadgeClass(status), className)}
      data-testid={testId ?? `route-processing-status-${status.toLowerCase()}`}
    >
      {routeProcessingStatusDisplayLabel(status)}
    </span>
  )
}

/** @deprecated Use RouteProcessingStatusBadge — kept for gradual migration. */
export function RouteProcessingStatusLabel({
  status,
  className,
  'data-testid': testId,
}: {
  status: RouteProcessingStatus
  className?: string
  'data-testid'?: string
}) {
  return <RouteProcessingStatusBadge status={status} className={className} data-testid={testId} />
}

export function RouteProcessingDeployModeBadge({
  mode,
  className,
  'data-testid': testId,
}: {
  mode: RouteProcessingDeployMode
  className?: string
  'data-testid'?: string
}) {
  return (
    <span
      className={cn(badgeBase, deployModeBadgeClass(mode), className)}
      data-testid={testId ?? `route-processing-deploy-mode-${mode}`}
    >
      {routeProcessingDeployModeLabel(mode)}
    </span>
  )
}

export function RouteProcessingDeliveryBadge({
  enabled,
  className,
  'data-testid': testId,
}: {
  enabled: boolean
  className?: string
  'data-testid'?: string
}) {
  return (
    <span
      className={cn(badgeBase, deliveryBadgeClass(enabled), className)}
      data-testid={testId ?? 'route-card-delivery-status'}
    >
      {enabled ? 'Enabled' : 'Disabled'}
    </span>
  )
}

export function RouteDeployReadinessBadge({
  status,
  className,
  'data-testid': testId,
}: {
  status: 'ready' | 'warning' | 'error'
  className?: string
  'data-testid'?: string
}) {
  return (
    <span
      className={cn(badgeBase, deployReadinessBadgeClass(status), className)}
      data-testid={testId ?? `route-deploy-readiness-${status}`}
    >
      {routeDeployReadinessLabel(status)}
    </span>
  )
}

export function RouteProcessingStatusRow({
  label,
  status,
}: {
  label: string
  status: RouteProcessingStatus
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-[10px]">
      <span className="text-slate-600 dark:text-gdc-muted">{label}</span>
      <RouteProcessingStatusBadge status={status} />
    </div>
  )
}
