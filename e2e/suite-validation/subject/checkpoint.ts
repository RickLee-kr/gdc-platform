export type CheckpointState = {
  cursor: string | null
  seen_event_ids: Set<string>
  advanced: boolean
}

export function createCheckpoint(): CheckpointState {
  return { cursor: null, seen_event_ids: new Set(), advanced: false }
}

export function applyDedup(
  state: CheckpointState,
  eventId: string,
  enabled: boolean,
): { duplicate: boolean; state: CheckpointState } {
  if (!enabled) return { duplicate: false, state }
  if (state.seen_event_ids.has(eventId)) return { duplicate: true, state }
  state.seen_event_ids.add(eventId)
  return { duplicate: false, state }
}

export function advanceCheckpoint(state: CheckpointState, cursor: string, success: boolean): CheckpointState {
  if (!success) return { ...state, advanced: false }
  return { cursor, seen_event_ids: state.seen_event_ids, advanced: true }
}

export function recordRetry(opts: { attempts: number; final_ok: boolean }): {
  status: 'SUCCESS' | 'FAILED'
  retry_count: number
} {
  return {
    status: opts.final_ok ? 'SUCCESS' : 'FAILED',
    retry_count: opts.attempts,
  }
}
