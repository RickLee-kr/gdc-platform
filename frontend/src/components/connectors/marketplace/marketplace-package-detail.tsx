import { Loader2, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { MarketplacePackageCard } from '../../../api/gdcMarketplace'
import { newStreamPath } from '../../../config/nav-paths'
import { hasCompatibilityWarning, installStateLabel, trustTierBadgeClass, validationStatusBadgeClass } from './marketplace-badges'
import {
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogPortal,
  DialogTitle,
} from '../../ui/dialog'

export type MarketplaceActionKind = 'install' | 'upgrade' | 'rollback' | 'uninstall' | null

export type MarketplacePackageDetailProps = {
  card: MarketplacePackageCard
  busyAction: MarketplaceActionKind
  justInstalled: boolean
  onClose: () => void
  onInstallRequested: () => void
  onUpgradeRequested: () => void
  onRollback: () => void
  onUninstall: () => void
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">{label}</dt>
      <dd className="mt-0.5 text-[12px] text-slate-800 dark:text-gdc-foreground">{children}</dd>
    </div>
  )
}

export function MarketplacePackageDetail({
  card,
  busyAction,
  justInstalled,
  onClose,
  onInstallRequested,
  onUpgradeRequested,
  onRollback,
  onUninstall,
}: MarketplacePackageDetailProps) {
  const busy = busyAction !== null
  const canRollback = card.installed && !!card.previous_version
  const isSource = card.package_kind === 'source'

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogPortal className="items-start overflow-y-auto pt-10">
        <DialogBackdrop className="bg-slate-900/40" />
        <DialogContent
          className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-0 shadow-xl dark:border-gdc-border dark:bg-gdc-card"
          data-testid="marketplace-detail"
        >
        <div className="flex items-start justify-between gap-2 border-b border-slate-200/80 px-4 py-3 dark:border-gdc-divider">
          <div>
            <DialogTitle className="text-sm text-slate-900 dark:text-gdc-foreground">{card.name}</DialogTitle>
            <p className="text-[11px] text-slate-500 dark:text-gdc-muted">
              {card.vendor} · <span className="font-mono">{card.package_id}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close package detail"
            data-testid="marketplace-detail-close"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-gdc-elevated dark:hover:text-slate-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-4 py-3">
          {card.description ? (
            <p className="mb-3 text-[12px] text-slate-600 dark:text-gdc-muted">{card.description}</p>
          ) : null}

          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex rounded px-2 py-0.5 text-[11px] font-semibold ${trustTierBadgeClass(card.trust_tier)}`}
              data-testid="marketplace-detail-trust-tier"
            >
              {card.trust_tier}
            </span>
            <span className="inline-flex rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-500/15 dark:text-slate-200">
              {installStateLabel(card)}
            </span>
            <span
              className={`inline-flex rounded px-2 py-0.5 text-[11px] font-semibold ${validationStatusBadgeClass(card.validation_status)}`}
            >
              {card.validation_status}
            </span>
            {hasCompatibilityWarning(card) ? (
              <span
                className="inline-flex rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-100"
                data-testid="marketplace-detail-compat-warning"
              >
                Compatibility warning
              </span>
            ) : (
              <span className="inline-flex rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-100">
                Compatible
              </span>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-3 rounded-md border border-slate-200/80 bg-slate-50/60 p-3 dark:border-gdc-divider dark:bg-gdc-elevated/40">
            <Field label="Package kind">{card.package_kind}</Field>
            <Field label="Origin">{card.origin ?? '—'}</Field>
            <Field label="Pack version">{card.pack_version ?? '—'}</Field>
            <Field label="API version">{card.api_version ?? '—'}</Field>
            <Field label="Installed version">{card.installed_version ?? '—'}</Field>
            <Field label="Previous version">{card.previous_version ?? '—'}</Field>
          </dl>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-md border border-slate-200/80 p-3 dark:border-gdc-divider">
              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                Verification
              </h4>
              <dl className="space-y-1">
                <Field label="Signature status">{card.verification.signature_status}</Field>
                <Field label="Signing key">{card.verification.signing_key_id ?? '—'}</Field>
                <Field label="Digest">
                  <span className="break-all font-mono text-[10px]">{card.verification.digest ?? '—'}</span>
                </Field>
                <Field label="Evidence date">{card.verification.evidence_date ?? '—'}</Field>
              </dl>
            </div>
            <div className="rounded-md border border-slate-200/80 p-3 dark:border-gdc-divider">
              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                License
              </h4>
              <dl className="space-y-1">
                <Field label="Declared">{card.license.declared ?? '—'}</Field>
                <Field label="Decision">{card.license.decision ?? '—'}</Field>
                <Field label="Reason">{card.license.decision_reason ?? '—'}</Field>
              </dl>
            </div>
          </div>

          <div className="mt-3 rounded-md border border-slate-200/80 p-3 dark:border-gdc-divider">
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
              Provenance
            </h4>
            <dl className="grid grid-cols-2 gap-2">
              <Field label="Upstream project">{card.provenance.upstream_project ?? '—'}</Field>
              <Field label="Upstream URL">{card.provenance.upstream_url ?? '—'}</Field>
              <Field label="Import method">{card.provenance.import_method ?? '—'}</Field>
              <Field label="Modified from upstream">
                {card.provenance.modified_from_upstream === null || card.provenance.modified_from_upstream === undefined
                  ? '—'
                  : card.provenance.modified_from_upstream
                    ? 'Yes'
                    : 'No'}
              </Field>
            </dl>
          </div>

          {card.compatibility.warnings.length > 0 ? (
            <div
              className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
              data-testid="marketplace-detail-compat-warning-list"
            >
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide">Compatibility warnings</h4>
              <ul className="list-inside list-disc space-y-0.5">
                {card.compatibility.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {isSource ? (
            <div className="mt-3 rounded-md border border-slate-200/80 p-3 dark:border-gdc-divider">
              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                Available Streams
              </h4>
              {card.available_streams.length === 0 ? (
                <p className="text-[12px] text-slate-500 dark:text-gdc-muted">None declared.</p>
              ) : (
                <ul className="text-[12px] text-slate-700 dark:text-gdc-mutedStrong">
                  {card.available_streams.map((s) => (
                    <li key={s.id}>{s.name}</li>
                  ))}
                </ul>
              )}

              <h4 className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                Stream Extensions
              </h4>
              {card.stream_extensions.length === 0 ? (
                <p className="text-[12px] text-slate-500 dark:text-gdc-muted" data-testid="marketplace-stream-extensions-empty">
                  No stream extensions found for this package.
                </p>
              ) : (
                <ul className="space-y-1" data-testid="marketplace-stream-extensions-list">
                  {card.stream_extensions.map((ext) => (
                    <li
                      key={ext.package_id}
                      className="flex items-center justify-between rounded border border-slate-200/80 px-2 py-1 text-[12px] dark:border-gdc-divider"
                      data-testid={`marketplace-stream-extension-${ext.package_id}`}
                    >
                      <span>
                        {ext.name} <span className="font-mono text-[10px] text-slate-500 dark:text-gdc-muted">{ext.package_id}</span>
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          ext.installed
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-100'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-200'
                        }`}
                      >
                        {ext.installed ? 'Installed' : 'Not installed'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {justInstalled ? (
            <div
              className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-[12px] text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100"
              data-testid="marketplace-detail-post-install-cta"
            >
              <span>Package installed. It is not enabled for any stream yet.</span>
              <Link
                to={newStreamPath()}
                className="inline-flex h-8 items-center gap-1 rounded-md bg-emerald-600 px-2.5 text-[11px] font-semibold text-white hover:bg-emerald-700"
              >
                Continue in Stream Wizard
              </Link>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200/80 px-4 py-3 dark:border-gdc-divider">
          {!card.installed ? (
            <button
              type="button"
              onClick={onInstallRequested}
              disabled={busy}
              data-testid="marketplace-detail-install"
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busyAction === 'install' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              Install
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onUpgradeRequested}
                disabled={busy}
                data-testid="marketplace-detail-upgrade"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
              >
                {busyAction === 'upgrade' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                Upgrade
              </button>
              <button
                type="button"
                onClick={onRollback}
                disabled={busy || !canRollback}
                title={canRollback ? undefined : 'No previous version to roll back to'}
                data-testid="marketplace-detail-rollback"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
              >
                {busyAction === 'rollback' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                Rollback
              </button>
              <button
                type="button"
                onClick={onUninstall}
                disabled={busy}
                data-testid="marketplace-detail-uninstall"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 text-[12px] font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-500/40 dark:bg-gdc-card dark:text-red-200"
              >
                {busyAction === 'uninstall' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                Uninstall
              </button>
            </>
          )}
        </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  )
}
