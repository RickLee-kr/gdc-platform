import type { HTMLAttributes, ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { cn } from '../../lib/utils'

type DashboardCardProps = HTMLAttributes<HTMLDivElement> & {
  title?: ReactNode
  description?: ReactNode
  children: ReactNode
  headerClassName?: string
}

export function DashboardCard({ title, description, children, className, headerClassName, ...rest }: DashboardCardProps) {
  const showHeader = title != null || description != null

  return (
    <Card className={cn('border-slate-200 shadow-sm dark:border-gdc-border dark:shadow-gdc-card', className)} {...rest}>
      {showHeader ? (
        <CardHeader className={cn('pb-2', headerClassName)}>
          {title != null ? <CardTitle className="text-xs font-medium text-slate-500 dark:text-gdc-muted">{title}</CardTitle> : null}
          {description != null ? <p className="mt-0.5 text-xs text-slate-500 dark:text-gdc-muted">{description}</p> : null}
        </CardHeader>
      ) : null}
      <CardContent className={showHeader ? '' : 'pt-4'}>{children}</CardContent>
    </Card>
  )
}
