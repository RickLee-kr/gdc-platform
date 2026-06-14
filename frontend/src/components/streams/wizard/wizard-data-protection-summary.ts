import {
  wizardDataProtectionIntentReady,
  type WizardDataProtectionIntent,
  type WizardDeliveryBehavior,
} from './wizard-state'

const DELIVERY_LABEL: Record<WizardDeliveryBehavior, string> = {
  continue: 'Continue',
  quarantine: 'Quarantine',
  block: 'Block',
}

export function validDataProtectionIntents(intents: readonly WizardDataProtectionIntent[]): WizardDataProtectionIntent[] {
  return intents.filter(wizardDataProtectionIntentReady)
}

export function dataProtectionDeliveryControlsSummary(intents: readonly WizardDataProtectionIntent[]): string {
  const valid = validDataProtectionIntents(intents)
  if (valid.length === 0) return ''
  const seen = new Set<WizardDeliveryBehavior>()
  for (const intent of valid) seen.add(intent.deliveryBehavior)
  const order: WizardDeliveryBehavior[] = ['continue', 'quarantine', 'block']
  return order.filter((b) => seen.has(b)).map((b) => DELIVERY_LABEL[b]).join(' / ')
}
