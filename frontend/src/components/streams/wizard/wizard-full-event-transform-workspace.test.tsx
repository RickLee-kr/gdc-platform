import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WizardFullEventTransformWorkspace } from './wizard-full-event-transform-workspace'

const runTransformPreview = vi.fn()

vi.mock('../../../api/gdcRuntimePreview', () => ({
  runTransformPreview: (...args: unknown[]) => runTransformPreview(...args),
}))

const SAMPLE_EVENT = {
  creationTime: 1673933930200,
  locked: false,
  roles: ['executive', 'user_admin', 'policies_admin', 'sys_admin'],
  username: 'adminuser@mec.ph',
  allowedLoginMethod: 'PASSWORD',
  totpEnabled: false,
}

const JSONATA_EXPRESSION = `{
  "timestamp": creationTime,
  "event_type": "user_account",
  "user": username,
  "domain": $split(username, "@")[1],
  "auth_method": allowedLoginMethod,
  "roles": roles,
  "role_count": $count(roles),
  "account_locked": locked,
  "mfa_enabled": totpEnabled
}`

describe('WizardFullEventTransformWorkspace', () => {
  beforeEach(() => {
    runTransformPreview.mockReset()
  })

  it('requests full_event_jsonata field_mappings and renders transformed JSONata output', async () => {
    runTransformPreview.mockResolvedValue({
      stage: 'mapping',
      input_sample_summary: { is_object: true, top_level_keys: ['username'], top_level_key_count: 1 },
      transformed_result: {
        event_type: 'user_account',
        domain: 'mec.ph',
        role_count: 4,
      },
      field_results: [],
      errors: [],
      warnings: [],
      save_blocked: false,
      duration_ms: 1,
      message: 'Preview OK',
    })

    render(
      <WizardFullEventTransformWorkspace
        sampleEvent={SAMPLE_EVENT}
        jsonataExpression={JSONATA_EXPRESSION}
        onJsonataExpressionChange={() => {}}
        fullEventRegexConfigJson=""
        onFullEventRegexConfigJsonChange={() => {}}
        filterUiMode="advanced"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^Preview$/i }))

    await waitFor(() => {
      expect(runTransformPreview).toHaveBeenCalled()
    })

    expect(runTransformPreview).toHaveBeenCalledWith({
      stage: 'mapping',
      sample_event: SAMPLE_EVENT,
      field_mappings: {
        mapping_mode: 'full_event_jsonata',
        jsonata_expression: JSONATA_EXPRESSION.trim(),
      },
    })

    await waitFor(() => {
      const output = screen.getByText('Final mapped event').parentElement?.querySelector('pre')?.textContent ?? ''
      expect(output).toContain('event_type')
      expect(output).toContain('user_account')
      expect(output).toContain('mec.ph')
      expect(output).toContain('role_count')
      expect(output).not.toContain('adminuser@mec.ph')
    })
  })

  it('shows API errors instead of the source event when JSONata preview fails', async () => {
    runTransformPreview.mockRejectedValue(new Error('JSONata preview request failed'))

    render(
      <WizardFullEventTransformWorkspace
        sampleEvent={SAMPLE_EVENT}
        jsonataExpression={JSONATA_EXPRESSION}
        onJsonataExpressionChange={() => {}}
        fullEventRegexConfigJson=""
        onFullEventRegexConfigJsonChange={() => {}}
        filterUiMode="advanced"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^Preview$/i }))

    await waitFor(() => {
      expect(screen.getByText(/JSONata preview request failed/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/"username": "adminuser@mec.ph"/)).not.toBeInTheDocument()
  })

  it('keeps regex preview behavior unchanged', async () => {
    const regexConfig = JSON.stringify({
      preserve_source: false,
      rules: [
        {
          output_field: 'domain',
          source_path: '$.username',
          pattern: '^([^@]+)@(.+)$',
          group: 2,
          default: 'unknown_domain',
        },
      ],
    })

    runTransformPreview.mockResolvedValue({
      stage: 'mapping',
      input_sample_summary: { is_object: true, top_level_keys: ['username'], top_level_key_count: 1 },
      transformed_result: { domain: 'mec.ph' },
      field_results: [],
      errors: [],
      warnings: [],
      save_blocked: false,
      duration_ms: 1,
      message: 'Preview OK',
    })

    render(
      <WizardFullEventTransformWorkspace
        sampleEvent={SAMPLE_EVENT}
        jsonataExpression=""
        onJsonataExpressionChange={() => {}}
        fullEventRegexConfigJson={regexConfig}
        onFullEventRegexConfigJsonChange={() => {}}
        filterUiMode="expert"
      />,
    )

    await waitFor(() => {
      const output = screen.getByText('Final mapped event').parentElement?.querySelector('pre')?.textContent ?? ''
      expect(output).toContain('mec.ph')
    })
  })
})
