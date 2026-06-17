import { inferWizardSensitivityClass } from '../components/streams/wizard/wizard-data-protection-fields'

export function isUnionFieldSensitive(fieldPath: string, label?: string): boolean {
  const sensitivity = inferWizardSensitivityClass(fieldPath)
  return (
    sensitivity === 'secret' ||
    sensitivity === 'pii' ||
    sensitivity === 'security_metadata' ||
    (label ?? '').toLowerCase().includes('credit_card')
  )
}
