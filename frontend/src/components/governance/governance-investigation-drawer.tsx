import { Loader2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { OP_LABEL } from '../../lib/operator-vocabulary'

type GovernanceInvestigationDrawerProps = {
  title: string
  testId: string
  closeTestId: string
  loading: boolean
  hasContent: boolean
  onClose: () => void
  rootCauseStrip?: string | null
  rootCauseTestId?: string
  whatHappened: ReactNode
  whatHappenedTestId: string
  why: ReactNode
  whyTestId: string
  whatShouldIDo?: ReactNode
  whatShouldIDoTestId?: string
  related?: ReactNode
  relatedTestId?: string
}

export function GovernanceInvestigationDrawer({
  title,
  testId,
  closeTestId,
  loading,
  hasContent,
  onClose,
  rootCauseStrip,
  rootCauseTestId,
  whatHappened,
  whatHappenedTestId,
  why,
  whyTestId,
  whatShouldIDo,
  whatShouldIDoTestId = 'governance-drawer-what-should-i-do',
  related,
  relatedTestId = 'governance-drawer-related',
}: GovernanceInvestigationDrawerProps) {
  if (!hasContent && !loading) return null

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      data-testid={`${testId}-backdrop`}
      onClick={onClose}
      role="presentation"
    >
      <aside
        className="flex h-full w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-xl dark:border-gdc-border dark:bg-gdc-card"
        data-testid={testId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-200 px-4 py-3 dark:border-gdc-border">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</p>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-gdc-rowHover"
              aria-label="Close"
              data-testid={closeTestId}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {rootCauseStrip ? (
            <p
              className="mt-2 rounded-md bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-700 dark:bg-gdc-rowHover dark:text-slate-200"
              data-testid={rootCauseTestId}
            >
              {rootCauseStrip}
            </p>
          ) : null}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading…
            </div>
          ) : hasContent ? (
            <>
              <section className="space-y-2" data-testid={whatHappenedTestId}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{OP_LABEL.whatHappened}</p>
                {whatHappened}
              </section>

              <section
                className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-gdc-border"
                data-testid={whyTestId}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{OP_LABEL.why}</p>
                {why}
              </section>

              {related ? (
                <section
                  className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-gdc-border"
                  data-testid={relatedTestId}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Related objects</p>
                  {related}
                </section>
              ) : null}

              {whatShouldIDo ? (
                <section className="space-y-2" data-testid={whatShouldIDoTestId}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{OP_LABEL.whatShouldIDo}</p>
                  {whatShouldIDo}
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      </aside>
    </div>
  )
}
