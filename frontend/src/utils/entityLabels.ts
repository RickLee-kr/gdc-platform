/** Display labels for shell breadcrumbs and headers (API name with id fallback). */

export function formatStreamLabel(streamId: string, name?: string | null): string {
  const n = (name ?? '').trim()
  if (n) return n
  if (/^\d+$/.test(streamId)) return `Stream ${streamId}`
  return streamId
}

export function formatConnectorLabel(connectorId: string, name?: string | null): string {
  const n = (name ?? '').trim()
  if (n) return n
  if (/^\d+$/.test(connectorId)) return `Connector ${connectorId}`
  return connectorId
}

export function formatDestinationLabel(destinationId: string, name?: string | null): string {
  const n = (name ?? '').trim()
  if (n) return n
  if (/^\d+$/.test(destinationId)) return `Destination ${destinationId}`
  return destinationId
}

export function formatRouteLabel(routeId: string, name?: string | null): string {
  const n = (name ?? '').trim()
  if (n) return n
  if (/^\d+$/.test(routeId)) return `Route ${routeId}`
  return routeId
}

/** @deprecated Use formatStreamLabel — kept for call-site migration. */
export function streamTitleForBreadcrumb(streamId: string, name?: string | null): string {
  return formatStreamLabel(streamId, name)
}
