import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { API_BASE_URL } from './api'
import App from './App'
import {
  assertNoLiveDeliveryInCalls,
  assertPreviewOnlySafeUrls,
  jsonResponse,
  getUrl,
  parseJsonBody,
} from './test/fetchMock'
import {
  connectorSaveOkFixture,
  connectorUiConfigFixture,
  dashboardSummaryFixture,
  destinationUiConfigFixture,
  emptyFormatPreviewFixture,
  emptyHttpApiTestFixture,
  emptyMappingPreviewFixture,
  emptyRouteDeliveryPreviewFixture,
  failureTrendFixture,
  formatPreviewFixture,
  genericOkFixture,
  httpApiTestFixture,
  logsCleanupFixture,
  logsPageFixture,
  logsSearchFixture,
  mappingPreviewFixture,
  mappingTabPreviewResponseFixture,
  mappingUiConfigFixture,
  routeDeliveryPreviewFixture,
  routeUiConfigFixture,
  sourceUiConfigFixture,
  streamControlStartFixture,
  streamControlStopFixture,
  streamHealthFixture,
  streamStatsFixture,
  streamUiConfigFixture,
  timelineFixture,
} from './test/runtimeApiFixtures'

describe('Runtime Management MVP UI', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders ID inputs and all tabs', () => {
    render(<App />)

    expect(screen.getByLabelText(/connector_id/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/source_id/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/stream_id/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/route_id/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/destination_id/i)).toBeInTheDocument()

    for (const label of [
      'Runtime Config',
      'Dashboard',
      'Stream Health',
      'Stream Stats',
      'Timeline',
      'Logs',
      'Failure Trend',
      'Control & Test',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }

    for (const label of ['Connector', 'Source', 'Stream', 'Mapping', 'Route', 'Destination']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('loads connector config and saves edited connector fields', async () => {
    const user = userEvent.setup()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>

    fetchMock
      .mockResolvedValueOnce(jsonResponse(connectorUiConfigFixture()))
      .mockResolvedValueOnce(jsonResponse(connectorSaveOkFixture()))

    render(<App />)

    await user.type(screen.getByLabelText(/connector_id/i), 'c1')
    await user.click(screen.getByRole('button', { name: 'Load' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Connector Config' }).parentElement).toHaveTextContent('secret')
    })

    const saveHeading = screen.getByRole('heading', { name: 'Connector Save Payload' })
    const saveBox = saveHeading.parentElement!.querySelector('textarea') as HTMLTextAreaElement
    fireEvent.change(saveBox, {
      target: { value: JSON.stringify({ id: 'c1', edited_field: 'updated', nested: { n: 1 } }) },
    })

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    expect(getUrl(fetchMock.mock.calls[0][0])).toBe(`${API_BASE_URL}/api/v1/runtime/connectors/c1/ui/config`)

    const saveUrl = getUrl(fetchMock.mock.calls[1][0])
    const saveInit = fetchMock.mock.calls[1][1] as RequestInit
    expect(saveUrl).toBe(`${API_BASE_URL}/api/v1/runtime/connectors/c1/ui/save`)
    expect(saveInit.method).toBe('POST')
    expect(parseJsonBody(saveInit)).toEqual({
      id: 'c1',
      edited_field: 'updated',
      nested: { n: 1 },
    })
  })

  it('Source tab POSTs enabled, config_json, auth_json to sources ui/save', async () => {
    const user = userEvent.setup()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>

    fetchMock.mockResolvedValueOnce(jsonResponse(sourceUiConfigFixture())).mockResolvedValueOnce(jsonResponse(genericOkFixture()))

    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Source' }))
    await user.type(screen.getByLabelText(/source_id/i), 'src-1')
    await user.click(screen.getByRole('button', { name: 'Load' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    expect(getUrl(fetchMock.mock.calls[1][0])).toBe(`${API_BASE_URL}/api/v1/runtime/sources/src-1/ui/save`)
    const body = parseJsonBody(fetchMock.mock.calls[1][1] as RequestInit)
    expect(body).toMatchObject({
      enabled: true,
      config_json: { url: 'https://example.test' },
      auth_json: { token: 't' },
    })
  })

  it('Stream tab POSTs expected shape to streams ui/save', async () => {
    const user = userEvent.setup()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>

    fetchMock.mockResolvedValueOnce(jsonResponse(streamUiConfigFixture())).mockResolvedValueOnce(jsonResponse(genericOkFixture()))

    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Stream' }))
    await user.type(screen.getByLabelText(/stream_id/i), 'st-9')
    await user.click(screen.getByRole('button', { name: 'Load' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    expect(getUrl(fetchMock.mock.calls[1][0])).toBe(`${API_BASE_URL}/api/v1/runtime/streams/st-9/ui/save`)
    const body = parseJsonBody(fetchMock.mock.calls[1][1] as RequestInit)
    expect(body).toEqual({
      name: 's',
      enabled: true,
      polling_interval: 120,
      config_json: { x: 1 },
      rate_limit_json: { per_sec: 5 },
    })
  })

  it('Route tab POSTs route save payload to routes ui/save', async () => {
    const user = userEvent.setup()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>

    fetchMock.mockResolvedValueOnce(jsonResponse(routeUiConfigFixture())).mockResolvedValueOnce(jsonResponse(genericOkFixture()))

    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Route' }))
    await user.type(screen.getByLabelText(/route_id/i), 'rt-1')
    await user.click(screen.getByRole('button', { name: 'Load' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    expect(getUrl(fetchMock.mock.calls[1][0])).toBe(`${API_BASE_URL}/api/v1/runtime/routes/rt-1/ui/save`)
    const body = parseJsonBody(fetchMock.mock.calls[1][1] as RequestInit)
    expect(body).toMatchObject({
      route_enabled: true,
      destination_enabled: false,
      failure_policy: 'LOG_AND_CONTINUE',
      route_formatter_config: { fmt: true },
      route_rate_limit: { rps: 10 },
    })
  })

  it('Destination tab POSTs expected shape to destinations ui/save', async () => {
    const user = userEvent.setup()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>

    fetchMock
      .mockResolvedValueOnce(jsonResponse(destinationUiConfigFixture()))
      .mockResolvedValueOnce(jsonResponse(genericOkFixture()))

    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Destination' }))
    await user.type(screen.getByLabelText(/destination_id/i), 'd-99')
    await user.click(screen.getByRole('button', { name: 'Load' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    expect(getUrl(fetchMock.mock.calls[1][0])).toBe(`${API_BASE_URL}/api/v1/runtime/destinations/d-99/ui/save`)
    const body = parseJsonBody(fetchMock.mock.calls[1][1] as RequestInit)
    expect(body).toEqual({
      name: 'dest-a',
      enabled: true,
      config_json: { host: 'h' },
      rate_limit_json: { burst: 2 },
    })
  })

  it('Mapping: loads config, applies JSON path, preview uses raw_response and preview/mapping only', async () => {
    const user = userEvent.setup()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>

    fetchMock.mockResolvedValueOnce(jsonResponse(mappingUiConfigFixture())).mockResolvedValueOnce(jsonResponse(mappingTabPreviewResponseFixture()))

    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Mapping' }))
    await user.type(screen.getByLabelText(/stream_id/i), 'stream-map-1')
    await user.click(screen.getByRole('button', { name: 'Load' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const rawEditors = screen.getAllByRole('textbox')
    const rawResponseEditor =
      rawEditors.find((el) => el.classList.contains('raw-response-editor')) ??
      document.querySelector('textarea.raw-response-editor')

    expect(rawResponseEditor).toBeTruthy()
    const editor = rawResponseEditor as HTMLTextAreaElement

    await waitFor(() => {
      expect(editor.value).toContain('"events"')
      expect(editor.value).toContain('99')
    })

    expect(screen.getByRole('columnheader', { name: 'output_field' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'source_json_path' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'existing_out' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '$.events[0].id' })).toBeInTheDocument()

    const editedPayload = { items: [{ code: 'edited-code' }] }
    fireEvent.change(editor, { target: { value: JSON.stringify(editedPayload) } })

    await waitFor(() => {
      expect(editor.value).toContain('edited-code')
    })

    const treeSection = screen.getByRole('heading', { name: /Raw Payload JSON Tree/i }).closest('div')!
    const pathButton = within(treeSection).getByRole('button', { name: '$.items[0].code' })
    await user.click(pathButton)

    const targetInput = screen.getByPlaceholderText('target output_field')
    await user.clear(targetInput)
    await user.type(targetInput, 'from_tree')

    await user.click(screen.getByRole('button', { name: 'Apply Selected Path' }))

    await waitFor(() => {
      expect(screen.getByRole('cell', { name: 'from_tree' })).toBeInTheDocument()
      expect(screen.getByRole('cell', { name: '$.items[0].code' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /preview\/mapping/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    expect(getUrl(fetchMock.mock.calls[0][0])).toBe(`${API_BASE_URL}/api/v1/runtime/streams/stream-map-1/mapping-ui/config`)

    const previewUrl = getUrl(fetchMock.mock.calls[1][0])
    const previewInit = fetchMock.mock.calls[1][1] as RequestInit
    expect(previewUrl).toBe(`${API_BASE_URL}/api/v1/runtime/preview/mapping`)
    expect(previewInit.method).toBe('POST')

    const previewBody = parseJsonBody(previewInit)
    expect(previewBody).toMatchObject({
      raw_response: editedPayload,
      field_mappings: {
        existing_out: '$.events[0].id',
        from_tree: '$.items[0].code',
      },
    })

    assertNoLiveDeliveryInCalls(fetchMock.mock.calls)
  })
})

describe('Runtime observability views', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('dashboard summary loads and shows aggregate counts and recent rows', async () => {
    const user = userEvent.setup()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>

    fetchMock.mockResolvedValueOnce(jsonResponse(dashboardSummaryFixture()))

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Dashboard' }))
    await user.click(screen.getByRole('button', { name: 'Load dashboard summary' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(getUrl(fetchMock.mock.calls[0][0])).toContain(`${API_BASE_URL}/api/v1/runtime/dashboard/summary`)
    expect(getUrl(fetchMock.mock.calls[0][0])).toContain('limit=100')

    await waitFor(() => {
      expect(screen.getByText('total_streams')).toBeInTheDocument()
      expect(screen.getByText('3')).toBeInTheDocument()
      expect(screen.getByText('recent_failures')).toBeInTheDocument()
      expect(screen.getByText('7')).toBeInTheDocument()
    })

    expect(screen.getByRole('heading', { name: /recent_problem_routes/i })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'route_send_failed' })).toBeInTheDocument()
  })

  it('stream health calls GET /api/v1/runtime/health/stream/{stream_id}', async () => {
    const user = userEvent.setup()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>

    fetchMock.mockResolvedValueOnce(jsonResponse(streamHealthFixture()))

    render(<App />)
    await user.type(screen.getByLabelText(/^stream_id$/i), '42')
    await user.click(screen.getByRole('button', { name: 'Stream Health' }))
    await user.click(screen.getByRole('button', { name: 'Load stream health' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(getUrl(fetchMock.mock.calls[0][0])).toBe(`${API_BASE_URL}/api/v1/runtime/health/stream/42?limit=100`)
  })

  it('stream stats calls GET /api/v1/runtime/stats/stream/{stream_id}', async () => {
    const user = userEvent.setup()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>

    fetchMock.mockResolvedValueOnce(jsonResponse(streamStatsFixture()))

    render(<App />)
    await user.type(screen.getByLabelText(/^stream_id$/i), '7')
    await user.click(screen.getByRole('button', { name: 'Stream Stats' }))
    await user.click(screen.getByRole('button', { name: 'Load stream stats' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(getUrl(fetchMock.mock.calls[0][0])).toBe(`${API_BASE_URL}/api/v1/runtime/stats/stream/7?limit=100`)
  })

  it('timeline calls GET /api/v1/runtime/timeline/stream/{stream_id}', async () => {
    const user = userEvent.setup()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>

    fetchMock.mockResolvedValueOnce(jsonResponse(timelineFixture()))

    render(<App />)
    await user.type(screen.getByLabelText(/^stream_id$/i), '5')
    await user.click(screen.getByRole('button', { name: 'Timeline' }))
    await user.click(screen.getByRole('button', { name: 'Load timeline' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(getUrl(fetchMock.mock.calls[0][0])).toContain(`${API_BASE_URL}/api/v1/runtime/timeline/stream/5`)
    expect(getUrl(fetchMock.mock.calls[0][0])).toContain('limit=100')

    await waitFor(() => {
      expect(screen.getByRole('cell', { name: 'run_complete' })).toBeInTheDocument()
    })
  })

  it('logs search builds query string and renders log rows', async () => {
    const user = userEvent.setup()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>

    fetchMock.mockResolvedValueOnce(jsonResponse(logsSearchFixture()))

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Logs' }))
    await user.type(screen.getByLabelText(/search stream_id/i), '12')
    await user.clear(screen.getByLabelText(/search limit/i))
    await user.type(screen.getByLabelText(/search limit/i), '50')
    await user.click(screen.getByRole('button', { name: 'Search logs' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const u = new URL(getUrl(fetchMock.mock.calls[0][0]))
    expect(u.pathname).toBe('/api/v1/runtime/logs/search')
    expect(u.searchParams.get('stream_id')).toBe('12')
    expect(u.searchParams.get('limit')).toBe('50')

    await waitFor(() => {
      expect(screen.getByRole('cell', { name: 'route_send_success' })).toBeInTheDocument()
    })
  })

  it('logs page shows next cursor fields from response', async () => {
    const user = userEvent.setup()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>

    fetchMock.mockResolvedValueOnce(jsonResponse(logsPageFixture()))

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Logs' }))
    await user.click(screen.getByRole('button', { name: 'Load log page' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const u = new URL(getUrl(fetchMock.mock.calls[0][0]))
    expect(u.pathname).toBe('/api/v1/runtime/logs/page')

    await waitFor(() => {
      expect(screen.getByText('next_cursor_id')).toBeInTheDocument()
      expect(screen.getByText('9001')).toBeInTheDocument()
      expect(screen.getByText('2026-05-04T08:30:00Z')).toBeInTheDocument()
    })
  })

  it('logs cleanup POSTs schema body and does not hit delivery send paths', async () => {
    const user = userEvent.setup()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>

    fetchMock.mockResolvedValueOnce(jsonResponse(logsCleanupFixture()))

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Logs' }))
    await user.clear(screen.getByLabelText(/older_than_days/i))
    await user.type(screen.getByLabelText(/older_than_days/i), '14')
    await user.click(screen.getByRole('button', { name: 'Run logs cleanup' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const url = getUrl(fetchMock.mock.calls[0][0])
    expect(url).toBe(`${API_BASE_URL}/api/v1/runtime/logs/cleanup`)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(parseJsonBody(init)).toEqual({ older_than_days: 14, dry_run: true })

    expect(url).not.toMatch(/\/send/)
    expect(url).not.toMatch(/delivery/)
  })

  it('failure trend loads and renders bucket rows', async () => {
    const user = userEvent.setup()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>

    fetchMock.mockResolvedValueOnce(jsonResponse(failureTrendFixture()))

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Failure Trend' }))
    await user.type(screen.getByLabelText(/trend stream_id/i), '1')
    await user.click(screen.getByRole('button', { name: 'Load failure trend' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const u = new URL(getUrl(fetchMock.mock.calls[0][0]))
    expect(u.pathname).toBe('/api/v1/runtime/failures/trend')
    expect(u.searchParams.get('stream_id')).toBe('1')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /buckets/i })).toBeInTheDocument()
      expect(screen.getByRole('cell', { name: 'route_send_failed' })).toBeInTheDocument()
      expect(screen.getByRole('cell', { name: '5' })).toBeInTheDocument()
    })
  })

  it('shows observability empty states before first load', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Dashboard' }))
    expect(screen.getByText('아직 로드된 대시보드 데이터가 없습니다.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Stream Health' }))
    expect(screen.getByText('아직 로드된 스트림 상태가 없습니다.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Logs' }))
    expect(screen.getByText('아직 로그 검색 결과가 없습니다.')).toBeInTheDocument()
    expect(screen.getByText('아직 페이지 조회 결과가 없습니다.')).toBeInTheDocument()
  })

  it('disables observability load button while request is in flight', async () => {
    const user = userEvent.setup()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(() => new Promise(() => {}))

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Dashboard' }))
    const button = screen.getByRole('button', { name: 'Load dashboard summary' })
    await user.click(button)

    expect(button).toBeDisabled()
    expect(screen.getByText('로딩 중...')).toBeInTheDocument()
  })

  it('logs cleanup keeps dry_run guidance and shows API error', async () => {
    const user = userEvent.setup()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockRejectedValueOnce(new Error('cleanup failed'))

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Logs' }))
    expect(screen.getByText(/dry_run \(recommended first\)/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Run logs cleanup' }))

    await waitFor(() => {
      expect(screen.getByText('cleanup failed')).toBeInTheDocument()
    })
  })
})

describe('Control & Test workflows', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('Control & Test nav renders', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Control & Test' })).toBeInTheDocument()
  })

  it('Start Stream calls POST /streams/{id}/start and shows status fields', async () => {
    const user = userEvent.setup()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>

    fetchMock.mockResolvedValueOnce(jsonResponse(streamControlStartFixture()))

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Control & Test' }))
    await user.type(screen.getByLabelText(/^stream_id$/i), '11')
    await user.click(screen.getByRole('button', { name: 'Start stream' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(getUrl(fetchMock.mock.calls[0][0])).toBe(`${API_BASE_URL}/api/v1/runtime/streams/11/start`)

    await waitFor(() => {
      expect(screen.getByText('started')).toBeInTheDocument()
      expect(screen.getByText('stream started')).toBeInTheDocument()
      expect(screen.getByText('RUNNING')).toBeInTheDocument()
    })
  })

  it('Stop Stream calls POST /streams/{id}/stop and shows status fields', async () => {
    const user = userEvent.setup()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>

    fetchMock.mockResolvedValueOnce(jsonResponse(streamControlStopFixture()))

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Control & Test' }))
    await user.type(screen.getByLabelText(/^stream_id$/i), '22')
    await user.click(screen.getByRole('button', { name: 'Stop stream' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(getUrl(fetchMock.mock.calls[0][0])).toBe(`${API_BASE_URL}/api/v1/runtime/streams/22/stop`)

    await waitFor(() => {
      expect(screen.getByText('stopped')).toBeInTheDocument()
      expect(screen.getByText('stream stopped')).toBeInTheDocument()
      expect(screen.getByText('STOPPED')).toBeInTheDocument()
    })
  })

  it('HTTP API test preview posts body and shows event_count and extracted_events', async () => {
    const user = userEvent.setup()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>

    fetchMock.mockResolvedValueOnce(jsonResponse(httpApiTestFixture()))

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Control & Test' }))
    fireEvent.change(screen.getByLabelText(/source_config \(JSON object\)/i), {
      target: { value: '{"poll":"http://example.test"}' },
    })
    fireEvent.change(screen.getByLabelText(/stream_config \(JSON object\)/i), {
      target: { value: '{"path":"/x"}' },
    })

    await user.click(screen.getByRole('button', { name: 'Run HTTP API test (preview only)' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(getUrl(fetchMock.mock.calls[0][0])).toBe(`${API_BASE_URL}/api/v1/runtime/api-test/http`)
    const body = parseJsonBody(fetchMock.mock.calls[0][1] as RequestInit)
    expect(body).toMatchObject({
      source_config: { poll: 'http://example.test' },
      stream_config: { path: '/x' },
      checkpoint: null,
    })

    await waitFor(() => {
      expect(screen.getByText('event_count')).toBeInTheDocument()
      expect(screen.getByText('3')).toBeInTheDocument()
    })
    expect(screen.getByRole('heading', { name: /extracted_events/i })).toBeInTheDocument()
  })

  it('Mapping preview posts mapping body and shows mapped_event_count and preview_events', async () => {
    const user = userEvent.setup()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>

    fetchMock.mockResolvedValueOnce(jsonResponse(mappingPreviewFixture()))

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Control & Test' }))
    fireEvent.change(screen.getByLabelText(/^raw_response \(JSON\)/i), {
      target: { value: '{"items":[{"a":1}]}' },
    })
    fireEvent.change(screen.getByLabelText(/field_mappings \(JSON object/i), {
      target: { value: '{"out":"$.items[0].a"}' },
    })
    fireEvent.change(screen.getByLabelText(/enrichment \(JSON object\)/i), {
      target: { value: '{"k":"v"}' },
    })

    await user.click(screen.getByRole('button', { name: 'Run mapping preview (preview only)' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(getUrl(fetchMock.mock.calls[0][0])).toBe(`${API_BASE_URL}/api/v1/runtime/preview/mapping`)
    const body = parseJsonBody(fetchMock.mock.calls[0][1] as RequestInit)
    expect(body).toMatchObject({
      raw_response: { items: [{ a: 1 }] },
      field_mappings: { out: '$.items[0].a' },
      enrichment: { k: 'v' },
    })

    await waitFor(() => {
      expect(screen.getByText('mapped_event_count')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: /preview_events/i })).toBeInTheDocument()
    })
  })

  it('Delivery format preview posts to /preview/format with expected body', async () => {
    const user = userEvent.setup()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>

    fetchMock.mockResolvedValueOnce(jsonResponse(formatPreviewFixture()))

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Control & Test' }))
    fireEvent.change(screen.getByLabelText(/events \(JSON array of objects\)/i), {
      target: { value: '[{"n":1},{"n":2}]' },
    })
    fireEvent.change(screen.getByLabelText(/^formatter_config \(JSON object\)/i), {
      target: { value: '{"fmt":true}' },
    })

    await user.click(screen.getByRole('button', { name: 'Run delivery format preview (preview only)' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(getUrl(fetchMock.mock.calls[0][0])).toBe(`${API_BASE_URL}/api/v1/runtime/preview/format`)
    const body = parseJsonBody(fetchMock.mock.calls[0][1] as RequestInit)
    expect(body).toMatchObject({
      events: [{ n: 1 }, { n: 2 }],
      destination_type: 'WEBHOOK_POST',
      formatter_config: { fmt: true },
    })
  })

  it('Route delivery preview posts to /preview/route-delivery with route_id and events', async () => {
    const user = userEvent.setup()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>

    fetchMock.mockResolvedValueOnce(jsonResponse(routeDeliveryPreviewFixture()))

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Control & Test' }))
    await user.type(screen.getByLabelText(/^route_id$/i), '55')
    fireEvent.change(screen.getByLabelText(/events \(JSON array of final_event/i), {
      target: { value: '[{"final":true}]' },
    })

    await user.click(screen.getByRole('button', { name: 'Run route delivery preview (preview only)' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(getUrl(fetchMock.mock.calls[0][0])).toBe(`${API_BASE_URL}/api/v1/runtime/preview/route-delivery`)
    const body = parseJsonBody(fetchMock.mock.calls[0][1] as RequestInit)
    expect(body).toMatchObject({ route_id: 55, events: [{ final: true }] })
  })

  it('preview-only sequence avoids stream control URLs, checkpoint paths, and live /send endpoints', async () => {
    const user = userEvent.setup()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>

    fetchMock
      .mockResolvedValueOnce(jsonResponse(emptyHttpApiTestFixture()))
      .mockResolvedValueOnce(jsonResponse(emptyMappingPreviewFixture()))
      .mockResolvedValueOnce(jsonResponse(emptyFormatPreviewFixture()))
      .mockResolvedValueOnce(jsonResponse(emptyRouteDeliveryPreviewFixture()))

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Control & Test' }))

    await user.click(screen.getByRole('button', { name: 'Run HTTP API test (preview only)' }))
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1))

    await user.click(screen.getByRole('button', { name: 'Run mapping preview (preview only)' }))
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2))

    await user.click(screen.getByRole('button', { name: 'Run delivery format preview (preview only)' }))
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3))

    await user.type(screen.getByLabelText(/^route_id$/i), '9')
    await user.click(screen.getByRole('button', { name: 'Run route delivery preview (preview only)' }))
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(4))

    assertPreviewOnlySafeUrls(fetchMock.mock.calls)
  })
})
