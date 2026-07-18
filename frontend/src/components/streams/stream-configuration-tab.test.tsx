import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StreamConfigurationTab } from './stream-configuration-tab'
import * as gdcStreamConfiguration from '../../api/gdcStreamConfiguration'

vi.mock('../../api/gdcStreamConfiguration', async () => {
  const actual = await vi.importActual<typeof import('../../api/gdcStreamConfiguration')>(
    '../../api/gdcStreamConfiguration',
  )
  return {
    ...actual,
    fetchStreamConfiguration: vi.fn(),
    fetchStreamSampleData: vi.fn(),
    fetchStreamIncrementalFetch: vi.fn(),
    fetchStreamDeduplication: vi.fn(),
    fetchStreamCheckpointManage: vi.fn(),
  }
})

vi.mock('./stream-checkpoint-panel', () => ({
  StreamCheckpointPanel: () => <div data-testid="stream-checkpoint-panel" />,
}))
vi.mock('./stream-dedup-panel', () => ({
  StreamDedupPanel: () => <div data-testid="stream-dedup-panel" />,
}))
vi.mock('./stream-incremental-test-panel', () => ({
  StreamIncrementalTestPanel: () => <div data-testid="stream-incremental-test-panel" />,
}))
vi.mock('./stream-replay-panel', () => ({
  StreamReplayPanel: () => <div data-testid="stream-replay-panel" />,
}))

function section(title: string, fields: Array<{ label: string; value: string; configured?: boolean; sensitive?: boolean }>) {
  return {
    title,
    fields: fields.map((f) => ({
      configured: f.configured ?? f.value !== 'Not configured',
      sensitive: f.sensitive ?? false,
      ...f,
    })),
  }
}

describe('StreamConfigurationTab transform rules', () => {
  beforeEach(() => {
    vi.mocked(gdcStreamConfiguration.fetchStreamConfiguration).mockReset()
    vi.mocked(gdcStreamConfiguration.fetchStreamSampleData).mockReset()
    vi.mocked(gdcStreamConfiguration.fetchStreamSampleData).mockResolvedValue({
      stream_id: 1,
      has_sample_data: false,
      sample_events: [],
      sample_count: 0,
      union_schema: null,
      event_root_path: null,
      record_path: null,
      last_test_response: null,
      checkpoint_test_result: null,
      incremental_test_result: null,
      saved_at: null,
      message: 'No sample data saved yet',
    })
  })

  it('renders titles and key fields for each transform rule type', async () => {
    vi.mocked(gdcStreamConfiguration.fetchStreamConfiguration).mockResolvedValue({
      stream_id: 42,
      stream_name: 'demo',
      message: 'ok',
      sections: [
        section('Timestamp Conversion', [
          { label: 'Source Field', value: 'event_time' },
          { label: 'Target Field', value: 'event_time_utc' },
          { label: 'Input Format', value: 'unix_ms' },
          { label: 'Output Format', value: 'utc_iso8601' },
          { label: 'Timezone', value: 'custom:Asia/Seoul' },
          { label: 'On Failure', value: 'set_null' },
          { label: 'Enabled', value: 'true' },
        ]),
        section('Type Conversion', [
          { label: 'Source Field', value: 'severity' },
          { label: 'Target Field', value: 'severity_int' },
          { label: 'Target Type', value: 'integer' },
          { label: 'On Failure', value: 'keep_original' },
          { label: 'Enabled', value: 'true' },
        ]),
        section('Normalize', [
          { label: 'Source Field', value: 'raw_email' },
          { label: 'Target Field', value: 'email_norm' },
          { label: 'Operation', value: 'normalize_email' },
          { label: 'On Failure', value: 'keep_original' },
          { label: 'Enabled', value: 'true' },
        ]),
        section('JSONata Template', [
          { label: 'Template Name', value: 'Copy Field' },
          { label: 'Template', value: 'copy_field' },
          { label: 'Template Params', value: '{"source_field":"hostname"}' },
          { label: 'Target Field', value: 'host_copy' },
          { label: 'Generated Expression', value: 'hostname' },
          { label: 'Expression', value: 'hostname' },
          { label: 'Advanced Override', value: 'false' },
          { label: 'Enabled', value: 'true' },
        ]),
      ],
    })

    render(
      <MemoryRouter>
        <StreamConfigurationTab streamId={42} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('stream-configuration-tab')).toBeInTheDocument()
    })

    expect(screen.getByTestId('stream-configuration-section-timestamp-conversion')).toHaveTextContent(
      'Timestamp Conversion',
    )
    expect(screen.getByTestId('stream-configuration-section-timestamp-conversion')).toHaveTextContent('event_time')
    expect(screen.getByTestId('stream-configuration-section-timestamp-conversion')).toHaveTextContent('unix_ms')
    expect(screen.getByTestId('stream-configuration-section-timestamp-conversion')).toHaveTextContent('set_null')

    expect(screen.getByTestId('stream-configuration-section-type-conversion')).toHaveTextContent('integer')
    expect(screen.getByTestId('stream-configuration-section-normalize')).toHaveTextContent('normalize_email')
    expect(screen.getByTestId('stream-configuration-section-jsonata-template')).toHaveTextContent('copy_field')
    expect(screen.getByTestId('stream-configuration-section-jsonata-template')).toHaveTextContent('hostname')
  })

  it('shows empty rule state when sections report Not configured', async () => {
    vi.mocked(gdcStreamConfiguration.fetchStreamConfiguration).mockResolvedValue({
      stream_id: 7,
      stream_name: 'empty',
      message: 'ok',
      sections: [
        section('Timestamp Conversion', [{ label: 'Rules', value: 'Not configured', configured: false }]),
        section('Type Conversion', [{ label: 'Rules', value: 'Not configured', configured: false }]),
        section('Normalize', [{ label: 'Rules', value: 'Not configured', configured: false }]),
        section('JSONata Template', [{ label: 'Rules', value: 'Not configured', configured: false }]),
      ],
    })

    render(
      <MemoryRouter>
        <StreamConfigurationTab streamId={7} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('stream-configuration-section-timestamp-conversion')).toBeInTheDocument()
    })
    expect(screen.getByTestId('stream-configuration-section-timestamp-conversion')).toHaveTextContent('Not configured')
    expect(screen.getByTestId('stream-configuration-section-type-conversion')).toHaveTextContent('Not configured')
    expect(screen.getByTestId('stream-configuration-section-normalize')).toHaveTextContent('Not configured')
    expect(screen.getByTestId('stream-configuration-section-jsonata-template')).toHaveTextContent('Not configured')
  })

  it('keeps the page usable when configuration fetch fails', async () => {
    vi.mocked(gdcStreamConfiguration.fetchStreamConfiguration).mockResolvedValue(null)

    render(
      <MemoryRouter>
        <StreamConfigurationTab streamId={9} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText(/Could not load stream configuration/i)).toBeInTheDocument()
    })
    expect(screen.queryByTestId('stream-configuration-tab')).not.toBeInTheDocument()
  })

  it('tolerates partial/missing field labels without crashing', async () => {
    vi.mocked(gdcStreamConfiguration.fetchStreamConfiguration).mockResolvedValue({
      stream_id: 11,
      stream_name: 'partial',
      message: 'ok',
      sections: [
        section('Timestamp Conversion', [{ label: 'Source Field', value: 'only_source' }]),
        section('Type Conversion', []),
        {
          title: 'Normalize',
          fields: [{ label: 'Operation', value: 'normalize_hostname', configured: true, sensitive: false }],
        },
      ],
    })

    render(
      <MemoryRouter>
        <StreamConfigurationTab streamId={11} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('stream-configuration-tab')).toBeInTheDocument()
    })
    expect(screen.getByTestId('stream-configuration-section-timestamp-conversion')).toHaveTextContent('only_source')
    expect(screen.getByTestId('stream-configuration-section-normalize')).toHaveTextContent('normalize_hostname')
    expect(screen.getByTestId('stream-configuration-edit-link')).toBeInTheDocument()
  })
})
