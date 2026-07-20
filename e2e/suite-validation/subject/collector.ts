export type CollectorEvent = {
  correlation_id: string
  route_key: string
  destination_type: string
  payload: Record<string, unknown>
}

const store: CollectorEvent[] = []

export function resetCollector(): void {
  store.length = 0
}

export function receiveToCollector(ev: CollectorEvent): void {
  store.push(ev)
}

export function listCollector(correlationId?: string): CollectorEvent[] {
  if (!correlationId) return [...store]
  return store.filter((e) => e.correlation_id === correlationId)
}

export function assertCollectorCorrelation(opts: {
  correlation_id: string
  events: CollectorEvent[]
}): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  for (const e of opts.events) {
    if (e.correlation_id !== opts.correlation_id) {
      errors.push(`correlation_mismatch:${e.correlation_id}`)
    }
  }
  return { ok: errors.length === 0, errors }
}
