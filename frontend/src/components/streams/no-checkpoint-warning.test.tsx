import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NoCheckpointWarning } from './no-checkpoint-warning'

describe('NoCheckpointWarning', () => {
  it('renders when no checkpoint path is configured', () => {
    render(<NoCheckpointWarning checkpointPath="" />)
    const warning = screen.getByTestId('no-checkpoint-warning')
    expect(warning).toBeInTheDocument()
    expect(warning).toHaveTextContent(/No checkpoint variable is configured/i)
  })

  it('renders when only whitespace is configured', () => {
    render(<NoCheckpointWarning checkpointPath="   " secondaryPath="   " />)
    expect(screen.getByTestId('no-checkpoint-warning')).toBeInTheDocument()
  })

  it('stays quiet when a primary checkpoint path is set', () => {
    render(<NoCheckpointWarning checkpointPath="$.event.creationTime" />)
    expect(screen.queryByTestId('no-checkpoint-warning')).not.toBeInTheDocument()
  })

  it('stays quiet when only the secondary checkpoint path is set', () => {
    render(<NoCheckpointWarning checkpointPath="" secondaryPath="$.event.id" />)
    expect(screen.queryByTestId('no-checkpoint-warning')).not.toBeInTheDocument()
  })
})
