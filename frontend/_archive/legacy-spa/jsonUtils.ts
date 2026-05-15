import type { JsonValue } from './runtimeTypes'
import {
  formatExpectJsonArray,
  formatExpectJsonArrayItemObject,
  formatExpectJsonObject,
  formatJsonArrayParseFailure,
  formatJsonObjectParseFailure,
  formatJsonValueParseFailure,
} from './utils/runtimeMessages'

export function prettyJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2)
}

export function pickInitialRawResponseFromSourceConfig(sourceConfig: unknown): unknown {
  if (sourceConfig !== null && typeof sourceConfig === 'object' && !Array.isArray(sourceConfig)) {
    const sc = sourceConfig as Record<string, unknown>
    if (sc.sample_payload !== undefined) {
      return sc.sample_payload
    }
    if (sc.raw_sample_payload !== undefined) {
      return sc.raw_sample_payload
    }
    if (sc.example_payload !== undefined) {
      return sc.example_payload
    }
  }
  return {}
}

export function parseJsonObject(raw: string, label: string): JsonValue {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(formatJsonObjectParseFailure(label, (error as Error).message))
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(formatExpectJsonObject(label))
  }
  return parsed as JsonValue
}

export function parseJsonValue(raw: string, label: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed) {
    return {}
  }
  try {
    return JSON.parse(trimmed) as unknown
  } catch (error) {
    throw new Error(formatJsonValueParseFailure(label, (error as Error).message))
  }
}

export function parseFieldMappingsStrStr(raw: string, label: string): Record<string, string> {
  const o = parseJsonObject(raw, label)
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(o)) {
    out[k] = typeof v === 'string' ? v : JSON.stringify(v)
  }
  return out
}

export function parseEventsArray(raw: string, label: string): JsonValue[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(formatJsonArrayParseFailure(label, (error as Error).message))
  }
  if (!Array.isArray(parsed)) {
    throw new Error(formatExpectJsonArray(label))
  }
  return parsed.map((item, i) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(formatExpectJsonArrayItemObject(label, i))
    }
    return item as JsonValue
  })
}
