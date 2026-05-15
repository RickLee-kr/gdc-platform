/**
 * Optional helpers for API Test page (no demo stream rows — URLs/titles come from stream APIs in-page).
 */

export type ApiTestResponseStats = {
  statusCode: number
  statusText: string
  responseTimeMs: number
  sizeBytes: number
  returnedEvents: number
}

export function streamTitleForBreadcrumb(streamId: string): string {
  if (/^\d+$/.test(streamId)) return `Stream ${streamId}`
  return streamId
}

export function getDefaultMalopUrl(_streamId: string): string {
  return ''
}

const SAMPLE_FIELDS = [
  { severity: 'HIGH', status: 'open', title: 'Suspicious PowerShell execution' },
  { severity: 'MEDIUM', status: 'open', title: 'Unusual outbound DNS' },
  { severity: 'LOW', status: 'closed', title: 'Policy violation: USB mount' },
] as const

function buildMalopItem(index: number): Record<string, unknown> {
  const rot = SAMPLE_FIELDS[index % SAMPLE_FIELDS.length]
  return {
    id: `malop-${String(index + 1).padStart(5, '0')}`,
    severity: rot.severity,
    status: rot.status,
    title: `${rot.title} (#${index + 1})`,
    machine_name: `host-${(index % 42) + 1}.corp.example`,
    user_name: index % 5 === 0 ? 'SYSTEM' : `user${(index % 12) + 1}`,
    detection_time: new Date(Date.UTC(2026, 4, 8, 10, 14, index % 60)).toISOString(),
    raw_score: 0.72 + (index % 20) * 0.01,
    classification: index % 3 === 0 ? 'malware' : 'anomaly',
    metadata: {
      process_path: 'C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe',
      parent_process: 'explorer.exe',
    },
  }
}

/** Full mock JSON body (generated once). */
export function buildMockMalopResponse(eventCount = 500): Record<string, unknown> {
  const items = Array.from({ length: eventCount }, (_, i) => buildMalopItem(i))
  return {
    data: {
      items,
      meta: {
        total: eventCount,
        page: 1,
        page_size: eventCount,
      },
    },
    status: 'success',
  }
}

export const MOCK_API_STATS: ApiTestResponseStats = {
  statusCode: 200,
  statusText: 'OK',
  responseTimeMs: 842,
  sizeBytes: 524_800,
  /** Matches generated item array length in default mock body. */
  returnedEvents: 500,
}

export const DEFAULT_EVENT_PATH = '$.data.items'
