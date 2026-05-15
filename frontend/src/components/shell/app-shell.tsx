import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

type AppShellProps = {
  sidebar: ReactNode
  header: ReactNode
  children: ReactNode
  className?: string
}

export function AppShell({ sidebar, header, children, className }: AppShellProps) {
  return (
    <div className={cn('flex min-h-screen', className)}>
      {sidebar}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {header}
        <div className="gdc-app-workspace min-h-0 min-w-0 flex-1 overflow-x-hidden bg-slate-50 dark:bg-gdc-page">{children}</div>
      </div>
    </div>
  )
}
