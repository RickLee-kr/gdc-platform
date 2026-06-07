import { afterEach, describe, expect, it } from 'vitest'
import {
  PERSONA_STORAGE_KEY,
  isConnectorPersona,
  isGovernancePersona,
  readPersona,
  writePersona,
} from './persona-mode'

afterEach(() => {
  localStorage.removeItem(PERSONA_STORAGE_KEY)
})

describe('persona-mode', () => {
  it('defaults to connector when unset', () => {
    expect(readPersona()).toBe('connector')
    expect(isConnectorPersona()).toBe(true)
    expect(isGovernancePersona()).toBe(false)
  })

  it('persists governance persona', () => {
    writePersona('governance')
    expect(localStorage.getItem(PERSONA_STORAGE_KEY)).toBe('governance')
    expect(readPersona()).toBe('governance')
    expect(isGovernancePersona()).toBe(true)
  })

  it('persists connector persona', () => {
    writePersona('governance')
    writePersona('connector')
    expect(readPersona()).toBe('connector')
  })
})
