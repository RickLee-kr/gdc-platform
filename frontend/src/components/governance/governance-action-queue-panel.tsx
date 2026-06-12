import { Link } from 'react-router-dom'
import type { GovernanceOperationsQueueResponse } from '../../api/gdcGovernanceOperations'
import {
  buildGovernanceActionQueue,
  priorityBadgeClass,
  type GovernanceActionQueueItem,
} from '../../lib/governance-action-queue'
import { cn } from '../../lib/utils'

function ActionQueueCard({
  item,
}: {
  item: GovernanceActionQueueItem
}) {
  return (
    <div
      className="rounded-lg border border-slate-100 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card"
      data-testid={`gov-action-queue-item-${item.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-slate-900 dark:text-slate-100">{item.title}</p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-gdc-muted">{item.subtitle}</p>
        </div>
        <span
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
            priorityBadgeClass(item.priority),
          )}
          data-testid={`gov-action-queue-priority-${item.id}`}
        >
          {item.priority}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {item.ctas.map((cta) =>
          cta.disabled ? (
            <span
              key={`${item.id}-${cta.label}`}
              data-testid={cta.testId}
              className="inline-flex rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-400 dark:border-gdc-border"
            >
              {cta.label}
            </span>
          ) : (
            <Link
              key={`${item.id}-${cta.label}`}
              to={cta.to}
              data-testid={cta.testId}
              className="inline-flex rounded-md border border-violet-300 bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-800 hover:bg-violet-100 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-200"
            >
              {cta.label}
            </Link>
          ),
        )}
      </div>
    </div>
  )
}

export function GovernanceActionQueuePanel({
  queue,
  readOnly = false,
  canApprove = true,
  canRelease = true,
  canReplay = true,
  testId = 'gov-action-queue-panel',
  limit,
}: {
  queue: GovernanceOperationsQueueResponse | null
  readOnly?: boolean
  canApprove?: boolean
  canRelease?: boolean
  canReplay?: boolean
  testId?: string
  limit?: number
}) {
  const items = buildGovernanceActionQueue(queue, { readOnly, canApprove, canRelease, canReplay })
  const visible = limit != null ? items.slice(0, limit) : items

  if (visible.length === 0) {
    return (
      <p className="text-[12px] text-slate-500 dark:text-gdc-muted" data-testid={`${testId}-empty`}>
        No actions required right now
      </p>
    )
  }

  return (
    <div className="space-y-2" data-testid={testId}>
      {visible.map((item) => (
        <ActionQueueCard key={item.id} item={item} />
      ))}
    </div>
  )
}
