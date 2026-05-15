import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildInitialState } from './wizard-state'
import { StepApiTest } from './step-api-test'

describe('StepApiTest copy', () => {
  it('renders HTTP-specific lead and idle copy', () => {
    const state = buildInitialState()
    state.connector.sourceType = 'HTTP_API_POLLING'
    render(<StepApiTest state={state} onChange={vi.fn()} />)
    expect(screen.getByText(/execute the configured HTTP request/i)).toBeInTheDocument()
    expect(
      screen.getByText(/complete the HTTP endpoint path on the Stream Configuration step/i),
    ).toBeInTheDocument()
  })

  it('renders remote-file-specific lead copy', () => {
    const state = buildInitialState()
    state.connector.sourceType = 'REMOTE_FILE_POLLING'
    render(<StepApiTest state={state} onChange={vi.fn()} />)
    expect(screen.getByText(/SSH\/SFTP/i)).toBeInTheDocument()
    expect(screen.getByText(/matched files/i)).toBeInTheDocument()
  })

  it('renders database-specific lead copy', () => {
    const state = buildInitialState()
    state.connector.sourceType = 'DATABASE_QUERY'
    render(<StepApiTest state={state} onChange={vi.fn()} />)
    expect(screen.getByText(/SELECT-only/i)).toBeInTheDocument()
    expect(screen.getByText(/checkpoint fields/i)).toBeInTheDocument()
  })

  it('renders S3-specific lead copy', () => {
    const state = buildInitialState()
    state.connector.sourceType = 'S3_OBJECT_POLLING'
    render(<StepApiTest state={state} onChange={vi.fn()} />)
    expect(screen.getByText(/Verifies S3 connectivity for the configured bucket/i)).toBeInTheDocument()
    expect(screen.getByText(/how ordering aligns with the checkpoint field/i)).toBeInTheDocument()
  })
})
