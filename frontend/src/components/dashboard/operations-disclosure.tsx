import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { cn } from '../../lib/utils'

type DisclosureSectionProps = {
  title: string
  testId: string
  defaultOpen?: boolean
  children: ReactNode
}

function DisclosureSection({ title, testId, defaultOpen = false, children }: DisclosureSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="rounded-xl border border-slate-200/80 bg-white dark:border-gdc-border dark:bg-gdc-card" data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{title}</span>
        <ChevronDown className={cn('h-4 w-4 text-slate-500 transition', open && 'rotate-180')} aria-hidden />
      </button>
      {open ? <div className="space-y-4 border-t border-slate-200/70 px-4 py-4 dark:border-gdc-border">{children}</div> : null}
    </section>
  )
}

function OperationsDisclosureRoot({ children }: { children: ReactNode }) {
  return <div className="space-y-3">{children}</div>
}

export const OperationsDisclosureSections = Object.assign(OperationsDisclosureRoot, {
  Section: DisclosureSection,
})
