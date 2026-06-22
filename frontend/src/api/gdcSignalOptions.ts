import type { GdcJsonFetchInit } from '../api'

export type GdcSignalOptions = {
  signal?: AbortSignal
}

export function readJsonWithSignal(base: GdcJsonFetchInit, signal?: AbortSignal): GdcJsonFetchInit {
  if (!signal) return base
  return { ...base, signal }
}
