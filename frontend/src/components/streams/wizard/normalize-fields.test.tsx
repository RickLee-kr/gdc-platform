import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EnrichmentRulesEditor } from './enrichment-rules-editor'
import {
  defaultRuleForType,
  enrichmentDictFromRules,
  enrichmentRulesFromDict,
} from './enrichment-rules-model'
import { previewNormalizeRule } from './normalize-template'
import type { UnionSchema } from '../../../utils/unionSchema'

const UNION_SCHEMA: UnionSchema = {
  total_events: 10,
  fields: [
    {
      field_path: '$.email',
      field_type: 'string',
      occurrence_count: 10,
      sample_values: ['Test.User@Example.COM'],
    },
    {
      field_path: '$.username',
      field_type: 'string',
      occurrence_count: 8,
      sample_values: ['DOMAIN\\alice'],
    },
  ],
}

describe('Normalize field pickers', () => {
  it('associates Source/Target Field labels with combobox triggers', async () => {
    const user = userEvent.setup()
    const rule = defaultRuleForType('normalize', 0)
    render(
      <EnrichmentRulesEditor
        rules={[rule]}
        onChange={() => {}}
        unionSchema={UNION_SCHEMA}
        targetFieldCandidates={['email']}
      />,
    )
    await user.click(screen.getByLabelText(/Expand rule/i))
    const source = screen.getByTestId('normalize-source-field-trigger')
    const target = screen.getByTestId('normalize-target-field-trigger')
    expect(source.getAttribute('aria-labelledby')).toBeTruthy()
    expect(target.getAttribute('aria-labelledby')).toBeTruthy()
    expect(source).toHaveAttribute('aria-required', 'true')
    expect(target).toHaveAttribute('aria-required', 'true')
    expect(document.getElementById(source.getAttribute('aria-labelledby')!)).toHaveTextContent(/Source Field/i)
    expect(document.getElementById(target.getAttribute('aria-labelledby')!)).toHaveTextContent(/Target Field/i)
  })

  it('lists Union Schema fields as Source Field candidates and supports search', async () => {
    const user = userEvent.setup()
    const rule = defaultRuleForType('normalize', 0)
    render(
      <EnrichmentRulesEditor
        rules={[rule]}
        onChange={() => {}}
        unionSchema={UNION_SCHEMA}
        targetFieldCandidates={['email', 'user.name']}
      />,
    )

    await user.click(screen.getByLabelText(/Expand rule/i))
    await user.click(screen.getByTestId('normalize-source-field-trigger'))
    expect(screen.getByTestId('normalize-source-field-option-email')).toBeInTheDocument()
    expect(screen.getByTestId('normalize-source-field-option-username')).toBeInTheDocument()

    await user.type(screen.getByTestId('normalize-source-field-search'), 'username')
    expect(screen.getByTestId('normalize-source-field-option-username')).toBeInTheDocument()
    expect(screen.queryByTestId('normalize-source-field-option-email')).not.toBeInTheDocument()
  })

  it('preserves a Source Field missing from the current Union Schema', async () => {
    const user = userEvent.setup()
    const rule = {
      ...defaultRuleForType('normalize', 0),
      normalizeSourceField: 'legacy_email',
      fieldName: 'legacy_email',
    }
    render(
      <EnrichmentRulesEditor rules={[rule]} onChange={() => {}} unionSchema={UNION_SCHEMA} />,
    )

    await user.click(screen.getByLabelText(/Expand rule/i))
    expect(screen.getByTestId('normalize-source-field-missing-warning')).toHaveTextContent(
      'This field is not present in the current Union Schema.',
    )
    expect(screen.getByTestId('normalize-source-field-trigger')).toHaveTextContent('legacy_email')
  })

  it('allows selecting an existing Target Field and creating a new one', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const rule = defaultRuleForType('normalize', 0)
    render(
      <EnrichmentRulesEditor
        rules={[rule]}
        onChange={onChange}
        unionSchema={UNION_SCHEMA}
        targetFieldCandidates={['email', 'user.name']}
      />,
    )

    await user.click(screen.getByLabelText(/Expand rule/i))
    await user.click(screen.getByTestId('normalize-target-field-trigger'))
    await user.click(screen.getByTestId('normalize-target-field-option-email'))
    expect(onChange).toHaveBeenCalled()
    const afterSelect = onChange.mock.calls.at(-1)![0][0]
    expect(afterSelect.fieldName).toBe('email')

    onChange.mockClear()
    await user.click(screen.getByTestId('normalize-target-field-trigger'))
    await user.type(screen.getByTestId('normalize-target-field-search'), 'normalized_email')
    await user.click(screen.getByTestId('normalize-target-field-create'))
    const afterCreate = onChange.mock.calls.at(-1)![0][0]
    expect(afterCreate.fieldName).toBe('normalized_email')
  })

  it('does not render a duplicate Target Field input', async () => {
    const user = userEvent.setup()
    const rule = defaultRuleForType('normalize', 0)
    render(
      <EnrichmentRulesEditor rules={[rule]} onChange={() => {}} unionSchema={UNION_SCHEMA} />,
    )
    await user.click(screen.getByLabelText(/Expand rule/i))
    const card = screen.getByTestId('normalize-fields')
    expect(within(card).getAllByText(/^Target Field$/i)).toHaveLength(1)
    expect(screen.queryByPlaceholderText('metadata.field_name')).not.toBeInTheDocument()
    expect(screen.getByTestId('normalize-card-summary')).toHaveTextContent('email → email')
  })

  it('defaults Target Field to Source Field and prefills from selected path', () => {
    const rule = defaultRuleForType('normalize', 0, { sourceField: 'username' })
    expect(rule.normalizeSourceField).toBe('username')
    expect(rule.fieldName).toBe('username')
  })

  it('previews using Union Schema sample_values and updates when Operation changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const rule = {
      ...defaultRuleForType('normalize', 0),
      normalizeSourceField: 'email',
      fieldName: 'email',
      normalizeOperation: 'normalize_email' as const,
    }
    const { rerender } = render(
      <EnrichmentRulesEditor rules={[rule]} onChange={onChange} unionSchema={UNION_SCHEMA} />,
    )
    await user.click(screen.getByLabelText(/Expand rule/i))
    expect(screen.getByTestId('normalize-preview-before')).toHaveTextContent('Test.User@Example.COM')
    expect(screen.getByTestId('normalize-preview-after')).toHaveTextContent('test.user@example.com')

    const upper = {
      ...rule,
      normalizeOperation: 'uppercase' as const,
      normalizeFormat: 'uppercase' as const,
    }
    rerender(<EnrichmentRulesEditor rules={[upper]} onChange={onChange} unionSchema={UNION_SCHEMA} />)
    expect(screen.getByTestId('normalize-preview-after')).toHaveTextContent('TEST.USER@EXAMPLE.COM')
  })

  it('shows a clear message when no sample value is available', async () => {
    const user = userEvent.setup()
    const rule = {
      ...defaultRuleForType('normalize', 0),
      normalizeSourceField: 'missing_field',
      fieldName: 'missing_field',
    }
    render(<EnrichmentRulesEditor rules={[rule]} onChange={() => {}} unionSchema={UNION_SCHEMA} />)
    await user.click(screen.getByLabelText(/Expand rule/i))
    expect(screen.getByTestId('normalize-preview-warning').textContent).toMatch(/Preview unavailable/i)
    expect(screen.getByTestId('normalize-preview-warning').textContent).toMatch(/No sample value/i)
  })

  it('shows why Normalize Email cannot process a bad sample', async () => {
    const user = userEvent.setup()
    const schema: UnionSchema = {
      total_events: 1,
      fields: [
        {
          field_path: '$.hostname',
          field_type: 'string',
          occurrence_count: 1,
          sample_values: ['not-an-email'],
        },
      ],
    }
    const rule = {
      ...defaultRuleForType('normalize', 0),
      normalizeSourceField: 'hostname',
      fieldName: 'hostname',
      normalizeOperation: 'normalize_email' as const,
    }
    render(<EnrichmentRulesEditor rules={[rule]} onChange={() => {}} unionSchema={schema} />)
    await user.click(screen.getByLabelText(/Expand rule/i))
    expect(screen.getByTestId('normalize-preview-warning').textContent).toMatch(/Preview unavailable/i)
    expect(screen.getByTestId('normalize-preview-warning').textContent).toMatch(/Normalize Email/i)
  })

  it('hydrates Edit Wizard settings for normalize rules', () => {
    const rule = {
      ...defaultRuleForType('normalize', 0),
      fieldName: 'email',
      normalizeSourceField: 'raw_email',
      normalizeOperation: 'normalize_email' as const,
      normalizeOnFailure: 'set_null' as const,
    }
    const stored = enrichmentDictFromRules([rule])
    const row = (stored.__rules as Record<string, unknown>).email as Record<string, unknown>
    expect(row).toMatchObject({
      type: 'normalize',
      source_field: 'raw_email',
      operation: 'normalize_email',
      on_failure: 'set_null',
    })
    const restored = enrichmentRulesFromDict(stored as Record<string, unknown>)
    expect(restored[0]).toMatchObject({
      type: 'normalize',
      fieldName: 'email',
      normalizeSourceField: 'raw_email',
      normalizeOperation: 'normalize_email',
      normalizeOnFailure: 'set_null',
    })
  })
})

describe('previewNormalizeRule', () => {
  it('normalizes email sample with Before/After', () => {
    const result = previewNormalizeRule({
      raw: ' Test.User@Example.COM ',
      operation: 'normalize_email',
    })
    expect(result.warning).toBeNull()
    expect(result.before).toBe(' Test.User@Example.COM ')
    expect(result.after).toBe('test.user@example.com')
  })

  it('explains missing sample and operation failures', () => {
    expect(previewNormalizeRule({ raw: undefined, operation: 'normalize_email' }).warning).toMatch(
      /No sample value/,
    )
    expect(previewNormalizeRule({ raw: 'nope', operation: 'normalize_email' }).warning).toMatch(
      /Normalize Email/,
    )
  })
})
