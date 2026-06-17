import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildUnionSchema } from '../../utils/unionSchema'
import { UnionSchemaTree } from './union-schema-tree'

describe('UnionSchemaTree', () => {
  it('shows occurrence_count as N/M for union fields', () => {
    const schema = buildUnionSchema([
      { user: 'a', email: 'a@test.com', phone: '010' },
      { user: 'b', email: 'b@test.com' },
      { user: 'c', email: 'c@test.com' },
    ])

    render(<UnionSchemaTree schema={schema} search="" onPickPath={vi.fn()} expandStrategy="all" />)

    expect(screen.getByTestId('union-schema-tree')).toBeInTheDocument()
    expect(screen.getByTitle('$.user')).toHaveTextContent('3/3')
    expect(screen.getByTitle('$.email')).toHaveTextContent('3/3')
    expect(screen.getByTitle('$.phone')).toHaveTextContent('1/3')
  })

  it('shows rare badge for fields below the 30% occurrence threshold', () => {
    const schema = buildUnionSchema(
      Array.from({ length: 10 }, (_, i) => (i < 2 ? { user: `u${i}`, phone: '010' } : { user: `u${i}` })),
    )

    render(<UnionSchemaTree schema={schema} search="" onPickPath={vi.fn()} expandStrategy="all" />)

    const tree = screen.getByTestId('union-schema-tree')
    expect(tree).toHaveTextContent('phone')
    expect(tree).toHaveTextContent('2/10')
    const phoneRow = screen.getByTitle('$.phone').closest('.group')
    expect(phoneRow).toHaveTextContent('rare')
  })

  it('does not show rare badge at exactly 30% occurrence', () => {
    const schema = buildUnionSchema(
      Array.from({ length: 10 }, (_, i) => (i < 3 ? { user: `u${i}`, phone: '010' } : { user: `u${i}` })),
    )

    render(<UnionSchemaTree schema={schema} search="" onPickPath={vi.fn()} expandStrategy="all" />)

    const phoneRow = screen.getByTitle('$.phone').closest('.group')
    expect(phoneRow).toHaveTextContent('3/10')
    expect(phoneRow).not.toHaveTextContent('rare')
  })

  it('shows sensitive badge for likely sensitive union fields', () => {
    const schema = buildUnionSchema([
      { status: 'ok', email: 'a@test.com' },
      { status: 'ok', email: 'b@test.com' },
      { status: 'ok', email: 'c@test.com' },
    ])

    render(<UnionSchemaTree schema={schema} search="" onPickPath={vi.fn()} expandStrategy="all" />)

    const emailRow = screen.getByTitle('$.email').closest('.group')
    expect(emailRow).toHaveTextContent('email')
    expect(emailRow).toHaveTextContent('sensitive')
  })

  it('does not show sensitive badge for non-matching fields', () => {
    const schema = buildUnionSchema([
      { status: 'ok', user: 'alice', id: '1' },
      { status: 'ok', user: 'bob', id: '2' },
    ])

    render(<UnionSchemaTree schema={schema} search="" onPickPath={vi.fn()} expandStrategy="all" />)

    const statusRow = screen.getByTitle('$.status').closest('.group')
    expect(statusRow).not.toHaveTextContent('sensitive')
    const userRow = screen.getByTitle('$.user').closest('.group')
    expect(userRow).not.toHaveTextContent('sensitive')
  })

  it('shows sensitive badge for email sample values on generic field names', () => {
    const schema = buildUnionSchema([{ contact: 'user@example.com' }])

    render(<UnionSchemaTree schema={schema} search="" onPickPath={vi.fn()} expandStrategy="all" />)

    const contactRow = screen.getByTitle('$.contact').closest('.group')
    expect(contactRow).toHaveTextContent('sensitive')
  })

  it('calls onSelectPath and onPickPath when a field is clicked', () => {
    const schema = buildUnionSchema([{ user: 'a' }])
    const onPickPath = vi.fn()
    const onSelectPath = vi.fn()

    render(
      <UnionSchemaTree
        schema={schema}
        search=""
        onPickPath={onPickPath}
        onSelectPath={onSelectPath}
        selectedPath="$.user"
        expandStrategy="all"
      />,
    )

    screen.getByTitle('$.user').click()
    expect(onSelectPath).toHaveBeenCalledWith('$.user')
    expect(onPickPath).toHaveBeenCalledWith('$.user')
    expect(screen.getByTitle('$.user')).toHaveAttribute('aria-pressed', 'true')
  })
})
