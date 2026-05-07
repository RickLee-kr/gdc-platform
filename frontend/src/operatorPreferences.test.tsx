import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { API_BASE_URL, resolveApiBaseUrl } from './api'
import App from './App'
import { STORAGE_KEYS } from './localPreferences'
import { getUrl, jsonResponse } from './test/fetchMock'
import { connectorSaveOkFixture, connectorUiConfigFixture } from './test/runtimeApiFixtures'

describe('operator preferences (localStorage)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('loads persisted entity IDs from localStorage on startup', () => {
    localStorage.setItem(
      STORAGE_KEYS.entityIds,
      JSON.stringify({
        connectorId: 'c-persist',
        sourceId: 's-persist',
        streamId: 'st-persist',
        routeId: 'r-persist',
        destinationId: 'd-persist',
      }),
    )
    render(<App />)
    expect(screen.getByLabelText(/connector_id/i)).toHaveValue('c-persist')
    expect(screen.getByLabelText(/source_id/i)).toHaveValue('s-persist')
    expect(screen.getByLabelText(/stream_id/i)).toHaveValue('st-persist')
    expect(screen.getByLabelText(/route_id/i)).toHaveValue('r-persist')
    expect(screen.getByLabelText(/destination_id/i)).toHaveValue('d-persist')
  })

  it('updating ID fields writes to localStorage', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByLabelText(/stream_id/i), 'stream-42')
    await waitFor(() => {
      const raw = localStorage.getItem(STORAGE_KEYS.entityIds)
      expect(raw).toBeTruthy()
      const parsed = JSON.parse(raw!) as { streamId: string }
      expect(parsed.streamId).toBe('stream-42')
    })
  })

  it('Reset IDs clears inputs and does not call fetch', async () => {
    const user = userEvent.setup()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    localStorage.setItem(
      STORAGE_KEYS.entityIds,
      JSON.stringify({
        connectorId: 'x',
        sourceId: 'y',
        streamId: 'z',
        routeId: 'a',
        destinationId: 'b',
      }),
    )
    render(<App />)
    expect(screen.getByLabelText(/connector_id/i)).toHaveValue('x')
    await user.click(screen.getByRole('button', { name: 'Reset IDs' }))
    expect(screen.getByLabelText(/connector_id/i)).toHaveValue('')
    expect(screen.getByLabelText(/stream_id/i)).toHaveValue('')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('display density toggle persists and sets data-density on root', async () => {
    const user = userEvent.setup()
    render(<App />)
    const main = document.querySelector('main.runtime-page')
    expect(main).toHaveAttribute('data-density', 'comfortable')
    await user.click(screen.getByRole('radio', { name: 'Compact' }))
    expect(main).toHaveAttribute('data-density', 'compact')
    expect(localStorage.getItem(STORAGE_KEYS.displayDensity)).toBe('compact')
  })

  it('Reset UI preferences clears density and returns to comfortable', async () => {
    const user = userEvent.setup()
    localStorage.setItem(STORAGE_KEYS.displayDensity, 'compact')
    render(<App />)
    const main = document.querySelector('main.runtime-page')
    expect(main).toHaveAttribute('data-density', 'compact')
    await user.click(screen.getByRole('button', { name: 'Reset UI preferences' }))
    expect(main).toHaveAttribute('data-density', 'comfortable')
    expect(localStorage.getItem(STORAGE_KEYS.displayDensity)).toBe('comfortable')
  })

  it('Apply API URL override makes requestJson use override base for API calls', async () => {
    const user = userEvent.setup()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const overrideBase = 'http://api-override.example:9999'
    fetchMock
      .mockResolvedValueOnce(jsonResponse(connectorUiConfigFixture()))
      .mockResolvedValueOnce(jsonResponse(connectorSaveOkFixture()))

    render(<App />)
    const overrideInput = screen.getByLabelText(/API base URL override \(optional\)/i)
    await user.clear(overrideInput)
    await user.type(overrideInput, overrideBase)
    await user.click(screen.getByRole('button', { name: 'Apply API URL override' }))
    await user.type(screen.getByLabelText(/connector_id/i), 'c1')
    await user.click(screen.getByRole('button', { name: 'Load' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(getUrl(fetchMock.mock.calls[0][0])).toBe(`${overrideBase}/api/v1/runtime/connectors/c1/ui/config`)
  })

  it('Reset API URL restores default base and does not call fetch', async () => {
    const user = userEvent.setup()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    localStorage.setItem(STORAGE_KEYS.apiBaseUrlOverride, 'http://temp.test:1')
    expect(resolveApiBaseUrl()).toBe('http://temp.test:1')
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Reset API URL' }))
    expect(resolveApiBaseUrl()).toBe(API_BASE_URL)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
