import type { MarketplacePackageCard } from '../../../api/gdcMarketplace'

export function trustTierBadgeClass(tier: string): string {
  switch (tier) {
    case 'Official':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-100'
    case 'Community':
      return 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-100'
    case 'Local Draft':
    case 'Imported Draft':
      return 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-100'
    case 'Imported':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-100'
    case 'Private':
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-200'
  }
}

export function validationStatusBadgeClass(status: string): string {
  switch (status) {
    case 'PASS':
    case 'VALID':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-100'
    case 'WARNING':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-100'
    case 'FAIL':
    case 'BLOCKED':
      return 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-100'
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-200'
  }
}

export function hasCompatibilityWarning(card: MarketplacePackageCard): boolean {
  return card.compatibility.warnings.length > 0
}

export function installStateLabel(card: MarketplacePackageCard): string {
  if (!card.installed) return 'Not installed'
  if (card.update_available) return 'Update available'
  return 'Installed'
}
