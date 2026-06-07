/**
 * Frontend-only persona mode (M17.4). No backend RBAC — UI separation only.
 */

export const PERSONA_STORAGE_KEY = 'gdc-platform-persona'

export type PlatformPersona = 'connector' | 'governance'

export const PERSONA_CHANGED_EVENT = 'gdc-persona-changed'

export const PERSONA_LABELS: Record<PlatformPersona, string> = {
  connector: 'Connector Operator',
  governance: 'Governance Operator',
}

export function readPersona(): PlatformPersona {
  try {
    const raw = localStorage.getItem(PERSONA_STORAGE_KEY)
    if (raw === 'governance') return 'governance'
    if (raw === 'connector') return 'connector'
  } catch {
    /* ignore */
  }
  return 'connector'
}

export function writePersona(persona: PlatformPersona): void {
  try {
    localStorage.setItem(PERSONA_STORAGE_KEY, persona)
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PERSONA_CHANGED_EVENT))
  }
}

export function isGovernancePersona(): boolean {
  return readPersona() === 'governance'
}

export function isConnectorPersona(): boolean {
  return readPersona() === 'connector'
}
