export function formatThroughputEps(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return '0'
  if (value >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (value >= 0.01) return value.toLocaleString(undefined, { maximumFractionDigits: 3 })
  return '<0.01'
}

