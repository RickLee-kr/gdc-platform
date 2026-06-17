import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { defaultRuleForType } from './wizard/enrichment-rules-model'
import { buildUnionSchema } from '../../utils/unionSchema'
import { UnionSchemaTree } from './union-schema-tree'
import { UnionSchemaTreeDetailLayout } from './union-schema-tree-detail-layout'

describe('UnionSchemaTree generated fields', () => {
  const schema = buildUnionSchema([{ user: 'a', email: 'a@test.com' }])

  const generatedRules = [
    {
      ...defaultRuleForType('static', 0),
      fieldName: 'user_risk',
      staticValue: 'high',
      enabled: true,
    },
    {
      ...defaultRuleForType('calculated', 1),
      fieldName: 'user_department',
      enabled: true,
    },
  ]

  it('shows Generated Fields group with enrichment rules in order', () => {
    render(
      <UnionSchemaTree
        schema={schema}
        search=""
        onPickPath={vi.fn()}
        expandStrategy="all"
        generatedRules={generatedRules}
      />,
    )

    expect(screen.getByTestId('generated-fields-group')).toBeInTheDocument()
    expect(screen.getByText('Generated Fields')).toBeInTheDocument()
    expect(screen.getByTestId('generated-field-node-user_risk')).toBeInTheDocument()
    expect(screen.getByTestId('generated-field-node-user_department')).toBeInTheDocument()
  })

  it('hides Generated Fields group when no visible enrichment rules', () => {
    render(
      <UnionSchemaTree
        schema={schema}
        search=""
        onPickPath={vi.fn()}
        expandStrategy="all"
        generatedRules={[{ ...defaultRuleForType('static', 0), fieldName: '', enabled: true }]}
      />,
    )

    expect(screen.queryByTestId('generated-fields-group')).not.toBeInTheDocument()
  })

  it('does not call onPickPath when a generated field is clicked', async () => {
    const onPickPath = vi.fn()
    const onSelectPath = vi.fn()

    render(
      <UnionSchemaTree
        schema={schema}
        search=""
        onPickPath={onPickPath}
        onSelectPath={onSelectPath}
        expandStrategy="all"
        generatedRules={generatedRules}
      />,
    )

    screen.getByTestId('generated-field-node-user_risk').click()
    expect(onSelectPath).toHaveBeenCalledWith('$.user_risk')
    expect(onPickPath).not.toHaveBeenCalled()
  })
})

describe('UnionSchemaTreeDetailLayout generated fields', () => {
  const schema = buildUnionSchema([{ user: 'a' }])

  it('shows generated field detail with static sample value', () => {
    const generatedRules = [
      {
        ...defaultRuleForType('static', 0),
        fieldName: 'vendor',
        staticValue: 'Acme Corp',
        enabled: true,
      },
    ]

    render(
      <UnionSchemaTreeDetailLayout
        schema={schema}
        search=""
        onPickPath={vi.fn()}
        expandStrategy="all"
        selectedPath="$.vendor"
        onSelectPath={vi.fn()}
        generatedRules={generatedRules}
      />,
    )

    expect(screen.getByText('$.vendor')).toBeInTheDocument()
    expect(screen.getByTestId('generated-field-detail-type')).toHaveTextContent('Static Value')
    expect(screen.getByTestId('union-field-detail-frequency')).toHaveTextContent('generated')
    expect(screen.getByTestId('union-field-detail-samples')).toHaveTextContent('Acme Corp')
  })

  it('shows no sample values for calculated generated fields', () => {
    const generatedRules = [
      {
        ...defaultRuleForType('calculated', 0),
        fieldName: 'user_risk',
        enabled: true,
      },
    ]

    render(
      <UnionSchemaTreeDetailLayout
        schema={schema}
        search=""
        onPickPath={vi.fn()}
        expandStrategy="all"
        selectedPath="$.user_risk"
        onSelectPath={vi.fn()}
        generatedRules={generatedRules}
      />,
    )

    expect(screen.getByTestId('generated-field-detail-type')).toHaveTextContent('Calculated')
    expect(screen.getByTestId('union-field-detail-frequency')).toHaveTextContent('generated')
    expect(screen.getByTestId('union-field-detail-panel')).toHaveTextContent('—')
    expect(screen.queryByTestId('union-field-detail-samples')).not.toBeInTheDocument()
  })
})
