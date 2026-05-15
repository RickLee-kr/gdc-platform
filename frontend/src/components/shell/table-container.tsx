import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

type TableContainerProps = HTMLAttributes<HTMLDivElement>

export function TableContainer({ className, ...rest }: TableContainerProps) {
  return (
    <div
      className={cn(
        'overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-gdc-border dark:bg-gdc-card dark:shadow-gdc-card dark:ring-1 dark:ring-[rgba(120,150,220,0.07)]',
        className,
      )}
      {...rest}
    />
  )
}
