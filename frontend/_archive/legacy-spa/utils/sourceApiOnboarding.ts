import type { PersistedIds } from './runtimeState'
import { validateSourceSavePayload, validateStreamSavePayload } from './runtimeConfigValidation'
import { RUNTIME_MESSAGES } from './runtimeMessages'

export type SourceApiOnboardingInput = {
  ids: PersistedIds
  sourceSave: string
  streamSave: string
  apiTestSource: string
  apiTestStream: string
  ctlRawResponse: string
  ctlEventArrayPath: string
  /** True when last API test response included a raw_response field. */
  apiTestRawResponseAvailable: boolean
  mappingRawResponseJson: string
}

export type SourceApiChecklistRow = {
  key: string
  label: string
  ok: boolean
}

function parseObject(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s) as unknown
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null
    return v as Record<string, unknown>
  } catch {
    return null
  }
}

function nonEmptyConfigJson(s: string): boolean {
  const o = parseObject(s.trim() || '{}')
  return !!o && Object.keys(o).length > 0
}

function rawPayloadAvailable(p: SourceApiOnboardingInput): boolean {
  if (p.apiTestRawResponseAvailable) return true
  const raw = parseObject(p.ctlRawResponse.trim() || '{}')
  return !!raw && Object.keys(raw).length > 0
}

function eventArrayPathSatisfied(p: SourceApiOnboardingInput): boolean {
  if (p.ctlEventArrayPath.trim().length > 0) return true
  const stream = parseObject(p.apiTestStream.trim() || '{}')
  const v = stream?.event_array_path
  return typeof v === 'string' && v.trim().length > 0
}

/** Compact checklist for HTTP API source → API Test → mapping handoff. */
export function computeSourceApiOnboardingChecklist(p: SourceApiOnboardingInput): SourceApiChecklistRow[] {
  const connectorOk = Boolean(p.ids.connectorId.trim())
  const sourceValidation = validateSourceSavePayload(p.sourceSave)
  const streamValidation = validateStreamSavePayload(p.streamSave)
  const sourceJsonOk = sourceValidation.validJson && sourceValidation.hints.length === 0 && nonEmptyConfigJson(p.sourceSave)
  const streamJsonOk = streamValidation.validJson && streamValidation.hints.filter((h) => h !== RUNTIME_MESSAGES.frontendHintStreamEventArrayPath).length === 0 && nonEmptyConfigJson(p.streamSave)
  const apiSourceOk = !!parseObject(p.apiTestSource.trim() || '{}')
  const apiStreamOk = !!parseObject(p.apiTestStream.trim() || '{}')
  const apiTestReady = apiSourceOk && apiStreamOk

  const rawOk = rawPayloadAvailable(p)
  const pathOk = eventArrayPathSatisfied(p)
  const mappingRawOk = nonEmptyConfigJson(p.mappingRawResponseJson)

  const readyMapping =
    connectorOk &&
    Boolean(p.ids.sourceId.trim()) &&
    Boolean(p.ids.streamId.trim()) &&
    rawOk &&
    pathOk &&
    mappingRawOk

  return [
    { key: 'connector', label: RUNTIME_MESSAGES.sourceApiCheckConnectorSelected, ok: connectorOk },
    { key: 'sourceCfg', label: RUNTIME_MESSAGES.sourceApiCheckSourceConfigPresent, ok: sourceJsonOk },
    { key: 'streamCfg', label: RUNTIME_MESSAGES.sourceApiCheckStreamConfigPresent, ok: streamJsonOk },
    { key: 'apiTestReady', label: RUNTIME_MESSAGES.sourceApiCheckApiTestReady, ok: apiTestReady },
    { key: 'raw', label: RUNTIME_MESSAGES.sourceApiCheckRawAvailable, ok: rawOk },
    { key: 'eventPath', label: RUNTIME_MESSAGES.sourceApiCheckEventArrayPath, ok: pathOk },
    { key: 'mapping', label: RUNTIME_MESSAGES.sourceApiCheckReadyForMapping, ok: readyMapping },
  ]
}
