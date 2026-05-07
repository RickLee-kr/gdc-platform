import { getEffectiveApiBaseUrl } from './localPreferences'
import { prettyJson } from './jsonUtils'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

/** Resolved origin for outbound requests (respects optional localStorage override). */
export function resolveApiBaseUrl(): string {
  return getEffectiveApiBaseUrl(API_BASE_URL)
}

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const base = resolveApiBaseUrl()
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const raw = await response.text()
  const body = raw ? (JSON.parse(raw) as unknown) : null
  if (!response.ok) {
    throw new Error(prettyJson(body))
  }
  return body as T
}
