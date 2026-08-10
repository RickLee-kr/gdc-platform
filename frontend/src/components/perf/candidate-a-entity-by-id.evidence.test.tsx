/**
 * Candidate A measurement evidence (not modified in this PR).
 * Stream/connector by-id already TTL-deduped; destination/route by-id remain uncached duplicates.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect, useState } from 'react'
import { AppShellLayout } from '../layout/app-shell-layout'
import { RouteEditPage } from '../routes/route-edit-page'
import { clearSharedRequestCache } from '../../api/requestCache'
import * as rawApi from '../../api'
import * as gdcDestinations from '../../api/gdcDestinations'
import * as gdcRoutes from '../../api/gdcRoutes'
import * as gdcStreams from '../../api/gdcStreams'
import * as gdcConnectors from '../../api/gdcConnectors'
import * as gdcRouteTransform from '../../api/gdcRouteTransform'
import * as gdcRouteProtection from '../../api/gdcRouteProtection'
import * as gdcRouteClassification from '../../api/gdcRouteClassification'
import * as gdcRoutePolicy from '../../api/gdcRoutePolicy'
import { useShellRouteLabels } from '../../hooks/use-shell-route-labels'

vi.mock('../routes/route-detail-health-panel', () => ({
  RouteDetailHealthPanel: () => null,
}))

describe('Candidate A evidence — shell/detail entity-by-id (unfixed)', () => {
  beforeEach(() => {
    clearSharedRequestCache()
    vi.restoreAllMocks()
  })

  it('destination by-id: shell+detail = 2 uncached calls', async () => {
    const destSpy = vi.spyOn(gdcDestinations, 'fetchDestinationById').mockResolvedValue({
      id: 7,
      name: 'Dest-7',
      destination_type: 'SYSLOG_UDP',
      enabled: true,
      config_json: {},
      rate_limit_json: {},
    } as never)
    function Shell() {
      const labels = useShellRouteLabels({ destinationId: '7' })
      return <div data-testid="shell">{labels.destination?.name ?? ''}</div>
    }
    function Detail() {
      const [name, setName] = useState('')
      useEffect(() => {
        void gdcDestinations.fetchDestinationById(7).then((d) => setName(d?.name ?? ''))
      }, [])
      return <div data-testid="detail">{name}</div>
    }
    render(
      <>
        <Shell />
        <Detail />
      </>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('shell')).toHaveTextContent('Dest-7')
      expect(screen.getByTestId('detail')).toHaveTextContent('Dest-7')
    })
    expect(destSpy).toHaveBeenCalledTimes(2)
  })

  it('route by-id: shell+page = 2 uncached calls', async () => {
    const routeSpy = vi.spyOn(gdcRoutes, 'fetchRouteById').mockResolvedValue({
      id: 42,
      name: 'Route A',
      enabled: true,
      stream_id: 10,
      destination_id: 5,
      failure_policy: 'LOG_AND_CONTINUE',
      formatter_config_json: {},
      rate_limit_json: {},
    } as never)
    vi.spyOn(gdcStreams, 'fetchStreamById').mockResolvedValue({ id: 10, name: 'S', connector_id: 1 } as never)
    vi.spyOn(gdcConnectors, 'fetchConnectorById').mockResolvedValue({ id: 1, name: 'C' } as never)
    vi.spyOn(gdcDestinations, 'fetchDestinationsList').mockResolvedValue([{ id: 5, name: 'D' }] as never)
    vi.spyOn(gdcRouteTransform, 'fetchRouteTransformEffective').mockResolvedValue(null)
    vi.spyOn(gdcRouteProtection, 'fetchRouteProtectionEffective').mockResolvedValue(null)
    vi.spyOn(gdcRouteClassification, 'fetchRouteClassificationEffective').mockResolvedValue(null)
    vi.spyOn(gdcRoutePolicy, 'fetchRoutePolicyEffective').mockResolvedValue(null)

    render(
      <MemoryRouter initialEntries={['/routes/42/edit']}>
        <Routes>
          <Route element={<AppShellLayout />}>
            <Route path="/routes/:routeId/edit" element={<RouteEditPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(() => expect(routeSpy).toHaveBeenCalledTimes(2))
  })

  it('stream by-id remains TTL-deduped at HTTP layer', async () => {
    const apiSpy = vi.spyOn(rawApi, 'safeRequestJson').mockResolvedValue({
      id: 1,
      name: 'S',
      connector_id: 1,
    })
    await gdcStreams.fetchStreamById(1)
    await gdcStreams.fetchStreamById(1)
    expect(apiSpy).toHaveBeenCalledTimes(1)
  })
})
