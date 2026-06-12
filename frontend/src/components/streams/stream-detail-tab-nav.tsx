import { useSearchParams } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { STREAM_DETAIL_TAB_DEFS, parseStreamDetailTab, type StreamDetailTab } from './stream-detail-tab-model'

export function StreamDetailTabNav({ active }: { streamId: string; active: StreamDetailTab }) {
  const [, setSearchParams] = useSearchParams()

  return (
    <nav aria-label="Stream detail sections" data-testid="stream-detail-tabs" className="border-b border-slate-200/80 dark:border-gdc-border">
      <ul className="-mb-px flex flex-wrap gap-0">
        {STREAM_DETAIL_TAB_DEFS.map((tab) => {
          const isActive = tab.key === active
          return (
            <li key={tab.key}>
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                data-testid={`stream-detail-tab-${tab.key}`}
                onClick={() => {
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev)
                    if (tab.key === 'overview') next.delete('tab')
                    else next.set('tab', tab.key)
                    return next
                  })
                }}
                className={cn(
                  'border-b-2 px-4 py-2.5 text-[13px] font-semibold transition-colors',
                  isActive
                    ? 'border-violet-500 text-violet-300 dark:border-violet-400 dark:text-violet-200'
                    : 'border-transparent text-slate-500 hover:text-slate-300 dark:text-gdc-muted dark:hover:text-slate-200',
                )}
              >
                {tab.label}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export function useStreamDetailTab(): StreamDetailTab {
  const [params] = useSearchParams()
  return parseStreamDetailTab(params.get('tab'))
}
