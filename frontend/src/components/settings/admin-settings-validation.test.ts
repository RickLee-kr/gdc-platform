import { describe, expect, it } from 'vitest'
import { passwordsMatch, validateNewPassword } from './admin-settings-validation'

describe('admin-settings-validation', () => {
  it('rejects short passwords', () => {
    expect(validateNewPassword('short')).toMatch(/8/)
    expect(validateNewPassword('12345678')).toBeNull()
  })

  it('compares password confirmation', () => {
    expect(passwordsMatch('a', 'a')).toBe(true)
    expect(passwordsMatch('a', 'b')).toBe(false)
  })
})
