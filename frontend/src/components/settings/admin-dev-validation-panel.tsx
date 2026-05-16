import { FlaskConical, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { getAdminDevValidationStatus, type DevValidationAdminStatusDto } from '../../api/gdcAdmin'
import { gdcUi } from '../../lib/gdc-ui-tokens'
import { cn } from '../../lib/utils'

function badgeClass(badge: string) {
  if (badge === 'OK') return 'border-emerald-500/35 bg-emerald-500/12 text-emerald-900 dark:text-emerald-100'
  if (badge === 'NOT_READY') return 'border-amber-500/40 bg-amber-500/12 text-amber-950 dark:text-amber-50'
  return 'border-slate-300 bg-slate-100 text-slate-600 dark:border-gdc-border dark:bg-gdc-section dark:text-gdc-muted'
}

function fmtTs(iso: string | undefined) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

type Props = {
  backendRole: 'ADMINISTRATOR' | 'OPERATOR' | 'VIEWER' | null
}

export function AdminDevValidationPanel({ backendRole }: Props) {
  const [data, setData] = useState<DevValidationAdminStatusDto | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (backendRole !== 'ADMINISTRATOR') return
    setErr(null)
    try {
      setData(await getAdminDevValidationStatus())
    } catch (e) {
      setData(null)
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [backendRole])

  useEffect(() => {
    void load()
  }, [load])

  if (backendRole !== 'ADMINISTRATOR') {
    return (
      <section className={cn(gdcUi.cardShell, 'p-4 md:p-6')} aria-labelledby="admin-dev-val-heading">
        <h3 id="admin-dev-val-heading" className="text-[15px] font-semibold text-slate-900 dark:text-slate-50">
          Dev validation lab status
        </h3>
        <p className="mt-2 text-[12px] text-slate-600 dark:text-gdc-muted" data-testid="dev-val-access-note">
          Administrator role is required to load fixture diagnostics and lab stream dependency checks.
        </p>
      </section>
    )
  }

  const vlab = data?.validation_lab
  const lastRun = vlab?.last_validation_run as Record<string, unknown> | undefined

  return (
    <section className={cn(gdcUi.cardShell, 'p-4 md:p-6')} aria-labelledby="admin-dev-val-heading">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-500/20 bg-violet-500/[0.07] text-violet-700 dark:border-gdc-primary/35 dark:bg-gdc-primary/15 dark:text-violet-100">
            <FlaskConical className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h3 id="admin-dev-val-heading" className="text-[15px] font-semibold text-slate-900 dark:text-slate-50">
              Dev validation lab status
            </h3>
            <p className="mt-0.5 max-w-3xl text-[12px] leading-relaxed text-slate-600 dark:text-gdc-muted">
              Required fixtures for enabled lab slices, live reachability probes (MinIO, MySQL/MariaDB/Postgres, SFTP, WireMock),
              lab streams missing routes or disabled integration flags, and the latest dev_lab validation run outcome.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:text-slate-100 dark:hover:bg-gdc-card"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Refresh
        </button>
      </div>

      {err ? (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-900 dark:border-rose-500/35 dark:bg-rose-950/40 dark:text-rose-100" role="alert">
          {err}
        </p>
      ) : null}

      {data ? (
        <div className="space-y-4 text-[12px]">
          <div className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-gdc-muted">
            <span className="font-medium text-slate-800 dark:text-slate-100">Readiness</span>
            <span
              className={cn('rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide', badgeClass(data.fixture_readiness_badge))}
              data-testid="fixture-readiness-badge"
            >
              {data.fixture_readiness_badge}
            </span>
            <span className="tabular-nums text-slate-500 dark:text-gdc-mutedStrong">Generated {fmtTs(data.generated_at)}</span>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className={cn('rounded-lg border p-3', gdcUi.innerWell)}>
              <p className="text-[11px] font-semibold uppercase text-slate-500 dark:text-gdc-muted">Lab gate</p>
              <ul className="mt-1.5 space-y-0.5 text-slate-700 dark:text-slate-200">
                <li>lab_effective: {data.lab_effective ? 'yes' : 'no'}</li>
                <li>ENABLE_DEV_VALIDATION_LAB: {data.enable_dev_validation_lab ? 'true' : 'false'}</li>
                <li>APP_ENV: {data.app_env || '—'}</li>
                <li>Platform DB: {data.platform_catalog_db?.reachable ? 'reachable' : 'unreachable'}</li>
              </ul>
            </div>
            <div className={cn('rounded-lg border p-3', gdcUi.innerWell)}>
              <p className="text-[11px] font-semibold uppercase text-slate-500 dark:text-gdc-muted">Feature slices</p>
              <ul className="mt-1.5 space-y-0.5 text-slate-700 dark:text-slate-200">
                <li>S3 lab: {data.fixture_flags?.ENABLE_DEV_VALIDATION_S3 ? 'on' : 'off'}</li>
                <li>Database query lab: {data.fixture_flags?.ENABLE_DEV_VALIDATION_DATABASE_QUERY ? 'on' : 'off'}</li>
                <li>Remote file lab: {data.fixture_flags?.ENABLE_DEV_VALIDATION_REMOTE_FILE ? 'on' : 'off'}</li>
                <li>Performance snapshots: {data.fixture_flags?.ENABLE_DEV_VALIDATION_PERFORMANCE ? 'on' : 'off'}</li>
                {data.lab_defaults_applied ? (
                  <li className="text-slate-500 dark:text-gdc-muted">
                    Non-production lab defaults applied (unset slice env vars → on)
                  </li>
                ) : null}
              </ul>
            </div>
          </div>

          {(data.seeded_lab_streams_total ?? 0) > 0 || Object.keys(data.seeded_lab_streams_by_type ?? {}).length > 0 ? (
            <div className={cn('rounded-lg border p-3', gdcUi.innerWell)}>
              <p className="text-[11px] font-semibold uppercase text-slate-500 dark:text-gdc-muted">Seeded [DEV VALIDATION] streams</p>
              <p className="mt-1 text-slate-700 dark:text-slate-200">
                Total: <span className="font-semibold tabular-nums">{data.seeded_lab_streams_total ?? 0}</span>
              </p>
              <ul className="mt-1.5 space-y-0.5 font-mono text-[11px] text-slate-600 dark:text-gdc-mutedStrong">
                {Object.entries(data.seeded_lab_streams_by_type ?? {}).map(([stype, count]) => (
                  <li key={stype}>
                    {stype}: {count}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <h4 className="text-[13px] font-semibold text-slate-900 dark:text-slate-50">Required fixtures</h4>
            <ul className="mt-2 space-y-1.5 text-slate-700 dark:text-slate-200">
              {(data.fixtures_required ?? []).map((f) => (
                <li key={String(f.id)} className="rounded border border-slate-100 px-2 py-1.5 dark:border-gdc-border">
                  <span className="font-medium">{String(f.name)}</span>
                  {f.required ? <span className="text-rose-700 dark:text-rose-200"> (required)</span> : null}
                  <div className="text-[11px] text-slate-500 dark:text-gdc-muted">{String(f.config_hint ?? '')}</div>
                  <div className="font-mono text-[11px] text-slate-600 dark:text-gdc-mutedStrong">{String(f.endpoint ?? '')}</div>
                </li>
              ))}
              {!(data.fixtures_required ?? []).length ? <li className="text-slate-500 dark:text-gdc-muted">No lab fixtures (lab disabled or not effective).</li> : null}
            </ul>
          </div>

          <div>
            <h4 className="text-[13px] font-semibold text-slate-900 dark:text-slate-50">Live probes</h4>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {Object.entries(data.fixture_readiness ?? {}).map(([k, v]) => {
                const row = v as { reachable?: boolean; latency_ms?: number | null; detail?: string | null }
                return (
                  <div key={k} className={cn('rounded-lg border p-2.5', gdcUi.innerWell)}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-100">{k}</span>
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase',
                          row.reachable ? 'bg-emerald-500/15 text-emerald-900 dark:text-emerald-100' : 'bg-amber-500/15 text-amber-950 dark:text-amber-50',
                        )}
                      >
                        {row.reachable ? 'ok' : 'fail'}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-600 dark:text-gdc-muted">
                      {row.latency_ms != null ? `${row.latency_ms} ms · ` : ''}
                      {row.detail ?? '—'}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>

          <div>
            <h4 className="text-[13px] font-semibold text-slate-900 dark:text-slate-50">Lab streams — dependency missing</h4>
            {(data.streams_dependency_missing ?? []).length ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700 dark:text-slate-200">
                {data.streams_dependency_missing.map((s) => (
                  <li key={String(s.stream_id)}>
                    <span className="font-mono">#{s.stream_id}</span> {String(s.name)}{' '}
                    <span className="text-slate-500 dark:text-gdc-muted">({String(s.stream_type)})</span> — {(s.reasons as string[]).join(', ')}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-slate-600 dark:text-gdc-muted">None detected (or catalog DB unreachable).</p>
            )}
          </div>

          <div>
            <h4 className="text-[13px] font-semibold text-slate-900 dark:text-slate-50">Continuous validation (dev_lab_*)</h4>
            {vlab ? (
              <ul className="mt-2 space-y-1 text-slate-700 dark:text-slate-200">
                <li>Definitions total: {String(vlab.lab_validation_definitions_total ?? '—')}</li>
                <li>Last status healthy: {String(vlab.last_status_healthy_count ?? '—')}</li>
                <li>Last status failing/degraded: {String(vlab.last_status_failing_or_degraded_count ?? '—')}</li>
                <li>Max last_success_at: {fmtTs(vlab.last_success_at_max as string | undefined)}</li>
                <li>
                  Last run success:{' '}
                  <span className={vlab.last_validation_run_success ? 'text-emerald-700 dark:text-emerald-200' : 'text-amber-800 dark:text-amber-100'}>
                    {vlab.last_validation_run_success ? 'yes (PASS)' : 'no or n/a'}
                  </span>
                </li>
                {lastRun ? (
                  <li className="rounded border border-slate-100 p-2 dark:border-gdc-border">
                    Latest run #{String(lastRun.id)} @ {fmtTs(lastRun.created_at as string)} — status {String(lastRun.status)} / {String(lastRun.stage)}
                    <div className="mt-1 text-[11px] text-slate-600 dark:text-gdc-muted">{String(lastRun.message ?? '').slice(0, 280)}</div>
                  </li>
                ) : (
                  <li className="text-slate-500 dark:text-gdc-muted">No dev_lab validation runs recorded.</li>
                )}
              </ul>
            ) : (
              <p className="mt-2 text-slate-600 dark:text-gdc-muted">Validation summary unavailable.</p>
            )}
          </div>
        </div>
      ) : !err ? (
        <p className="text-[12px] text-slate-600 dark:text-gdc-muted">Loading…</p>
      ) : null}
    </section>
  )
}
