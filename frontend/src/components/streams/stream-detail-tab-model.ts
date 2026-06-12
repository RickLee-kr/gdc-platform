/** Stream runtime detail tabs — Overview / Metrics / Events / Schema / Violations / Audit. */

export const STREAM_DETAIL_TABS = ['overview', 'metrics', 'events', 'schema', 'violations', 'audit'] as const
export type StreamDetailTab = (typeof STREAM_DETAIL_TABS)[number]

export const STREAM_DETAIL_TAB_DEFS: ReadonlyArray<{ key: StreamDetailTab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'metrics', label: 'Metrics' },
  { key: 'events', label: 'Events' },
  { key: 'schema', label: 'Schema' },
  { key: 'violations', label: 'Violations' },
  { key: 'audit', label: 'Audit' },
]

const LEGACY_TAB_MAP: Record<string, StreamDetailTab> = {
  delivery: 'metrics',
  issues: 'violations',
  settings: 'audit',
}

export function parseStreamDetailTab(raw: string | null | undefined): StreamDetailTab {
  if (raw == null || raw === '' || raw === 'overview') return 'overview'
  if (raw in LEGACY_TAB_MAP) return LEGACY_TAB_MAP[raw]!
  if (STREAM_DETAIL_TABS.includes(raw as StreamDetailTab)) return raw as StreamDetailTab
  return 'overview'
}
