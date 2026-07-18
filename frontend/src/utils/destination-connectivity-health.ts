import type { DestinationRead } from '../api/gdcDestinations'
import type { OperationalDestinationSnapshot } from '../api/operationalSnapshot'
import type { OperationalUiHealthLabel } from '../lib/operational-snapshot-selectors'

export type DestinationConnectivityFields = Pick<
  DestinationRead,
  'last_connectivity_test_success' | 'last_connectivity_test_at'
>

/** True when a persisted destination connectivity probe succeeded. */
export function isDestinationConnectivityVerified(
  dest: DestinationConnectivityFields | undefined | null,
): boolean {
  if (!dest) return false
  return dest.last_connectivity_test_success === true
}

function snapshotHasDeliveryTraffic(snapshot: OperationalDestinationSnapshot | null | undefined): boolean {
  if (!snapshot) return false
  const inbound = typeof snapshot.inbound_eps_1m === 'number' ? Math.max(0, snapshot.inbound_eps_1m) : 0
  const failed = typeof snapshot.failed_eps_1m === 'number' ? Math.max(0, snapshot.failed_eps_1m) : 0
  return inbound + failed > 0 || snapshot.last_success_at != null || snapshot.last_error_at != null
}

/**
 * List/overview health: prefer verified connectivity when runtime delivery metrics
 * are not yet available, so a passing probe is not shown as Critical/Error.
 */
export function resolveDestinationListUiHealth(
  row: DestinationConnectivityFields & { enabled: boolean },
  snapshot: OperationalDestinationSnapshot | null | undefined,
  snapshotLabel: OperationalUiHealthLabel | undefined,
): OperationalUiHealthLabel {
  if (!row.enabled) return 'Disabled'
  const connectivityOk = isDestinationConnectivityVerified(row)
  const hasTraffic = snapshotHasDeliveryTraffic(snapshot)

  if (connectivityOk && !hasTraffic) {
    return 'Healthy'
  }

  if (snapshotLabel) return snapshotLabel
  if (connectivityOk) return 'Healthy'
  return 'Unknown'
}
