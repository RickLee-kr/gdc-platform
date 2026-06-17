import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { buildUnionSchema } from '../../utils/unionSchema'
import { UnionFieldDetailPanel } from './union-field-detail-panel'

describe('UnionFieldDetailPanel', () => {
  it('shows placeholder when no field is selected', () => {
    const schema = buildUnionSchema([{ email: 'a@test.com' }])
    render(<UnionFieldDetailPanel field={null} schema={schema} />)
    expect(screen.getByTestId('union-field-detail-panel')).toHaveTextContent('Select a field to view details')
  })

  it('shows frequency, rare, sensitive, suggested type, and sample values', () => {
    const schema = buildUnionSchema(
      Array.from({ length: 10 }, (_, i) =>
        i < 2
          ? { email: `u${i}@test.com`, phone: '010' }
          : { email: `u${i}@test.com` },
      ),
    )
    const emailField = schema.fields.find((f) => f.field_path === '$.email')
    const phoneField = schema.fields.find((f) => f.field_path === '$.phone')
    expect(emailField).toBeDefined()
    expect(phoneField).toBeDefined()

    const { rerender } = render(<UnionFieldDetailPanel field={emailField!} schema={schema} />)
    expect(screen.getByText('$.email')).toBeInTheDocument()
    expect(screen.getByTestId('union-field-detail-frequency')).toHaveTextContent('10/10')
    expect(screen.getByTestId('union-field-detail-sensitive')).toHaveTextContent('sensitive')
    expect(screen.getByTestId('union-field-detail-suggested-type')).toHaveTextContent('Likely Email')
    expect(screen.getByTestId('union-field-detail-samples').children.length).toBeLessThanOrEqual(5)

    rerender(<UnionFieldDetailPanel field={phoneField!} schema={schema} />)
    expect(screen.getByTestId('union-field-detail-frequency')).toHaveTextContent('2/10')
    expect(screen.getByTestId('union-field-detail-rare')).toHaveTextContent('rare')
    expect(screen.queryByTestId('union-field-detail-sensitive')).not.toBeInTheDocument()
    expect(screen.getByTestId('union-field-detail-suggested-type')).toHaveTextContent('—')
  })
})
