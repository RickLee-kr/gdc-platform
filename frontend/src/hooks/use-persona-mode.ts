import { useCallback, useEffect, useState } from 'react'
import {
  PERSONA_CHANGED_EVENT,
  readPersona,
  writePersona,
  type PlatformPersona,
} from '../utils/persona-mode'

export function usePersonaMode() {
  const [persona, setPersonaState] = useState<PlatformPersona>(() => readPersona())

  useEffect(() => {
    function onPersonaChanged() {
      setPersonaState(readPersona())
    }
    window.addEventListener(PERSONA_CHANGED_EVENT, onPersonaChanged)
    return () => window.removeEventListener(PERSONA_CHANGED_EVENT, onPersonaChanged)
  }, [])

  const setPersona = useCallback((next: PlatformPersona) => {
    writePersona(next)
    setPersonaState(next)
  }, [])

  return {
    persona,
    setPersona,
    isGovernance: persona === 'governance',
    isConnector: persona === 'connector',
  }
}
