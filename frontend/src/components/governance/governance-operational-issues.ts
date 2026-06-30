import { mapBackendStreamStatus } from '../../api/streamRows'
import type { DashboardSummaryResponse, HealthOverviewResponse, StreamRead } from '../../api/types/gdcApi'

export type GovernanceOperationalIssueCounts = {
  noDataStreams: number
  lowVolumeStreams: number
  /** null = API data unavailable (not the same as 0 drift alerts). */
  schemaDriftCount: number | null
  destinationCapacityWarnings: number
}

function safeNonNeg(n: unknown): number {
  const x = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(x) || x < 0) return 0
  return Math.floor(x)
}

/** Lightweight subset of dashboard operational issue derivation for Governance Overview. */
export function deriveGovernanceOperationalIssues(
  health: HealthOverviewResponse | null,
  dashboard: DashboardSummaryResponse | null,
  streamsList: readonly StreamRead[] = [],
): GovernanceOperationalIssueCounts {
  const streams = health?.streams
  const summary = dashboard?.summary

  const noDataStreams =
    streams?.excluded_no_outcome != null
      ? safeNonNeg(streams.excluded_no_outcome)
      : streams?.idle != null
        ? safeNonNeg(streams.idle)
        : 0

  const lowVolumeStreams =
    streamsList.length > 0
      ? streamsList.filter((s) => mapBackendStreamStatus(s.status) === 'DEGRADED').length
      : streams?.degraded != null
        ? safeNonNeg(streams.degraded)
        : 0

  const destinationCapacityWarnings =
    summary?.rate_limited_destination_streams != null
      ? safeNonNeg(summary.rate_limited_destination_streams)
      : health?.destinations?.degraded != null
        ? safeNonNeg(health.destinations.degraded)
        : 0

  // Derive schema drift using the same source as the main dashboard:
  // dashboard.validation_operational aggregates checkpoint drift + failing/degraded validation counts.
  // If that field is absent (API failed or endpoint not yet available) return null, not 0.
  const validation = dashboard?.validation_operational
  const schemaDriftCount = validation != null
    ? safeNonNeg(validation.open_checkpoint_drift_alerts) +
      safeNonNeg(validation.failing_validations_count) +
      safeNonNeg(validation.degraded_validations_count)
    : null

  return {
    noDataStreams,
    lowVolumeStreams,
    schemaDriftCount,
    destinationCapacityWarnings,
  }
}
