import { RUNTIME_MESSAGES } from './runtimeMessages'

export type FrontendHintValidation = {
  validJson: boolean
  hints: string[]
}

function parseObjectJson(raw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw) as unknown
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null
    return v as Record<string, unknown>
  } catch {
    return null
  }
}

function readObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function readStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export function validateSourceSavePayload(sourceSave: string): FrontendHintValidation {
  const hints: string[] = []
  const parsed = parseObjectJson(sourceSave)
  if (!parsed) {
    return { validJson: false, hints: [RUNTIME_MESSAGES.frontendHintSourceInvalidJson] }
  }

  const config = readObj(parsed.config_json)
  const auth = parsed.auth_json
  const baseUrl =
    readStr(parsed.base_url) || readStr(config?.base_url) || readStr(config?.url) || readStr(parsed.url)
  if (!baseUrl) {
    hints.push(RUNTIME_MESSAGES.frontendHintSourceMissingBaseUrl)
  }
  if (parsed.config_json !== undefined && !config) {
    hints.push(RUNTIME_MESSAGES.frontendHintSourceConfigShape)
  }
  if (auth !== undefined && !readObj(auth)) {
    hints.push(RUNTIME_MESSAGES.frontendHintSourceAuthShape)
  }
  if (parsed.config_json === undefined) {
    hints.push(RUNTIME_MESSAGES.frontendHintSourceConfigShape)
  }
  return { validJson: true, hints }
}

export function validateStreamSavePayload(streamSave: string): FrontendHintValidation {
  const hints: string[] = []
  const parsed = parseObjectJson(streamSave)
  if (!parsed) {
    return { validJson: false, hints: [RUNTIME_MESSAGES.frontendHintStreamInvalidJson] }
  }

  const config = readObj(parsed.config_json)
  const method = readStr(parsed.method) || readStr(config?.method)
  const endpoint =
    readStr(parsed.endpoint) || readStr(parsed.path) || readStr(config?.endpoint) || readStr(config?.path)
  const eventArrayPath = readStr(parsed.event_array_path) || readStr(config?.event_array_path)
  const params = parsed.params ?? config?.params
  const body = parsed.body ?? config?.body

  if (!method) {
    hints.push(RUNTIME_MESSAGES.frontendHintStreamMissingMethod)
  }
  if (!endpoint) {
    hints.push(RUNTIME_MESSAGES.frontendHintStreamMissingEndpoint)
  }
  if (!eventArrayPath) {
    hints.push(RUNTIME_MESSAGES.frontendHintStreamEventArrayPath)
  }
  if (params !== undefined && !readObj(params)) {
    hints.push(RUNTIME_MESSAGES.frontendHintStreamParamsShape)
  }
  if (body !== undefined && typeof body !== 'string' && !readObj(body) && !Array.isArray(body) && body !== null) {
    hints.push(RUNTIME_MESSAGES.frontendHintStreamBodyShape)
  }

  return { validJson: true, hints }
}
