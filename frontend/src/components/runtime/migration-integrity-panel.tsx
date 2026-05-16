import { AlertTriangle, ChevronRight, Info } from 'lucide-react'
import type { MigrationIntegrityReportDto } from '../../api/types/gdcApi'
import { cn } from '../../lib/utils'

type Props = {
  report: MigrationIntegrityReportDto | null | undefined
  /** When startup never attached migration_integrity */
  unavailable?: boolean
  className?: string
}

function summaryLine(report: MigrationIntegrityReportDto): string {
  const rev = report.db_revision ?? '—'
  const head = report.db_revision_is_head ? 'at head' : 'not at head'
  return `${report.ok ? 'OK' : report.status.toUpperCase()} · ${rev} · ${head}`
}

export function MigrationIntegrityPanel({ report, unavailable = false, className }: Props) {
  if (unavailable && !report) {
    return (
      <details
        className={cn(
          'group rounded-lg border border-slate-200/90 bg-slate-50/50 text-[12px] dark:border-gdc-border dark:bg-gdc-section',
          className,
        )}
        data-testid="migration-integrity-details"
      >
        <summary
          data-testid="migration-integrity-summary"
          className="cursor-pointer list-none px-3 py-2 font-medium text-slate-700 [&::-webkit-details-marker]:hidden dark:text-slate-200"
        >
          <span className="inline-flex items-center gap-1.5">
            <ChevronRight
              className="h-3.5 w-3.5 shrink-0 text-slate-400 transition group-open:rotate-90"
              aria-hidden
            />
            Migration integrity
            <span className="rounded bg-slate-200/80 px-1.5 py-px text-[10px] font-semibold uppercase dark:bg-gdc-elevated">n/a</span>
          </span>
        </summary>
        <div className="border-t border-slate-100 px-3 pb-2 pt-2 text-[11px] text-slate-600 dark:border-gdc-divider dark:text-gdc-muted">
          Not evaluated yet (database may be unreachable).
        </div>
      </details>
    )
  }

  if (!report) return null

  const showBanner = report.status === 'warn' || report.status === 'error'
  const bannerClass =
    report.status === 'error'
      ? 'border-rose-300/90 bg-rose-50 dark:border-rose-500/35 dark:bg-rose-950/35'
      : 'border-amber-300/90 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-950/28'

  return (
    <div className={cn('space-y-2', className)}>
      {showBanner ? (
        <div
          role="alert"
          data-testid="migration-integrity-banner"
          className={cn(
            'flex gap-2 rounded-lg border px-3 py-2.5 shadow-sm dark:shadow-none',
            bannerClass,
          )}
        >
          <AlertTriangle
            className={cn(
              'mt-0.5 h-4 w-4 shrink-0',
              report.status === 'error' ? 'text-rose-700 dark:text-rose-200' : 'text-amber-800 dark:text-amber-100',
            )}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                'text-[12px] font-semibold',
                report.status === 'error' ? 'text-rose-950 dark:text-rose-50' : 'text-amber-950 dark:text-amber-50',
              )}
            >
              Migration integrity · <span className="uppercase">{report.status}</span>
            </p>
            {(report.errors.length > 0 || report.warnings.length > 0) && (
              <ul className="mt-1.5 space-y-0.5 text-[11px] leading-snug text-slate-900 dark:text-slate-100">
                {report.errors.map((e) => (
                  <li key={`e:${e.slice(0, 80)}`}>• {e}</li>
                ))}
                {report.warnings.map((w) => (
                  <li key={`w:${w.slice(0, 80)}`}>• {w}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      <details
        className="group rounded-lg border border-slate-200/90 bg-white text-[12px] dark:border-gdc-border dark:bg-gdc-card"
        data-testid="migration-integrity-details"
      >
        <summary
          data-testid="migration-integrity-summary"
          className="cursor-pointer px-3 py-2 font-medium text-slate-800 [&::-webkit-details-marker]:hidden dark:text-slate-100"
        >
          <span className="inline-flex items-center gap-1.5">
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70 transition group-open:rotate-90" aria-hidden />
            Migration integrity
            {!showBanner ? (
              <span className="truncate text-[11px] font-normal text-slate-500 dark:text-gdc-muted">{summaryLine(report)}</span>
            ) : (
              <span className="text-[11px] font-normal text-slate-500 dark:text-gdc-muted">
                Revision {report.db_revision ?? '—'} · details
              </span>
            )}
          </span>
        </summary>

        <div className="space-y-3 border-t border-slate-100 px-3 py-2 dark:border-gdc-divider">
          <dl className="grid gap-2 text-[11px] sm:grid-cols-2">
            <div>
              <dt className="text-[10px] font-medium uppercase text-slate-500 dark:text-gdc-muted">OK</dt>
              <dd className="font-mono">{String(report.ok)}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-medium uppercase text-slate-500 dark:text-gdc-muted">Status</dt>
              <dd className="font-mono uppercase">{report.status}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-medium uppercase text-slate-500 dark:text-gdc-muted">DB revision</dt>
              <dd className="font-mono">{report.db_revision ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-medium uppercase text-slate-500 dark:text-gdc-muted">Repo heads</dt>
              <dd className="break-all font-mono">{report.repo_heads?.length ? report.repo_heads.join(', ') : '—'}</dd>
            </div>
          </dl>

          {(report.errors.length > 0 || report.warnings.length > 0) && (
            <div className="space-y-1">
              {report.errors.length > 0 ? (
                <div>
                  <p className="mb-0.5 text-[10px] font-semibold uppercase text-rose-800 dark:text-rose-200">Errors</p>
                  <ul className="space-y-0.5 text-[11px] text-rose-900 dark:text-rose-50">
                    {report.errors.map((e) => (
                      <li key={e}>• {e}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {report.warnings.length > 0 ? (
                <div>
                  <p className="mb-0.5 text-[10px] font-semibold uppercase text-amber-900 dark:text-amber-100">Warnings</p>
                  <ul className="space-y-0.5 text-[11px] text-amber-950 dark:text-amber-50">
                    {report.warnings.map((w) => (
                      <li key={w}>• {w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}

          {report.infos.length > 0 ? (
            <div className="rounded-md border border-slate-200/80 bg-slate-50 px-2 py-1.5 dark:border-gdc-border dark:bg-gdc-section">
              <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase text-slate-600 dark:text-gdc-mutedStrong">
                <Info className="h-3 w-3" aria-hidden />
                Notes (often dev/low severity)
              </p>
              <ul className="space-y-0.5 text-[11px] text-slate-700 dark:text-gdc-mutedStrong">
                {report.infos.map((i) => (
                  <li key={i}>• {i}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </details>
    </div>
  )
}
