import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { dataProtectionDeliveryControlsSummary } from './wizard-data-protection-summary'
import { WizardTransformDataProtectionCard } from './wizard-transform-data-protection-card'
import { buildInitialState } from './wizard-state'

describe('wizard-data-protection-summary', () => {
  it('summarizes delivery controls for configured intents', () => {
    const summary = dataProtectionDeliveryControlsSummary([
      { key: '1', detectedField: '$.email', protectionAction: 'mask_partial', deliveryBehavior: 'continue' },
      { key: '2', detectedField: '$.ssn', protectionAction: 'mask_full', deliveryBehavior: 'quarantine' },
      { key: '3', detectedField: '$.token', protectionAction: 'hash', deliveryBehavior: 'block' },
    ])
    expect(summary).toBe('Continue / Quarantine / Block')
  })
})

describe('WizardTransformDataProtectionCard', () => {
  it('shows unconfigured summary and opens drawer from Configure', async () => {
    const user = userEvent.setup()
    render(<WizardTransformDataProtectionCard state={buildInitialState()} onChange={vi.fn()} />)

    expect(screen.getByTestId('wizard-transform-data-protection-card')).toBeInTheDocument()
    expect(screen.getByText('Optional')).toBeInTheDocument()
    expect(screen.getByText(/Protect sensitive fields before delivery/i)).toBeInTheDocument()
    expect(screen.getByText(/No rules configured/i)).toBeInTheDocument()

    await user.click(screen.getByTestId('wizard-data-protection-configure'))
    expect(screen.getByTestId('wizard-data-protection-drawer')).toBeInTheDocument()
    expect(screen.getByTestId('wizard-step-data-protection')).toBeInTheDocument()
  })

  it('shows configured summary and Edit action', async () => {
    const user = userEvent.setup()
    const state = buildInitialState()
    state.dataProtection.intents = [
      { key: 'a', detectedField: '$.email', protectionAction: 'mask_partial', deliveryBehavior: 'continue' },
      { key: 'b', detectedField: '$.ssn', protectionAction: 'mask_full', deliveryBehavior: 'quarantine' },
    ]

    render(<WizardTransformDataProtectionCard state={state} onChange={vi.fn()} />)

    expect(screen.getByText(/2 protection intents configured/i)).toBeInTheDocument()
    expect(screen.getByText(/Delivery controls: Continue \/ Quarantine/i)).toBeInTheDocument()

    await user.click(screen.getByTestId('wizard-data-protection-edit'))
    expect(screen.getByTestId('wizard-data-protection-drawer')).toBeInTheDocument()
  })

  it('closes drawer and returns focus to Transform card', async () => {
    const user = userEvent.setup()
    render(<WizardTransformDataProtectionCard state={buildInitialState()} onChange={vi.fn()} />)

    await user.click(screen.getByTestId('wizard-data-protection-configure'))
    await user.click(screen.getByTestId('wizard-data-protection-drawer-close'))
    expect(screen.queryByTestId('wizard-data-protection-drawer')).not.toBeInTheDocument()
    expect(screen.getByTestId('wizard-transform-data-protection-card')).toBeInTheDocument()
  })
})
