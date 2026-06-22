import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MappingJsonTree } from './mapping-json-tree'

describe('MappingJsonTree', () => {
  it('renders nested object with row count and type label', () => {
    render(
      <MappingJsonTree
        value={{ data: { items: [{ id: 'a' }] } }}
        baseLabel=""
        basePath="$"
        search=""
        onPickPath={() => {}}
        expandStrategy="all"
      />,
    )
    expect(screen.getByText(/items/)).toBeTruthy()
    expect(screen.getAllByText(/^object$/).length).toBeGreaterThan(0)
  })

  it('click-to-map invokes onPickPath with JSONPath', () => {
    const onPickPath = vi.fn()
    render(
      <MappingJsonTree
        value={{ event_id: 'evt-1' }}
        baseLabel=""
        basePath="$"
        search=""
        onPickPath={onPickPath}
        expandStrategy="all"
      />,
    )
    fireEvent.click(screen.getByTitle('Click to map this field'))
    expect(onPickPath).toHaveBeenCalledWith('$.event_id')
  })

  it('copy JSONPath button is present on scalar fields', () => {
    render(
      <MappingJsonTree
        value={{ severity: 'high' }}
        baseLabel=""
        basePath="$"
        search=""
        onPickPath={() => {}}
        expandStrategy="all"
      />,
    )
    expect(screen.getAllByLabelText(/Copy JSONPath/).length).toBeGreaterThan(0)
  })

  it('hides copy JSONPath buttons when showCopyPath is false', () => {
    render(
      <MappingJsonTree
        value={{ severity: 'high' }}
        baseLabel=""
        basePath="$"
        search=""
        onPickPath={() => {}}
        expandStrategy="all"
        showCopyPath={false}
      />,
    )
    expect(screen.queryByLabelText(/Copy JSONPath/)).not.toBeInTheDocument()
  })
})
