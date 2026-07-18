export type RouteProcessingConcern = 'transform' | 'protection' | 'classification' | 'policy'

export type RouteProcessingEffectiveRow = {
  concern: RouteProcessingConcern
  label: string
  status: 'Inherited' | 'Overridden' | 'Mixed' | 'Unknown'
  summary: string
}

const CONCERN_LABEL: Record<RouteProcessingConcern, string> = {
  transform: 'Transform',
  protection: 'Protection',
  classification: 'Classification',
  policy: 'Policy',
}

/** Builds Inherit / Override / Effective rows for route processing concerns. */
export function buildRouteProcessingEffectivePreview(input: {
  transform?: string | null
  protection?: string | null
  classification?: string | null
  policy?: string | null
}): RouteProcessingEffectiveRow[] {
  const concerns: RouteProcessingConcern[] = ['transform', 'protection', 'classification', 'policy']
  return concerns.map((concern) => {
    const raw = input[concern]
    const status =
      raw === 'Inherited' || raw === 'Overridden' || raw === 'Mixed' ? raw : ('Unknown' as const)
    const summary =
      status === 'Inherited'
        ? 'Uses Shared (global) processing for this concern.'
        : status === 'Overridden'
          ? 'Route override is active; Shared baseline is not applied as-is.'
          : status === 'Mixed'
            ? 'Some fields inherit Shared; others are overridden on this route.'
            : 'Effective processing status is unavailable.'
    return {
      concern,
      label: CONCERN_LABEL[concern],
      status,
      summary,
    }
  })
}
