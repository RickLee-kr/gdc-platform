import type { RuntimeLogSearchItem } from '../api/types/gdcApi'

export type AutoProtectActivityEntry = {
  id: number
  timeIso: string
  fieldPath: string
  protectionMode: string
}

const AUTO_PROTECT_MESSAGE_RE = /^Auto protect applied: (.+?) \((.+)\)$/

export function parseAutoProtectActivityFromLog(log: RuntimeLogSearchItem): AutoProtectActivityEntry | null {
  if (log.stage !== 'schema_drift_policy_auto_protect_applied') return null
  const match = log.message.match(AUTO_PROTECT_MESSAGE_RE)
  if (!match) return null
  return {
    id: log.id,
    timeIso: log.created_at,
    fieldPath: match[1].trim(),
    protectionMode: match[2].trim(),
  }
}

export function parseAutoProtectActivityLogs(logs: readonly RuntimeLogSearchItem[]): AutoProtectActivityEntry[] {
  const entries: AutoProtectActivityEntry[] = []
  for (const log of logs) {
    const parsed = parseAutoProtectActivityFromLog(log)
    if (parsed) entries.push(parsed)
  }
  return entries
}

export function formatAutoProtectActivityTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    return iso
  }
}
