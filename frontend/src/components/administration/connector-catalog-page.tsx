import { BookOpen, CheckCircle2, FileText, FlaskConical, Layers, RefreshCw, XCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchConnectorsRegistryList,
  type ConnectorRegistrySummaryRead,
} from '../../api/gdcConnectorsRegistry'
import { NAV_PATH } from '../../config/nav-paths'
import { cn } from '../../lib/utils'

function StatusBadge({ status }: { status: ConnectorRegistrySummaryRead['status'] }) {
  const isValid = status === 'valid'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        isValid
          ? 'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
          : 'bg-amber-500/10 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200',
      )}
      data-testid={isValid ? 'connector-status-valid' : 'connector-status-invalid'}
    >
      {isValid ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <XCircle className="h-3 w-3" aria-hidden />}
      {isValid ? 'Valid' : 'Invalid'}
    </span>
  )
}

function MigrationBadge({ row }: { row: ConnectorRegistrySummaryRead }) {
  const status = row.migration_status
  const label =
    status === 'module_based'
      ? 'Module Based'
      : status === 'legacy'
        ? 'Legacy'
        : 'Migration Pending'
  const className =
    status === 'module_based'
      ? 'bg-violet-500/10 text-violet-800 dark:bg-violet-500/15 dark:text-violet-200'
      : status === 'legacy'
        ? 'bg-slate-500/10 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300'
        : 'bg-amber-500/10 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200'

  return (
    <span
      className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', className)}
      data-testid={`connector-migration-${row.id}`}
      title={row.migration_label}
    >
      {label}
    </span>
  )
}

function BoolFlag({ value, label }: { value: boolean; label: string }) {
  return (
    <span
      className={cn(
        'font-medium',
        value ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-400 dark:text-gdc-muted',
      )}
    >
      {value ? 'Yes' : 'No'}
      <span className="sr-only"> {label}</span>
    </span>
  )
}

export function ConnectorCatalogPage() {
  const [rows, setRows] = useState<ConnectorRegistrySummaryRead[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await fetchConnectorsRegistryList()
      setRows(data.connectors)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="w-full min-w-0 space-y-5" data-testid="connector-catalog-page">
      <div className="border-b border-slate-200/80 pb-4 dark:border-gdc-divider">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              Administration
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              Connector Catalog
            </h2>
            <p className="mt-1 max-w-2xl text-[13px] text-slate-600 dark:text-gdc-muted">
              Declarative connector modules discovered from the platform registry. Migration status shows whether a
              vendor is module-based, legacy-only, or migration pending.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium',
              'text-slate-700 shadow-sm hover:border-violet-300 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200',
            )}
            data-testid="connector-catalog-refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-[13px] text-slate-600 dark:text-gdc-muted">Loading connector catalog…</p>
      ) : null}
      {loadError ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
          {loadError}
        </p>
      ) : null}

      {!loading && !loadError && rows.length === 0 ? (
        <p className="text-[13px] text-slate-600 dark:text-gdc-muted">No connector modules are registered yet.</p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Connector catalog modules">
        {rows.map((row) => (
          <article
            key={row.id}
            data-testid={`connector-catalog-card-${row.id}`}
            className="flex flex-col rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                  <Layers className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">{row.name}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-gdc-muted">{row.id}</p>
                </div>
              </div>
              <StatusBadge status={row.status} />
            </div>
            <div className="mt-2">
              <MigrationBadge row={row} />
            </div>
            <dl className="mt-3 space-y-1 text-[12px] text-slate-600 dark:text-gdc-muted">
              <div className="flex justify-between gap-2">
                <dt>Migration</dt>
                <dd className="font-medium text-slate-800 dark:text-slate-200">{row.migration_label}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Vendor</dt>
                <dd className="font-medium text-slate-800 dark:text-slate-200">{row.vendor}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Version</dt>
                <dd className="font-mono">{row.version}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Source type</dt>
                <dd className="font-mono text-[11px]">{row.source_type}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Auth</dt>
                <dd className="font-mono text-[11px]">{row.auth_type}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Manifest streams</dt>
                <dd>{row.stream_count}</dd>
              </div>
              <div className="flex justify-between gap-2 border-t border-slate-100 pt-1 dark:border-gdc-border">
                <dt className="flex items-center gap-1">
                  <Layers className="h-3 w-3" aria-hidden />
                  Stream templates
                </dt>
                <dd data-testid={`connector-resources-streams-${row.id}`}>{row.resources.streams_count}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Mappings</dt>
                <dd data-testid={`connector-resources-mappings-${row.id}`}>{row.resources.mappings_count}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Enrichments</dt>
                <dd data-testid={`connector-resources-enrichments-${row.id}`}>{row.resources.enrichments_count}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="flex items-center gap-1">
                  <FlaskConical className="h-3 w-3" aria-hidden />
                  API test
                </dt>
                <dd data-testid={`connector-resources-api-test-${row.id}`}>
                  <BoolFlag value={row.resources.has_api_test} label="API test" />
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="flex items-center gap-1">
                  <FileText className="h-3 w-3" aria-hidden />
                  Docs
                </dt>
                <dd data-testid={`connector-resources-docs-${row.id}`}>
                  <BoolFlag value={row.resources.has_docs} label="Docs" />
                </dd>
              </div>
              {row.status === 'invalid' && row.error_count > 0 ? (
                <div className="flex justify-between gap-2 pt-1 text-amber-700 dark:text-amber-300">
                  <dt>Validation errors</dt>
                  <dd data-testid={`connector-error-count-${row.id}`}>{row.error_count}</dd>
                </div>
              ) : null}
            </dl>
          </article>
        ))}
      </section>

      <p className="text-[12px] text-slate-500 dark:text-gdc-muted">
        <BookOpen className="mr-1 inline h-3.5 w-3.5" aria-hidden />
        Legacy flat templates remain under{' '}
        <Link to={NAV_PATH.templates} className="font-medium text-violet-700 hover:underline dark:text-violet-300">
          Templates
        </Link>
        . Return to{' '}
        <Link to={NAV_PATH.administration} className="font-medium text-violet-700 hover:underline dark:text-violet-300">
          Administration
        </Link>
        .
      </p>
    </div>
  )
}
