import type { ConnectorRead } from '../../api/gdcConnectors'
import type { ConnectorOperationsRow } from '../../api/gdcConnectorsOperations'

export type ConnectorsOverviewSnapshot = {
  baseRows: ConnectorRead[]
  opsRows: ConnectorOperationsRow[]
  operationsBacked: boolean
  updatedAt: number
}

let lastSnapshot: ConnectorsOverviewSnapshot | null = null

export function readConnectorsOverviewSnapshot(): ConnectorsOverviewSnapshot | null {
  return lastSnapshot
}

export function writeConnectorsOverviewSnapshot(snapshot: {
  baseRows: ConnectorRead[]
  opsRows: ConnectorOperationsRow[]
  operationsBacked: boolean
}): void {
  if (snapshot.baseRows.length === 0) return
  lastSnapshot = { ...snapshot, updatedAt: Date.now() }
}

export function clearConnectorsOverviewSnapshot(): void {
  lastSnapshot = null
}
