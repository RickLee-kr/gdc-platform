import { GitBranch } from 'lucide-react'
import { useState } from 'react'
import { installFromGitUrl } from '../../../api/gdcMarketplaceRegistries'
import type { MarketplaceCapabilitiesRead, MarketplacePackageInstallRead } from '../../../api/gdcMarketplace'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'

export type MarketplaceGitInstallProps = {
  capabilities: MarketplaceCapabilitiesRead | null
  onInstalled?: (row: MarketplacePackageInstallRead) => void
}

export function MarketplaceGitInstall({ capabilities, onInstalled }: MarketplaceGitInstallProps) {
  const enabled = Boolean(capabilities?.git_acquisition)
  const reason =
    capabilities?.git_acquisition_reason ??
    'Git acquisition accepts HTTPS URLs to .tar.gz / .tgz package archives with SSRF controls.'
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onInstall() {
    if (!enabled || !url.trim()) return
    setBusy(true)
    setError(null)
    try {
      const row = await installFromGitUrl(url.trim())
      onInstalled?.(row)
      setUrl('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="rounded-lg border border-slate-200/80 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card"
      data-testid="marketplace-git-install"
    >
      <div className="flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-slate-400" aria-hidden />
        <div>
          <p className="text-[12px] font-semibold text-slate-800 dark:text-gdc-foreground">Install from Git</p>
          <p className="text-[11px] text-slate-500 dark:text-gdc-muted" data-testid="marketplace-git-install-reason">
            {reason}
          </p>
        </div>
      </div>
      {enabled ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/org/pkg/releases/download/v1/pkg.tar.gz"
            aria-label="Git package URL"
            data-testid="marketplace-git-url-input"
            containerClassName="min-w-[240px] flex-1"
            className="h-8 rounded-md px-2 text-[12px] dark:bg-gdc-elevated"
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || !url.trim()}
            loading={busy}
            onClick={() => void onInstall()}
            data-testid="marketplace-git-install-button"
            className="rounded-md border-slate-800 bg-slate-900 text-[12px] text-white dark:border-slate-200 dark:bg-slate-100 dark:text-slate-900"
          >
            Install from Git
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            disabled
            aria-disabled="true"
            title={reason}
            data-testid="marketplace-git-install-button"
            className="rounded-md border-slate-200 bg-slate-100 text-[12px] text-slate-400 dark:border-gdc-border dark:bg-gdc-elevated dark:text-gdc-muted"
          >
            Install from Git
          </Button>
        </div>
      )}
      {error ? (
        <p className="mt-2 text-[11px] text-red-700" data-testid="marketplace-git-install-error">
          {error}
        </p>
      ) : null}
    </div>
  )
}
