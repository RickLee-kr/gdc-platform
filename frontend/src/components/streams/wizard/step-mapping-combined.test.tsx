import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCallback, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { StepMappingCombined } from './step-mapping-combined'
import {
  ENRICHMENT_RULE_TYPES,
  defaultRuleForType,
  enrichmentDictFromRules,
  type EnrichmentRuleType,
  type WizardEnrichmentRule,
} from './enrichment-rules-model'
import { loadWizardDraft, saveWizardDraft, clearWizardDraft } from './wizard-draft-migration'
import { buildInitialState, enrichmentDictFromRows, type WizardState } from './wizard-state'

vi.mock('./wizard-basic-mapping-panel', () => ({
  WizardBasicMappingPanel: () => (
    <div data-testid="wizard-basic-mapping-panel">
      <div data-testid="mapping-source-tree-panel">Sample Event</div>
      <div data-testid="mapping-field-table-panel">Field Mapping</div>
    </div>
  ),
}))

vi.mock('./wizard-full-event-transform-workspace', () => ({
  WizardFullEventTransformWorkspace: ({ filterUiMode }: { filterUiMode?: string }) => (
    <div data-testid="wizard-full-event-transform-workspace" data-filter-ui-mode={filterUiMode ?? ''} />
  ),
}))

function readyTransformState() {
  const state = buildInitialState()
  state.apiTest.status = 'success'
  state.apiTest.parsedJson = { events: [{ id: 'e1', message: 'hello' }] }
  state.apiTest.extractedEvents = [{ id: 'e1', message: 'hello' }]
  state.stream.eventArrayPath = '$.events'
  return state
}

function combinedProps(state: ReturnType<typeof buildInitialState>) {
  return {
    state,
    onChangeMapping: vi.fn(),
    onChangeMappingMode: vi.fn(),
    onChangeFullEventJsonata: vi.fn(),
    onChangeFullEventRegexConfigJson: vi.fn(),
    onChangeEnrichment: vi.fn(),
    onChangeDataProtection: vi.fn(),
  }
}

const RULE_TYPE_LABELS: Record<EnrichmentRuleType, string> = {
  static: 'New Static',
  calculated: 'New Calculated',
  lookup: 'Region Display Name',
  conditional: 'Outcome Status',
  normalize: 'Timestamp ISO',
}

function TransformHarness({
  initialState,
  onState,
}: {
  initialState: WizardState
  onState?: (state: WizardState) => void
}) {
  const [state, setState] = useState(initialState)
  const setEnrichment = useCallback((enrichment: WizardEnrichmentRule[]) => {
    setState((s) => {
      const next = { ...s, enrichment }
      onState?.(next)
      return next
    })
  }, [onState])

  return (
    <StepMappingCombined
      state={state}
      onChangeMapping={(mapping) => setState((s) => ({ ...s, mapping }))}
      onChangeMappingMode={(mappingMode) => setState((s) => ({ ...s, mappingMode }))}
      onChangeFullEventJsonata={(fullEventJsonataExpression) =>
        setState((s) => ({ ...s, fullEventJsonataExpression }))
      }
      onChangeFullEventRegexConfigJson={(fullEventRegexConfigJson) =>
        setState((s) => ({ ...s, fullEventRegexConfigJson }))
      }
      onChangeEnrichment={setEnrichment}
      onChangeDataProtection={() => {}}
    />
  )
}

describe('StepMappingCombined v3 Transform (206f0f7 mapping UI)', () => {
  it('renders three tabs and + Add field action (no Generated Fields tab)', () => {
    render(<StepMappingCombined {...combinedProps(readyTransformState())} />)

    expect(screen.getByTestId('wizard-step-transform')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Basic · JSONPath/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Advanced · JSONata/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Expert · Regex/i })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Generated Fields/i })).not.toBeInTheDocument()
    expect(screen.getByTestId('wizard-transform-add-field-menu')).toBeInTheDocument()
    expect(screen.getByTestId('wizard-transform-enrichment-editor')).toBeInTheDocument()
    expect(screen.getByTestId('wizard-transform-data-protection-card')).toBeInTheDocument()
    expect(screen.queryByTestId('wizard-generated-fields-panel')).not.toBeInTheDocument()
    expect(screen.queryByText(/Generated Fields/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('wizard-transform-sections')).not.toBeInTheDocument()
  })

  it('shows basic mapping panel on Basic tab', () => {
    render(<StepMappingCombined {...combinedProps(readyTransformState())} />)

    expect(screen.getByTestId('wizard-basic-mapping-panel')).toBeInTheDocument()
    expect(screen.getByTestId('mapping-source-tree-panel')).toHaveTextContent('Sample Event')
    expect(screen.getByTestId('mapping-field-table-panel')).toHaveTextContent('Field Mapping')
  })

  it('switches to full-event workspace on Advanced and Expert tabs', async () => {
    const user = userEvent.setup()
    render(<StepMappingCombined {...combinedProps(readyTransformState())} />)

    await user.click(screen.getByRole('tab', { name: /Advanced · JSONata/i }))
    expect(screen.getByTestId('wizard-full-event-transform-workspace')).toHaveAttribute(
      'data-filter-ui-mode',
      'advanced',
    )
    expect(screen.queryByTestId('wizard-basic-mapping-panel')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /Expert · Regex/i }))
    expect(screen.getByTestId('wizard-full-event-transform-workspace')).toHaveAttribute(
      'data-filter-ui-mode',
      'expert',
    )
  })

  it('opens 206f0f7 enrichment add-field menu from + Add field while staying on current tab', async () => {
    const user = userEvent.setup()
    const props = combinedProps(readyTransformState())
    render(<StepMappingCombined {...props} />)

    expect(screen.getByTestId('wizard-basic-mapping-panel')).toBeInTheDocument()

    await user.click(screen.getByTestId('wizard-transform-add-field-trigger'))
    for (const meta of ENRICHMENT_RULE_TYPES) {
      expect(screen.getByTestId(`wizard-enrichment-add-${meta.type}`)).toBeInTheDocument()
    }

    await user.click(screen.getByTestId('wizard-enrichment-add-calculated'))
    expect(props.onChangeEnrichment).toHaveBeenCalled()
    expect(screen.getByTestId('wizard-basic-mapping-panel')).toBeInTheDocument()
  })

  it.each(ENRICHMENT_RULE_TYPES.map((meta) => [meta.type] as const))(
    'add-field menu creates a visible %s enrichment rule in wizard state',
    async (type) => {
      const user = userEvent.setup()
      render(<TransformHarness initialState={readyTransformState()} />)

      await user.click(screen.getByTestId('wizard-transform-add-field-trigger'))
      await user.click(screen.getByTestId(`wizard-enrichment-add-${type}`))

      expect(screen.getByText(RULE_TYPE_LABELS[type])).toBeInTheDocument()
      expect(screen.getByTestId('wizard-transform-enrichment-editor')).toHaveTextContent('1 total')
    },
  )

  it('persists added enrichment rules through draft save and restore', async () => {
    const user = userEvent.setup()
    clearWizardDraft()
    let latestState: WizardState | undefined
    render(<TransformHarness initialState={readyTransformState()} onState={(s) => { latestState = s }} />)

    await user.click(screen.getByTestId('wizard-transform-add-field-trigger'))
    await user.click(screen.getByTestId('wizard-enrichment-add-static'))
    await user.click(screen.getByTestId('wizard-transform-add-field-trigger'))
    await user.click(screen.getByTestId('wizard-enrichment-add-lookup'))

    await waitFor(() => {
      expect(latestState?.enrichment).toHaveLength(2)
    })

    saveWizardDraft(latestState!, 'route_processing')
    const restored = loadWizardDraft()
    expect(restored?.state.enrichment).toHaveLength(2)
    expect(restored?.state.enrichment[0]?.type).toBe('static')
    expect(restored?.state.enrichment[1]?.type).toBe('lookup')
    clearWizardDraft()
  })

  it('includes created enrichment rules in mapping-ui save payload adapter', () => {
    const rules = [
      defaultRuleForType('static', 0),
      defaultRuleForType('calculated', 1),
      defaultRuleForType('conditional', 2),
    ]

    const payload = enrichmentDictFromRows(rules)
    expect(payload['metadata.field_1']).toBe('')
    expect(payload.__rules).toBeDefined()
    expect((payload.__rules as Record<string, unknown>)['metadata.field_2']).toMatchObject({
      type: 'calculated',
    })
    expect((payload.__rules as Record<string, unknown>)['metadata.outcome']).toMatchObject({
      type: 'conditional',
    })
    expect(enrichmentDictFromRules(rules)).toEqual(payload)
  })

  it('blocks Transform until sample is ready', () => {
    render(<StepMappingCombined {...combinedProps(buildInitialState())} />)

    expect(screen.getByText(/Sample & Record Selection/i)).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Basic · JSONPath/i })).not.toBeInTheDocument()
  })
})
