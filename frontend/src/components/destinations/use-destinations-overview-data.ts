import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchDestinationsList, type DestinationListItem } from '../../api/gdcDestinations'
import { getOperationalSnapshot } from '../../api/operationalSnapshot'
import { isRequestAborted } from '../../lib/request-abort'
import {
  buildDestinationRuntimeLookup,
  listRuntimeMetricsForDestination,
  type DestinationListRuntimeMetrics,
} from './destination-runtime-metrics'
import { readDestinationsListSnapshot, writeDestinationsListSnapshot } from './destinations-list-cache'

export type DestinationOverviewRow = DestinationListItem & {
  runtime: DestinationListRuntimeMetrics
}

export type DestinationsOverviewDataState = {
  rows: DestinationOverviewRow[]
  loading: boolean
  runtimeLoading: boolean
  error: string | null
  runtimeError: string | null
  refresh: () => Promise<void>
}

export function useDestinationsOverviewData(): DestinationsOverviewDataState {
  const sessionRows = readDestinationsListSnapshot()
  const [catalogRows, setCatalogRows] = useState<DestinationListItem[]>(() => sessionRows ?? [])
  const [catalogLoading, setCatalogLoading] = useState(() => (sessionRows?.length ?? 0) === 0)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [runtimeLoading, setRuntimeLoading] = useState(true)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [runtimeLookup, setRuntimeLookup] = useState(() => buildDestinationRuntimeLookup(null))
  const catalogRef = useRef(catalogRows)
  catalogRef.current = catalogRows

  const loadCatalog = useCallback(async (options?: { background?: boolean }) => {
    const background = options?.background === true && catalogRef.current.length > 0
    if (!background) {
      setCatalogLoading(true)
      setCatalogError(null)
    }
    try {
      const data = await fetchDestinationsList()
      setCatalogRows(data)
      writeDestinationsListSnapshot(data)
    } catch (err) {
      if (!isRequestAborted(err)) {
        setCatalogError(err instanceof Error ? err.message : 'Failed to load destinations.')
        if (!background) setCatalogRows([])
      }
    } finally {
      if (!background) setCatalogLoading(false)
    }
  }, [])

  const loadRuntime = useCallback(async () => {
    setRuntimeLoading(true)
    setRuntimeError(null)
    try {
      const snapshot = await getOperationalSnapshot()
      if (snapshot == null) {
        setRuntimeError('Could not load operational snapshot.')
        setRuntimeLookup(buildDestinationRuntimeLookup(null))
        return
      }
      setRuntimeLookup(buildDestinationRuntimeLookup(snapshot))
    } catch (err) {
      if (!isRequestAborted(err)) {
        setRuntimeError(err instanceof Error ? err.message : 'Failed to load destination runtime data.')
        setRuntimeLookup(buildDestinationRuntimeLookup(null))
      }
    } finally {
      setRuntimeLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    const hasSession = (readDestinationsListSnapshot()?.length ?? 0) > 0
    await Promise.all([loadCatalog({ background: hasSession }), loadRuntime()])
  }, [loadCatalog, loadRuntime])

  useEffect(() => {
    const hasSession = (readDestinationsListSnapshot()?.length ?? 0) > 0
    void loadCatalog({ background: hasSession })
    void loadRuntime()
  }, [loadCatalog, loadRuntime])

  const rows = useMemo(
    (): DestinationOverviewRow[] =>
      catalogRows.map((row) => ({
        ...row,
        runtime: listRuntimeMetricsForDestination(row, runtimeLookup),
      })),
    [catalogRows, runtimeLookup],
  )

  return {
    rows,
    loading: catalogLoading,
    runtimeLoading,
    error: catalogError,
    runtimeError,
    refresh,
  }
}
