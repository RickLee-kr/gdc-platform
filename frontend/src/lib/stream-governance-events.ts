/** Fired after a stream-scoped governance/configuration mutation succeeds. */
export const STREAM_GOVERNANCE_CHANGED_EVENT = 'gdc-stream-governance-changed' as const

export type StreamGovernanceChangedDetail = {
  streamId: number
}

export function notifyStreamGovernanceChanged(streamId: number): void {
  if (typeof window === 'undefined' || !Number.isFinite(streamId)) return
  window.dispatchEvent(
    new CustomEvent<StreamGovernanceChangedDetail>(STREAM_GOVERNANCE_CHANGED_EVENT, {
      detail: { streamId },
    }),
  )
}
