import { clearOperationalSnapshotCache } from '../api/operationalSnapshot'
import { clearSharedRequestCache } from '../api/requestCache'
import { resetRefreshCycleSnapshotId } from '../api/runtimeSnapshotSync'
import { clearConnectorsOverviewSnapshot } from '../components/connectors/connectors-overview-cache'
import { clearDestinationsListSnapshot } from '../components/destinations/destinations-list-cache'
import { clearStreamsConsoleSnapshot } from '../components/streams/streams-console-cache'

/**
 * Drops in-memory request/session data caches that must not survive logout / user switch.
 * Safe to call repeatedly; does not touch JWT storage (handled by clearSession).
 */
export function clearFrontendDataCaches(): void {
  clearSharedRequestCache()
  clearOperationalSnapshotCache()
  resetRefreshCycleSnapshotId()
  clearDestinationsListSnapshot()
  clearConnectorsOverviewSnapshot()
  clearStreamsConsoleSnapshot()
}
