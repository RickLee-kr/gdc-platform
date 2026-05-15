import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/utils'

type SectionContainerProps = HTMLAttributes<HTMLElement> & {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
}

export function SectionContainer({ title, action, children, className, ...rest }: SectionContainerProps) {
  return (
    <section className={cn('space-y-3', className)} {...rest}>
      {title != null || action != null ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {title != null ? <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{title}</h2> : null}
          {action != null ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}
