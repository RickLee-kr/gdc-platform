import { Search } from 'lucide-react'
import type { MarketplaceCatalogFilters } from '../../../api/gdcMarketplace'
import { Input } from '../../ui/input'

export type MarketplaceFiltersProps = {
  filters: MarketplaceCatalogFilters
  onChange: (patch: Partial<MarketplaceCatalogFilters>) => void
  trustTiers: string[]
  origins: string[]
}

const selectClass =
  'h-9 rounded-md border border-slate-200 bg-white px-2 text-[12px] font-medium text-slate-700 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100'

export function MarketplaceFilters({ filters, onChange, trustTiers, origins }: MarketplaceFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="marketplace-filters">
      <div className="relative flex-1 min-w-[200px]">
        <Search
          className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
          aria-hidden
        />
        <Input
          type="search"
          value={filters.q ?? ''}
          onChange={(e) => onChange({ q: e.target.value })}
          placeholder="Search vendor, product, or package id…"
          aria-label="Search Marketplace packages"
          data-testid="marketplace-search-input"
          className="h-9 rounded-md border-slate-200 bg-white pl-7 pr-2 text-[12px] text-slate-800 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
        />
      </div>

      <select
        aria-label="Filter by trust tier"
        data-testid="marketplace-filter-trust-tier"
        className={selectClass}
        value={filters.trust_tier ?? ''}
        onChange={(e) => onChange({ trust_tier: e.target.value || undefined })}
      >
        <option value="">All trust tiers</option>
        {trustTiers.map((tier) => (
          <option key={tier} value={tier}>
            {tier}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by origin"
        data-testid="marketplace-filter-origin"
        className={selectClass}
        value={filters.origin ?? ''}
        onChange={(e) => onChange({ origin: e.target.value || undefined })}
      >
        <option value="">All origins</option>
        {origins.map((origin) => (
          <option key={origin} value={origin}>
            {origin}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by installed status"
        data-testid="marketplace-filter-installed"
        className={selectClass}
        value={filters.installed === undefined ? '' : String(filters.installed)}
        onChange={(e) => {
          const v = e.target.value
          onChange({ installed: v === '' ? undefined : v === 'true' })
        }}
      >
        <option value="">Any install status</option>
        <option value="true">Installed</option>
        <option value="false">Not installed</option>
      </select>

      <select
        aria-label="Filter by compatibility"
        data-testid="marketplace-filter-compatibility"
        className={selectClass}
        value={filters.compatibility ?? ''}
        onChange={(e) => onChange({ compatibility: e.target.value || undefined })}
      >
        <option value="">Any compatibility</option>
        <option value="compatible">Compatible</option>
        <option value="warning">Has warnings</option>
      </select>

      <select
        aria-label="Filter by package kind"
        data-testid="marketplace-filter-package-kind"
        className={selectClass}
        value={filters.package_kind ?? ''}
        onChange={(e) => onChange({ package_kind: e.target.value || undefined })}
      >
        <option value="">All package kinds</option>
        <option value="source">Source</option>
        <option value="stream_extension">Stream Extension</option>
      </select>
    </div>
  )
}
