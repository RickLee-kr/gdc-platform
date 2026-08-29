import { X } from 'lucide-react'
import { useState } from 'react'
import {
  installPackageUpload,
  previewPackageUpgradeImpact,
  upgradePackageUpload,
  validatePackageUpload,
  type MarketplacePackageInstallRead,
  type MarketplaceValidateResultRead,
  type UpgradeImpactPreviewResponse,
} from '../../../api/gdcMarketplace'
import {
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogDescription,
  DialogPortal,
  DialogTitle,
} from '../../ui/dialog'
import { Button } from '../../ui/button'
import { validationStatusBadgeClass } from './marketplace-badges'
import { MarketplaceUpgradeImpactPanel } from './marketplace-upgrade-impact-panel'

export type MarketplaceUploadDialogProps = {
  mode: 'install' | 'upgrade'
  packageId?: string
  onClose: () => void
  onCompleted: (row: MarketplacePackageInstallRead) => void
}

type Step = 'select' | 'validating' | 'review' | 'installing'

const ACCEPTED_EXTENSIONS = ['.tar.gz', '.tgz']

function hasAcceptedExtension(name: string): boolean {
  const lower = name.toLowerCase()
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function MarketplaceUploadDialog({ mode, packageId, onClose, onCompleted }: MarketplaceUploadDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [step, setStep] = useState<Step>('select')
  const [result, setResult] = useState<MarketplaceValidateResultRead | null>(null)
  const [impact, setImpact] = useState<UpgradeImpactPreviewResponse | null>(null)
  const [impactLoading, setImpactLoading] = useState(false)
  const [impactError, setImpactError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function onFileChange(f: File | null) {
    setFile(f)
    setResult(null)
    setImpact(null)
    setImpactError(null)
    setError(null)
    if (f && !hasAcceptedExtension(f.name)) {
      setError('Only .tar.gz or .tgz package archives are supported.')
    }
  }

  async function onValidate() {
    if (!file) return
    setError(null)
    setImpact(null)
    setImpactError(null)
    setStep('validating')
    try {
      const r = await validatePackageUpload(file)
      setResult(r)
      if (mode === 'upgrade' && packageId && r.status !== 'FAIL') {
        setImpactLoading(true)
        try {
          const preview = await previewPackageUpgradeImpact(packageId, file)
          setImpact(preview)
        } catch (e) {
          setImpactError(e instanceof Error ? e.message : String(e))
        } finally {
          setImpactLoading(false)
        }
      }
      setStep('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStep('select')
    }
  }

  async function onInstall() {
    if (!file || !result || result.status === 'FAIL') return
    if (mode === 'upgrade' && impact && !impact.can_upgrade) return
    setError(null)
    setStep('installing')
    try {
      const row =
        mode === 'upgrade' && packageId
          ? await upgradePackageUpload(packageId, file, {
              expectedBaseDigest: impact?.current_digest ?? null,
              expectedBaseUpdatedAt: impact?.current_updated_at ?? null,
            })
          : await installPackageUpload(file)
      onCompleted(row)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStep('review')
    }
  }

  const blockInstall =
    !result ||
    result.status === 'FAIL' ||
    (mode === 'upgrade' && (impactLoading || !!impactError || (impact != null && !impact.can_upgrade)))
  const busy = step === 'validating' || step === 'installing' || impactLoading
  const showInstallStep = step === 'review' || step === 'installing'

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogPortal>
        <DialogBackdrop className="bg-slate-900/40" />
        <DialogContent
          className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-0 shadow-xl dark:border-gdc-border dark:bg-gdc-card"
          data-testid="marketplace-upload-dialog"
        >
          <div className="flex items-center justify-between border-b border-slate-200/80 px-4 py-3 dark:border-gdc-divider">
            <DialogTitle className="text-sm font-semibold text-slate-900 dark:text-gdc-foreground">
              {mode === 'upgrade' ? `Upgrade ${packageId ?? 'package'}` : 'Upload Package'}
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close upload dialog"
              data-testid="marketplace-upload-close"
              className="h-auto w-auto rounded-md p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-100"
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </div>

          <div className="overflow-y-auto px-4 py-3">
            <DialogDescription className="mb-2 text-[12px] text-slate-600 dark:text-gdc-muted">
              Only <span className="font-mono">.tar.gz</span> / <span className="font-mono">.tgz</span> archives are supported. Every
              upload is validated (secret scan, signature, dependency, and license checks) before it can be installed.
            </DialogDescription>

            <input
              type="file"
              accept=".tar.gz,.tgz,application/gzip"
              aria-label="Package archive file"
              data-testid="marketplace-upload-file-input"
              disabled={busy}
              onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
              className="block w-full text-[12px] text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-[12px] file:font-semibold file:text-slate-700 dark:text-slate-200 dark:file:bg-gdc-elevated dark:file:text-slate-100"
            />

            {error ? (
              <p className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-[12px] text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200" data-testid="marketplace-upload-error">
                {error}
              </p>
            ) : null}

            {result ? (
              <div
                className="mt-3 rounded-md border border-slate-200/80 p-3 dark:border-gdc-divider"
                data-testid="marketplace-validate-result"
              >
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className={`inline-flex rounded px-2 py-0.5 text-[11px] font-semibold ${validationStatusBadgeClass(result.status)}`}
                    data-testid="marketplace-validate-status"
                  >
                    {result.status}
                  </span>
                  {result.name ? (
                    <span className="text-[12px] text-slate-700 dark:text-gdc-mutedStrong">
                      {result.name} · {result.vendor ?? '—'} · {result.pack_version ?? '—'}
                    </span>
                  ) : null}
                </div>
                <dl className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <dt className="font-semibold text-slate-500 dark:text-gdc-muted">Signature</dt>
                    <dd className="text-slate-800 dark:text-gdc-foreground">{result.signature_status}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-500 dark:text-gdc-muted">License decision</dt>
                    <dd className="text-slate-800 dark:text-gdc-foreground">{result.license_decision ?? '—'}</dd>
                  </div>
                </dl>
                {result.compatibility_warnings.length > 0 ? (
                  <div className="mt-2 rounded bg-amber-50 p-2 text-[11px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
                    <p className="font-semibold">Compatibility warnings</p>
                    <ul className="list-inside list-disc">
                      {result.compatibility_warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {result.issues.length > 0 ? (
                  <div className="mt-2 rounded bg-slate-50 p-2 text-[11px] text-slate-700 dark:bg-gdc-elevated/60 dark:text-gdc-mutedStrong">
                    <p className="font-semibold">Issues</p>
                    <ul className="list-inside list-disc">
                      {result.issues.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {result.blocked_reasons.length > 0 ? (
                  <div
                    className="mt-2 rounded bg-red-50 p-2 text-[11px] text-red-800 dark:bg-red-500/10 dark:text-red-100"
                    data-testid="marketplace-validate-blocked"
                  >
                    <p className="font-semibold">Blocked</p>
                    <ul className="list-inside list-disc">
                      {result.blocked_reasons.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {mode === 'upgrade' && (impact || impactLoading || impactError) ? (
              <div className="mt-3">
                <MarketplaceUpgradeImpactPanel preview={impact} loading={impactLoading} error={impactError} />
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-200/80 px-4 py-3 dark:border-gdc-divider">
            {!showInstallStep ? (
              <Button
                size="sm"
                onClick={() => void onValidate()}
                disabled={!file || busy || !!error}
                loading={step === 'validating'}
                data-testid="marketplace-upload-validate-button"
                className="rounded-md text-[12px]"
              >
                Validate
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => void onInstall()}
                disabled={blockInstall || busy}
                loading={step === 'installing'}
                title={
                  blockInstall
                    ? mode === 'upgrade'
                      ? 'Impact preview must allow upgrade'
                      : 'Validation must pass before installing'
                    : undefined
                }
                data-testid="marketplace-upload-install-button"
                className="rounded-md text-[12px]"
              >
                {mode === 'upgrade' ? 'Upgrade' : 'Install'}
              </Button>
            )}
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  )
}
