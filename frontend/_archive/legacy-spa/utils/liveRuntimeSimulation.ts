import type { PersistedIds } from './runtimeState'

export type LiveSimulationPresetKey = 'lowTraffic' | 'degradedRoute' | 'rateLimitedSource' | 'recoveryMode'
export type LiveRuntimeStatus = 'RUNNING' | 'DEGRADED' | 'RATE_LIMITED_SOURCE' | 'RATE_LIMITED_DESTINATION'

export type LiveSimulationPreset = {
  key: LiveSimulationPresetKey
  label: string
  description: string
}

export type LiveSimulationState = {
  tick: number
  timestampMs: number
  totalEvents: number
  status: LiveRuntimeStatus
  eps: number
  retryBursts: number
  destinationDegradationCount: number
}

export type SimulatedRuntimeEvent = {
  id: number
  created_at: string
  stream_id: number
  route_id: number
  destination_id: number
  stage: string
  level: string
  status: string
  message: string
  error_code?: string
  payload_sample?: Record<string, unknown>
}

export const LIVE_SIMULATION_PRESETS: LiveSimulationPreset[] = [
  { key: 'lowTraffic', label: 'Low traffic', description: 'Low EPS with mostly healthy delivery.' },
  { key: 'degradedRoute', label: 'Degraded route', description: 'Frequent route_send_failed and retry bursts.' },
  { key: 'rateLimitedSource', label: 'Rate-limited source', description: 'Frequent source_rate_limited transitions.' },
  { key: 'recoveryMode', label: 'Recovery mode', description: 'Starts degraded and gradually recovers to RUNNING.' },
]

export function createInitialSimulationState(): LiveSimulationState {
  return {
    tick: 0,
    timestampMs: Date.now(),
    totalEvents: 0,
    status: 'RUNNING',
    eps: 0,
    retryBursts: 0,
    destinationDegradationCount: 0,
  }
}

export function generateSimulationTick(
  prev: LiveSimulationState,
  preset: LiveSimulationPresetKey,
  ids: PersistedIds,
): { next: LiveSimulationState; events: SimulatedRuntimeEvent[] } {
  const tick = prev.tick + 1
  const nextTimestamp = prev.timestampMs + 2000
  const streamId = toNumber(ids.streamId, 1000)
  const routeId = toNumber(ids.routeId, 2000)
  const destinationId = toNumber(ids.destinationId, 3000)

  const stages = chooseStagesForTick(tick, preset)
  const events = stages.map((stage, idx) => {
    const eventStatus = stageToEventStatus(stage)
    return {
      id: prev.totalEvents + idx + 1,
      created_at: new Date(nextTimestamp + idx * 250).toISOString(),
      stream_id: streamId,
      route_id: routeId,
      destination_id: destinationId,
      stage,
      level: stage.includes('failed') ? 'ERROR' : stage.includes('rate_limited') ? 'WARN' : 'INFO',
      status: eventStatus,
      message: stageToMessage(stage, tick),
      error_code: stage.includes('failed') ? 'SIMULATED_TRANSIENT_FAILURE' : undefined,
      payload_sample: {
        sequence: prev.totalEvents + idx + 1,
        simulated: true,
        preset,
      },
    }
  })

  const status = deriveRuntimeStatus(tick, preset)
  const eps = preset === 'lowTraffic' ? 2 + (tick % 2) : preset === 'degradedRoute' ? 8 + (tick % 4) : 6 + (tick % 3)
  const retryBursts = prev.retryBursts + stages.filter((stage) => stage === 'route_retry_success').length
  const destinationDegradationCount =
    prev.destinationDegradationCount + Number(stages.some((stage) => stage === 'destination_rate_limited' || stage === 'route_send_failed'))

  return {
    next: {
      tick,
      timestampMs: nextTimestamp,
      totalEvents: prev.totalEvents + events.length,
      status,
      eps,
      retryBursts,
      destinationDegradationCount,
    },
    events,
  }
}

function chooseStagesForTick(tick: number, preset: LiveSimulationPresetKey): string[] {
  if (preset === 'lowTraffic') {
    return tick % 3 === 0 ? ['route_send_success', 'checkpoint_update', 'run_complete'] : ['route_send_success', 'run_complete']
  }
  if (preset === 'degradedRoute') {
    if (tick % 4 === 0) return ['route_send_failed', 'route_retry_success', 'checkpoint_update']
    if (tick % 2 === 0) return ['route_send_failed', 'destination_rate_limited']
    return ['route_send_success', 'run_complete']
  }
  if (preset === 'rateLimitedSource') {
    return tick % 2 === 0
      ? ['source_rate_limited', 'route_send_success', 'run_complete']
      : ['source_rate_limited', 'route_retry_success', 'checkpoint_update']
  }
  // recoveryMode
  if (tick < 3) return ['route_send_failed', 'destination_rate_limited']
  if (tick < 6) return ['route_retry_success', 'route_send_success']
  return ['route_send_success', 'checkpoint_update', 'run_complete']
}

function deriveRuntimeStatus(tick: number, preset: LiveSimulationPresetKey): LiveRuntimeStatus {
  if (preset === 'lowTraffic') return 'RUNNING'
  if (preset === 'degradedRoute') return tick % 3 === 0 ? 'RATE_LIMITED_DESTINATION' : 'DEGRADED'
  if (preset === 'rateLimitedSource') return 'RATE_LIMITED_SOURCE'
  // recoveryMode
  if (tick < 3) return 'DEGRADED'
  if (tick < 5) return 'RATE_LIMITED_DESTINATION'
  return 'RUNNING'
}

function stageToEventStatus(stage: string): string {
  if (stage.includes('failed')) return 'FAILED'
  if (stage.includes('rate_limited')) return 'RATE_LIMITED'
  return 'SUCCESS'
}

function stageToMessage(stage: string, tick: number): string {
  if (stage === 'route_send_success') return `Simulated route delivery success (tick ${tick}).`
  if (stage === 'route_retry_success') return `Simulated retry burst recovered route delivery (tick ${tick}).`
  if (stage === 'route_send_failed') return `Simulated destination degradation caused route send failure (tick ${tick}).`
  if (stage === 'source_rate_limited') return `Simulated source throttle window active (tick ${tick}).`
  if (stage === 'destination_rate_limited') return `Simulated destination throttle limit reached (tick ${tick}).`
  if (stage === 'checkpoint_update') return `Simulated checkpoint_update advanced stream cursor (tick ${tick}).`
  return `Simulated run_complete marker emitted (tick ${tick}).`
}

function toNumber(value: string, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}
