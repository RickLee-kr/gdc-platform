import { AlertTriangle, Download, Package } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  fetchAllRegistryPackages,
  installFromRegistry,
  type RegistryPackageSummary,
} from '../../../api/gdcMarketplaceRegistries'
import type { MarketplacePackageInstallRead } from '../../../api/gdcMarketplace'
import { Button } from '../../ui/button'

export type MarketplaceRegistryBrowseProps = {
  onInstalled: (row: MarketplacePackageInstallRead) => void
}

export function MarketplaceRegistryBrowse({ onInstalled }: MarketplaceRegistryBrowseProps) {
  const [packages, setPackages] = useState<RegistryPackageSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchAllRegistryPackages()
      setPackages(res.packages)
      setUnavailable(Boolean(res.unavailable))
      setUnavailableReason(res.unavailable_reason ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setUnavailable(true)
      setUnavailableReason(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function onInstall(pkg: RegistryPackageSummary) {
    if (!pkg.registry_id) return
    setBusyId(pkg.package_id)
    setError(null)
    try {
      const row = await installFromRegistry(pkg.registry_id, pkg.package_id, pkg.pack_version ?? undefined)
      onInstalled(row)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div
      className="rounded-lg border border-slate-200/80 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card"
      data-testid="marketplace-registry-browse"
    >
      <div className="mb-2 flex items-center gap-2">
        <Package className="h-4 w-4 text-slate-400" aria-hidden />
        <p className="text-[12px] font-semibold text-slate-800 dark:text-gdc-foreground">
          Registry packages
        </p>
      </div>

      {loading ? (
        <p className="text-[11px] text-slate-500" data-testid="marketplace-registry-loading">
          Loading registry catalog…
        </p>
      ) : null}

      {unavailable ? (
        <div
          className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
          data-testid="marketplace-registry-unavailable"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{unavailableReason || 'Registry unavailable or blocked by network policy.'}</span>
        </div>
      ) : null}

      {error ? (
        <p className="mt-2 text-[11px] text-red-700" data-testid="marketplace-registry-error">
          {error}
        </p>
      ) : null}

      {!loading && !unavailable && packages.length === 0 ? (
        <p className="text-[11px] text-slate-500" data-testid="marketplace-registry-empty">
          No enabled registries or packages discovered. Configure registries in Administration.
        </p>
      ) : null}

      {packages.length > 0 ? (
        <ul className="mt-2 space-y-2" data-testid="marketplace-registry-package-list">
          {packages.map((pkg) => (
            <li
              key={`${pkg.registry_id}-${pkg.package_id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-100 px-2 py-1.5 dark:border-gdc-border"
              data-testid={`marketplace-registry-package-${pkg.package_id}`}
            >
              <div>
                <p className="text-[12px] font-medium text-slate-800 dark:text-slate-100">
                  {pkg.name || pkg.package_id}
                </p>
                <p className="text-[10px] text-slate-500">
                  <span data-testid={`marketplace-registry-origin-${pkg.package_id}`}>
                    {pkg.origin || 'Remote Registry'}
                  </span>
                  {pkg.pack_version ? ` · ${pkg.pack_version}` : ''}
                  {pkg.registry_name ? ` · ${pkg.registry_name}` : ''}
                </p>
                {pkg.declared_trust_tier ? (
                  <p className="text-[10px] text-slate-400">
                    Registry-declared trust ({pkg.declared_trust_tier}) is not authoritative
                  </p>
                ) : null}
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={busyId === pkg.package_id || !pkg.registry_id}
                loading={busyId === pkg.package_id}
                data-testid={`marketplace-registry-install-${pkg.package_id}`}
                onClick={() => void onInstall(pkg)}
                className="h-7 rounded-md border-slate-200 px-2 text-[11px]"
              >
                {busyId !== pkg.package_id ? (
                  <Download className="h-3 w-3" aria-hidden />
                ) : null}
                Install
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
