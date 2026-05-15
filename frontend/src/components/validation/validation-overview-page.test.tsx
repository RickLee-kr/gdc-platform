import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ValidationOverviewPage } from './validation-overview-page'

const fetchValidationsMock = vi.fn()
const postValidationRunMock = vi.fn()
const fetchRuntimeValidationOperationalSummaryMock = vi.fn()

vi.mock('../../api/gdcValidation', () => ({
  fetchValidations: () => fetchValidationsMock(),
  postValidationRun: (id: number) => postValidationRunMock(id),
}))

vi.mock('../../api/gdcRuntime', () => ({
  fetchRuntimeValidationOperationalSummary: () => fetchRuntimeValidationOperationalSummaryMock(),
}))

function fakeValidation(id: number, name: string, templateKey: string, status: string, streamId: number | null = id) {
  return {
    id,
    name,
    enabled: true,
    validation_type: 'FULL_RUNTIME',
    target_stream_id: streamId,
    template_key: templateKey,
    schedule_seconds: 60,
    expect_checkpoint_advance: true,
    last_run_at: '2026-05-11T12:50:00Z',
    last_status: status,
    last_error: null,
    consecutive_failures: status === 'DEGRADED' ? 2 : 0,
    last_success_at: '2026-05-11T12:49:00Z',
    last_failing_started_at: null,
    last_perf_snapshot_json: null,
    created_at: '2026-05-11T12:49:00Z',
    updated_at: '2026-05-11T12:49:00Z',
  }
}

function emptyOperationalSummary() {
  return {
    failing_validations_count: 0,
    degraded_validations_count: 1,
    open_alerts_critical: 0,
    open_checkpoint_drift_alerts: 0,
    latest_open_alerts: [],
    latest_recoveries: [],
    outcome_trend_24h: [],
  }
}

describe('ValidationOverviewPage — Dev Validation Lab visibility', () => {
  beforeEach(() => {
    fetchValidationsMock.mockReset()
    postValidationRunMock.mockReset()
    fetchRuntimeValidationOperationalSummaryMock.mockReset()
    fetchRuntimeValidationOperationalSummaryMock.mockResolvedValue(emptyOperationalSummary())
  })

  it('renders dev_lab template_key validation rows including DEGRADED row', async () => {
    fetchValidationsMock.mockResolvedValueOnce([
      fakeValidation(1, '[DEV VALIDATION] Validation FULL single-object', 'dev_lab_full_single', 'HEALTHY'),
      fakeValidation(8, '[DEV VALIDATION] Validation FULL delivery-only', 'dev_lab_full_delivery', 'DEGRADED'),
      fakeValidation(99, 'Production checkpoint guard', 'prod_checkpoint', 'HEALTHY'),
    ])

    render(
      <MemoryRouter>
        <ValidationOverviewPage />
      </MemoryRouter>,
    )

    expect(
      await screen.findByText('[DEV VALIDATION] Validation FULL single-object'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('[DEV VALIDATION] Validation FULL delivery-only'),
    ).toBeInTheDocument()
    expect(screen.getByText('Production checkpoint guard')).toBeInTheDocument()

    const degradedPills = screen.getAllByText('DEGRADED')
    expect(degradedPills.length).toBeGreaterThan(0)
    const labBadges = screen.getAllByText('Dev lab')
    expect(labBadges.length).toBe(2)
  })

  it('renders source-expansion lab slice summary when lab S3 / DB rows exist', async () => {
    fetchValidationsMock.mockResolvedValueOnce([
      {
        ...fakeValidation(1, '[DEV VALIDATION] Validation S3', 'dev_lab_s3_object_polling', 'HEALTHY'),
        last_perf_snapshot_json: JSON.stringify({ run_duration_ms: 120, extracted_event_count: 3 }),
      },
      fakeValidation(2, '[DEV VALIDATION] Validation DATABASE', 'dev_lab_db_query_pg', 'DEGRADED'),
    ])

    render(
      <MemoryRouter>
        <ValidationOverviewPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('region', { name: 'Dev validation source lab' })).toBeInTheDocument()
    expect(screen.getByText('S3 lab')).toBeInTheDocument()
    expect(screen.getByText('PostgreSQL query lab')).toBeInTheDocument()
  })

  it('"Dev validation lab only" toggle hides non-lab validation rows', async () => {
    const user = userEvent.setup()
    fetchValidationsMock.mockResolvedValueOnce([
      fakeValidation(1, '[DEV VALIDATION] Validation FULL single-object', 'dev_lab_full_single', 'HEALTHY'),
      fakeValidation(8, '[DEV VALIDATION] Validation FULL delivery-only', 'dev_lab_full_delivery', 'DEGRADED'),
      fakeValidation(99, 'Production checkpoint guard', 'prod_checkpoint', 'HEALTHY'),
    ])

    render(
      <MemoryRouter>
        <ValidationOverviewPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Production checkpoint guard')).toBeInTheDocument()
    const toggle = screen.getByRole('checkbox')
    await user.click(toggle)

    expect(screen.queryByText('Production checkpoint guard')).not.toBeInTheDocument()
    expect(
      screen.getByText('[DEV VALIDATION] Validation FULL delivery-only'),
    ).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Continuous validation definitions' })
    expect(within(table).getByText('DEGRADED')).toBeInTheDocument()
  })
})
