import { Archive } from 'lucide-react'
import { useState } from 'react'
import { installOfflineSignedBundle } from '../../../api/gdcMarketplaceRegistries'
import type { MarketplacePackageInstallRead } from '../../../api/gdcMarketplace'

export type MarketplaceOfflineBundleProps = {
  onInstalled: (row: MarketplacePackageInstallRead) => void
}

export function MarketplaceOfflineBundle({ onInstalled }: MarketplaceOfflineBundleProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onFile(file: File | null) {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const row = await installOfflineSignedBundle(file)
      onInstalled(row)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200/80 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card"
      data-testid="marketplace-offline-bundle"
    >
      <div className="flex items-center gap-2">
        <Archive className="h-4 w-4 text-slate-400" aria-hidden />
        <div>
          <p className="text-[12px] font-semibold text-slate-800 dark:text-gdc-foreground">
            Offline signed bundle
          </p>
          <p className="text-[11px] text-slate-500 dark:text-gdc-muted">
            Import a signed .tar.gz without network access. Invalid signatures are blocked.
          </p>
        </div>
      </div>
      <label className="inline-flex h-8 cursor-pointer items-center rounded-md border border-slate-200 bg-white px-3 text-[12px] font-semibold dark:border-gdc-border dark:bg-gdc-elevated">
        {busy ? 'Installing…' : 'Choose bundle'}
        <input
          type="file"
          accept=".tar.gz,.tgz,application/gzip"
          className="sr-only"
          data-testid="marketplace-offline-bundle-input"
          disabled={busy}
          onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
        />
      </label>
      {error ? (
        <p className="w-full text-[11px] text-red-700" data-testid="marketplace-offline-bundle-error">
          {error}
        </p>
      ) : null}
    </div>
  )
}
