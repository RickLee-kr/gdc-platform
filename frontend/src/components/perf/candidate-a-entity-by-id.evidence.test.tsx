/**
 * Candidate A — entity-by-id shell/detail amplification.
 * Destination/route by-id now share Stream/Connector TTL/request cache (AFTER: HTTP=1).
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

describe('Candidate A evidence — shell/detail entity-by-id (AFTER dedupe)', () => {
  beforeEach(() => {
    clearSharedRequestCache()
    vi.restoreAllMocks()
  })

  it('destination by-id: shell+detail may call fetch twice but HTTP is 1', async () => {
    const apiSpy = vi.spyOn(rawApi, 'safeRequestJson').mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/destinations/7')) {
        return {
          id: 7,
          name: 'Dest-7',
          destination_type: 'SYSLOG_UDP',
          enabled: true,
          config_json: {},
          rate_limit_json: {},
        }
      }
      return null
    })
    const destFnSpy = vi.spyOn(gdcDestinations, 'fetchDestinationById')

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
    // Function calls may still be >= 2 (shell + detail ownership).
    expect(destFnSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
    // Shared request layer: one underlying HTTP for same id within TTL.
    expect(apiSpy.mock.calls.filter(([url]) => String(url).includes('/destinations/7'))).toHaveLength(1)
  })

  it('route by-id: shell+edit may call fetch twice but HTTP is 1', async () => {
    const apiSpy = vi.spyOn(rawApi, 'safeRequestJson').mockImplementation(async (url: string) => {
      const u = String(url)
      if (u.includes('/routes/42')) {
        return {
          id: 42,
          name: 'Route A',
          enabled: true,
          stream_id: 10,
          destination_id: 5,
          failure_policy: 'LOG_AND_CONTINUE',
          formatter_config_json: {},
          rate_limit_json: {},
        }
      }
      if (u.includes('/streams/10')) {
        return { id: 10, name: 'S', connector_id: 1 }
      }
      if (u.includes('/connectors/1')) {
        return { id: 1, name: 'C' }
      }
      if (u.includes('/destinations/')) {
        return []
      }
      return null
    })
    const routeFnSpy = vi.spyOn(gdcRoutes, 'fetchRouteById')
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
    await waitFor(() => expect(routeFnSpy.mock.calls.length).toBeGreaterThanOrEqual(2))
    expect(apiSpy.mock.calls.filter(([url]) => String(url).includes('/routes/42'))).toHaveLength(1)
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

  it('connector by-id remains TTL-deduped at HTTP layer', async () => {
    const apiSpy = vi.spyOn(rawApi, 'safeRequestJson').mockResolvedValue({ id: 1, name: 'C' })
    await gdcConnectors.fetchConnectorById(1)
    await gdcConnectors.fetchConnectorById(1)
    expect(apiSpy).toHaveBeenCalledTimes(1)
  })

  it('route by-id direct double-call is one HTTP within TTL', async () => {
    const apiSpy = vi.spyOn(rawApi, 'safeRequestJson').mockResolvedValue({
      id: 9,
      name: 'R9',
      enabled: true,
    })
    await gdcRoutes.fetchRouteById(9)
    await gdcRoutes.fetchRouteById(9)
    expect(apiSpy).toHaveBeenCalledTimes(1)
  })
})
