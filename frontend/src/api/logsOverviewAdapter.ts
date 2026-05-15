import type { LogExplorerRow } from '../components/logs/logs-types'

/** Level counts over the currently loaded log rows. */
export function logsOverviewCounts(rows: readonly LogExplorerRow[] | null | undefined): {
  total: number
  errors: number
  warnings: number
  info: number
  debug: number
} {
  if (rows == null || rows.length === 0) {
    return { total: 0, errors: 0, warnings: 0, info: 0, debug: 0 }
  }
  let errors = 0
  let warnings = 0
  let info = 0
  let debug = 0
  for (const r of rows) {
    if (r.level === 'ERROR') errors += 1
    else if (r.level === 'WARN') warnings += 1
    else if (r.level === 'DEBUG') debug += 1
    else info += 1
  }
  return { total: rows.length, errors, warnings, info, debug }
}
