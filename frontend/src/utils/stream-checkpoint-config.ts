import { hasExplicitCheckpointVariable } from '../components/streams/incremental-fetch-compatibility'

export function hasStreamCheckpointConfigured(input: {
  checkpointCursorPath?: string
  checkpointSecondaryPath?: string
  requestBodyText?: string
  queryParams?: Record<string, string>
  runtimeCheckpointType?: string | null
}): boolean {
  if ((input.checkpointCursorPath ?? '').trim().length > 0) return true
  if ((input.checkpointSecondaryPath ?? '').trim().length > 0) return true
  const paramText = Object.entries(input.queryParams ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
  const combined = [input.requestBodyText ?? '', paramText].filter(Boolean).join('\n')
  if (hasExplicitCheckpointVariable(combined)) return true
  const ckType = (input.runtimeCheckpointType ?? '').trim().toUpperCase()
  if (ckType && ckType !== 'NONE') return true
  return false
}
