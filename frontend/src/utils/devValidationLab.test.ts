import { describe, expect, it } from 'vitest'
import { DEV_E2E_VISIBLE_NAME_PREFIX, DEV_VALIDATION_NAME_PREFIX, isDevValidationLabEntityName } from './devValidationLab'

describe('isDevValidationLabEntityName', () => {
  it('matches dev validation lab prefix', () => {
    expect(isDevValidationLabEntityName(`${DEV_VALIDATION_NAME_PREFIX}Generic REST`)).toBe(true)
  })

  it('matches visible E2E fixture prefix', () => {
    expect(isDevValidationLabEntityName(`${DEV_E2E_VISIBLE_NAME_PREFIX}HTTP API Stream`)).toBe(true)
  })

  it('rejects unrelated names', () => {
    expect(isDevValidationLabEntityName('Production HTTP')).toBe(false)
    expect(isDevValidationLabEntityName(null)).toBe(false)
    expect(isDevValidationLabEntityName('')).toBe(false)
  })
})
