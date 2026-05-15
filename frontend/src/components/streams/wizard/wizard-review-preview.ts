/**
 * Pure helpers for the Stream wizard Review step — mirrors Mapping + Enrichment preview semantics.
 */

import { resolveJsonPath } from '../mapping-jsonpath'
import type { WizardEnrichmentRow, WizardMappingRow } from './wizard-state'

function isNowUtcTemplate(s: string): boolean {
  return s.trim().replace(/\s/g, '').toLowerCase() === '{{now_utc}}'
}

function isTemplateValue(s: string): boolean {
  const t = s.trim()
  return t.startsWith('{{') && t.includes('}}')
}

function resolveEnrichmentPreviewValue(raw: string): unknown {
  if (isNowUtcTemplate(raw)) return new Date().toISOString()
  return raw
}

export function enrichmentValueKind(raw: string): 'static' | 'auto' {
  const v = raw.trim()
  if (!v) return 'static'
  if (isNowUtcTemplate(v)) return 'auto'
  if (isTemplateValue(v)) return 'auto'
  return 'static'
}

export function buildMappedBaseFromState(
  sampleEvent: Record<string, unknown> | null,
  mapping: WizardMappingRow[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!sampleEvent) return out
  for (const row of mapping) {
    const path = row.sourceJsonPath.trim()
    const key = row.outputField.trim()
    if (!path || !key) continue
    out[key] = resolveJsonPath(sampleEvent, path)
  }
  return out
}

/** Matches runtime `KEEP_EXISTING`: enrichment does not replace keys already present after mapping. */
export function applyEnrichmentKeepExisting(
  mapped: Record<string, unknown>,
  rows: WizardEnrichmentRow[],
): Record<string, unknown> {
  const next = { ...mapped }
  for (const row of rows) {
    const k = row.fieldName.trim()
    if (!k) continue
    if (Object.prototype.hasOwnProperty.call(next, k)) continue
    next[k] = resolveEnrichmentPreviewValue(row.value)
  }
  return next
}

export function countDuplicateEnrichmentKeys(rows: WizardEnrichmentRow[]): number {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const k = row.fieldName.trim().toLowerCase()
    if (!k) continue
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  let dups = 0
  for (const n of counts.values()) {
    if (n > 1) dups += n - 1
  }
  return dups
}
