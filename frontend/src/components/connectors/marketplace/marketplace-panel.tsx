import { AlertTriangle, CheckCircle2, Loader2, Sparkles, Upload } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchMarketplaceCapabilities,
  fetchMarketplaceCatalog,
  rollbackPackage,
  uninstallPackage,
  MarketplaceApiError,
  type MarketplaceCapabilitiesRead,
  type MarketplaceCatalogFilters,
  type MarketplacePackageCard,
  type MarketplacePackageInstallRead,
} from '../../../api/gdcMarketplace'
import {
  hasCompatibilityWarning,
  installStateLabel,
  trustTierBadgeClass,
  validationStatusBadgeClass,
} from './marketplace-badges'
import { MarketplaceAiBuilder } from './marketplace-ai-builder'
import { MarketplaceFilters } from './marketplace-filters'
import { MarketplaceGitInstall } from './marketplace-git-install'
import { MarketplacePackageDetail, type MarketplaceActionKind } from './marketplace-package-detail'
import { MarketplaceUploadDialog } from './marketplace-upload-dialog'

type ActionBanner = { kind: 'success' | 'error' | 'blocked'; text: string } | null

export function MarketplacePanel() {
  const [filters, setFilters] = useState<MarketplaceCatalogFilters>({})
  const [cards, setCards] = useState<MarketplacePackageCard[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [capabilities, setCapabilities] = useState<MarketplaceCapabilitiesRead | null>(null)

  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<MarketplaceActionKind>(null)
  const [justInstalledId, setJustInstalledId] = useState<string | null>(null)
  const [banner, setBanner] = useState<ActionBanner>(null)

  const [uploadMode, setUploadMode] = useState<'install' | 'upgrade' | null>(null)
  const [uploadPackageId, setUploadPackageId] = useState<string | undefined>(undefined)
  const [showAiBuilder, setShowAiBuilder] = useState(false)

  const load = useCallback(async (nextFilters: MarketplaceCatalogFilters) => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetchMarketplaceCatalog(nextFilters)
      setCards(res.packages)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(filters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.trust_tier, filters.origin, filters.installed, filters.compatibility, filters.package_kind])

  useEffect(() => {
    void fetchMarketplaceCapabilities().then(setCapabilities)
  }, [])

  const onFiltersChange = useCallback((patch: Partial<MarketplaceCatalogFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }))
  }, [])

  const trustTiers = useMemo(() => {
    const set = new Set<string>()
    for (const c of cards) set.add(c.trust_tier)
    return Array.from(set).sort()
  }, [cards])

  const origins = useMemo(() => {
    const set = new Set<string>()
    for (const c of cards) if (c.origin) set.add(c.origin)
    return Array.from(set).sort()
  }, [cards])

  const selectedCard = useMemo(
    () => (selectedPackageId ? (cards.find((c) => c.package_id === selectedPackageId) ?? null) : null),
    [cards, selectedPackageId],
  )

  function refreshAfterMutation(packageId?: string) {
    void load(filters)
    if (packageId) setJustInstalledId(packageId)
  }

  function onInstalled(row: MarketplacePackageInstallRead) {
    setUploadMode(null)
    setUploadPackageId(undefined)
    setBanner({ kind: 'success', text: `Installed ${row.package_id} (${row.pack_version}).` })
    setSelectedPackageId(row.package_id)
    refreshAfterMutation(row.package_id)
  }

  function onUpgraded(row: MarketplacePackageInstallRead) {
    setUploadMode(null)
    setUploadPackageId(undefined)
    setBanner({ kind: 'success', text: `Upgraded ${row.package_id} to ${row.pack_version}.` })
    refreshAfterMutation()
  }

  async function onRollback(packageId: string) {
    setBusyAction('rollback')
    setBanner(null)
    try {
      const row = await rollbackPackage(packageId)
      setBanner({ kind: 'success', text: `Rolled back ${row.package_id} to ${row.pack_version}.` })
      refreshAfterMutation()
    } catch (e) {
      setBanner({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusyAction(null)
    }
  }

  async function onUninstall(packageId: string) {
    const ok = window.confirm(`Uninstall package "${packageId}"?`)
    if (!ok) return
    setBusyAction('uninstall')
    setBanner(null)
    try {
      await uninstallPackage(packageId)
      setBanner({ kind: 'success', text: `Uninstalled ${packageId}.` })
      setSelectedPackageId(null)
      refreshAfterMutation()
    } catch (e) {
      if (e instanceof MarketplaceApiError && e.errorCode === 'DEPENDENCY_PROTECTED') {
        setBanner({ kind: 'blocked', text: e.message })
      } else {
        setBanner({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
      }
    } finally {
      setBusyAction(null)
    }
  }

  const showEmpty = !loading && !loadError && cards.length === 0

  return (
    <div className="flex w-full min-w-0 flex-col gap-4" data-testid="marketplace-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MarketplaceFilters filters={filters} onChange={onFiltersChange} trustTiers={trustTiers} origins={origins} />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setUploadMode('install')
              setUploadPackageId(undefined)
            }}
            data-testid="marketplace-open-upload"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white hover:bg-violet-700"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden />
            Upload Package
          </button>
          <button
            type="button"
            onClick={() => setShowAiBuilder(true)}
            data-testid="marketplace-open-ai-builder"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-800 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
          >
            <Sparkles className="h-3.5 w-3.5 text-violet-500" aria-hidden />
            Create with AI
          </button>
        </div>
      </div>

      <MarketplaceGitInstall capabilities={capabilities} />

      {banner ? (
        <div
          className={`flex items-center gap-2 rounded-md border p-2 text-[12px] ${
            banner.kind === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100'
              : banner.kind === 'blocked'
                ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100'
                : 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200'
          }`}
          data-testid={
            banner.kind === 'success'
              ? 'marketplace-action-success'
              : banner.kind === 'blocked'
                ? 'marketplace-action-blocked'
                : 'marketplace-action-error'
          }
        >
          {banner.kind === 'success' ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          )}
          {banner.text}
        </div>
      ) : null}

      {loadError ? (
        <div
          className="rounded-md border border-red-200 bg-red-50 p-2 text-[12px] text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"
          data-testid="marketplace-load-error"
        >
          {loadError}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card">
        {loading ? (
          <div className="flex items-center gap-2 px-6 py-10 text-[12px] text-slate-500 dark:text-gdc-muted" data-testid="marketplace-loading">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Loading Marketplace catalog…
          </div>
        ) : showEmpty ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center" data-testid="marketplace-empty">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">No packages match these filters</p>
            <p className="max-w-md text-[12px] text-slate-600 dark:text-gdc-muted">
              Try clearing filters, or upload a package archive to add one.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((card) => (
              <button
                key={card.package_id}
                type="button"
                onClick={() => setSelectedPackageId(card.package_id)}
                data-testid={`marketplace-card-${card.package_id}`}
                className="flex flex-col gap-1.5 rounded-lg border border-slate-200/80 bg-white p-3 text-left transition-colors hover:border-violet-300 hover:bg-violet-50/30 dark:border-gdc-divider dark:bg-gdc-elevated/30 dark:hover:bg-gdc-elevated/60"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-semibold text-slate-900 dark:text-gdc-foreground">{card.name}</p>
                    <p className="text-[11px] text-slate-500 dark:text-gdc-muted">{card.vendor}</p>
                  </div>
                  <span
                    className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${trustTierBadgeClass(card.trust_tier)}`}
                    data-testid={`marketplace-card-trust-${card.package_id}`}
                  >
                    {card.trust_tier}
                  </span>
                </div>
                {card.description ? (
                  <p className="line-clamp-2 text-[11px] text-slate-600 dark:text-gdc-muted">{card.description}</p>
                ) : null}
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600 dark:bg-slate-500/15 dark:text-slate-200">
                    {card.origin ?? 'unknown origin'}
                  </span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-600 dark:bg-slate-500/15 dark:text-slate-200">
                    v{card.pack_version ?? '—'}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 font-semibold ${validationStatusBadgeClass(card.validation_status)}`}
                  >
                    {card.validation_status}
                  </span>
                  {card.license.declared ? (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600 dark:bg-slate-500/15 dark:text-slate-200">
                      {card.license.declared}
                    </span>
                  ) : null}
                  {hasCompatibilityWarning(card) ? (
                    <span
                      className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-100"
                      data-testid={`marketplace-card-compat-warning-${card.package_id}`}
                    >
                      <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
                      Warning
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px]">
                  <span
                    className={`rounded px-1.5 py-0.5 font-semibold ${
                      card.installed
                        ? card.update_available
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-100'
                          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-100'
                        : 'bg-slate-100 text-slate-500 dark:bg-slate-500/15 dark:text-slate-300'
                    }`}
                    data-testid={`marketplace-card-install-state-${card.package_id}`}
                  >
                    {installStateLabel(card)}
                  </span>
                  {card.stream_extensions.length > 0 ? (
                    <span className="text-slate-500 dark:text-gdc-muted">{card.stream_extensions.length} extension(s)</span>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedCard ? (
        <MarketplacePackageDetail
          card={selectedCard}
          busyAction={busyAction}
          justInstalled={justInstalledId === selectedCard.package_id}
          onClose={() => {
            setSelectedPackageId(null)
            setJustInstalledId(null)
          }}
          onInstallRequested={() => {
            setUploadMode('install')
            setUploadPackageId(undefined)
          }}
          onUpgradeRequested={() => {
            setUploadMode('upgrade')
            setUploadPackageId(selectedCard.package_id)
          }}
          onRollback={() => void onRollback(selectedCard.package_id)}
          onUninstall={() => void onUninstall(selectedCard.package_id)}
        />
      ) : null}

      {uploadMode ? (
        <MarketplaceUploadDialog
          mode={uploadMode}
          packageId={uploadPackageId}
          onClose={() => {
            setUploadMode(null)
            setUploadPackageId(undefined)
          }}
          onCompleted={uploadMode === 'upgrade' ? onUpgraded : onInstalled}
        />
      ) : null}

      {showAiBuilder ? <MarketplaceAiBuilder capabilities={capabilities} onClose={() => setShowAiBuilder(false)} /> : null}
    </div>
  )
}
