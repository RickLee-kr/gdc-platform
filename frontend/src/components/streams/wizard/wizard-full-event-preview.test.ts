import { describe, expect, it } from 'vitest'
import { runWizardLocalTransformPreview } from './wizard-full-event-preview'

const SAMPLE_EVENT = {
  creationTime: 1673933930200,
  locked: false,
  roles: ['executive', 'user_admin', 'policies_admin', 'sys_admin'],
  username: 'adminuser@mec.ph',
  allowedLoginMethod: 'PASSWORD',
  totpEnabled: false,
}

const REGEX_CONFIG = {
  preserve_source: false,
  rules: [
    {
      output_field: 'user',
      source_path: '$.username',
      pattern: '^([^@]+)@(.+)$',
      group: 1,
      default: 'unknown_user',
    },
    {
      output_field: 'domain',
      source_path: '$.username',
      pattern: '^([^@]+)@(.+)$',
      group: 2,
      default: 'unknown_domain',
    },
    {
      output_field: 'auth_method',
      source_path: '$.allowedLoginMethod',
      pattern: '^(.*)$',
      group: 1,
      default: 'UNKNOWN',
    },
    {
      output_field: 'primary_admin_role',
      source_path: '$.roles',
      pattern: '(sys_admin|user_admin|policies_admin)',
      group: 1,
      default: 'standard_user',
    },
  ],
}

const JSONATA_EXPRESSION = `{
  "event_type": "user_account",
  "domain": $split(username, "@")[1],
  "role_count": $count(roles)
}`

describe('runWizardLocalTransformPreview', () => {
  it('does not return the source event when JSONata local preview is unavailable', () => {
    const res = runWizardLocalTransformPreview(SAMPLE_EVENT, {
      isExpert: false,
      expression: JSONATA_EXPRESSION,
    })
    expect(res.errors.length).toBeGreaterThan(0)
    expect(res.save_blocked).toBe(true)
    expect(res.transformed_result).toEqual({})
    expect(res.transformed_result).not.toEqual(SAMPLE_EVENT)
  })

  it('applies full-event regex rules including array source paths', () => {
    const res = runWizardLocalTransformPreview(SAMPLE_EVENT, {
      isExpert: true,
      regexConfig: REGEX_CONFIG,
    })
    expect(res.errors).toEqual([])
    expect(res.transformed_result).toEqual({
      user: 'adminuser',
      domain: 'mec.ph',
      auth_method: 'PASSWORD',
      primary_admin_role: 'user_admin',
    })
  })
})
