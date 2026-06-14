import { createClassificationRule, type ClassificationLevel } from '../../../api/gdcClassification'
import { createPolicyRule, type PolicyActionType } from '../../../api/gdcPolicy'
import { inferWizardSensitivityClass } from './wizard-data-protection-fields'
import {
  wizardDataProtectionIntentReady,
  type WizardDataProtectionIntent,
  type WizardDataProtectionState,
  type WizardDeliveryBehavior,
  type WizardProtectionAction,
  type WizardSensitivityClass,
} from './wizard-state'

export type DataProtectionPersistResult = {
  policyRulesCreated: number
  classificationRulesCreated: number
  enforcementIncomplete: boolean
  saved: boolean
  errors: string[]
  warnings: string[]
}

type AggregatedClassIntent = {
  sensitivityClass: WizardSensitivityClass
  deliveryBehavior: WizardDeliveryBehavior
  classificationLevel: ClassificationLevel | null
  needsFieldProtection: boolean
  fieldPaths: string[]
}

const DELIVERY_STRENGTH: Record<WizardDeliveryBehavior, number> = {
  continue: 0,
  quarantine: 1,
  block: 2,
}

const CLASSIFICATION_STRENGTH: Record<ClassificationLevel, number> = {
  PUBLIC: 0,
  INTERNAL: 1,
  CONFIDENTIAL: 2,
  RESTRICTED: 3,
}

export function protectionActionNeedsFieldRule(action: WizardProtectionAction): boolean {
  return action !== 'audit'
}

function deliveryBehaviorToPolicyAction(behavior: WizardDeliveryBehavior): PolicyActionType {
  if (behavior === 'continue') return 'audit_only'
  return 'quarantine'
}

function classificationLevelForAction(action: WizardProtectionAction): ClassificationLevel | null {
  switch (action) {
    case 'audit':
      return null
    case 'mask_full':
    case 'mask_partial':
    case 'tokenize':
    case 'hash':
      return 'CONFIDENTIAL'
    default:
      return 'CONFIDENTIAL'
  }
}

function aggregateIntents(intents: WizardDataProtectionIntent[]): AggregatedClassIntent[] {
  const byClass = new Map<WizardSensitivityClass, AggregatedClassIntent>()

  for (const intent of intents) {
    if (!wizardDataProtectionIntentReady(intent)) continue
    const fieldPath = intent.detectedField.trim()
    const sensitivityClass = inferWizardSensitivityClass(fieldPath)
    const existing = byClass.get(sensitivityClass)
    const classificationLevel = classificationLevelForAction(intent.protectionAction)
    const needsFieldProtection = protectionActionNeedsFieldRule(intent.protectionAction)

    if (!existing) {
      byClass.set(sensitivityClass, {
        sensitivityClass,
        deliveryBehavior: intent.deliveryBehavior,
        classificationLevel,
        needsFieldProtection,
        fieldPaths: [fieldPath],
      })
      continue
    }

    if (DELIVERY_STRENGTH[intent.deliveryBehavior] > DELIVERY_STRENGTH[existing.deliveryBehavior]) {
      existing.deliveryBehavior = intent.deliveryBehavior
    }
    if (classificationLevel) {
      if (
        !existing.classificationLevel ||
        CLASSIFICATION_STRENGTH[classificationLevel] > CLASSIFICATION_STRENGTH[existing.classificationLevel]
      ) {
        existing.classificationLevel = classificationLevel
      }
    }
    existing.needsFieldProtection = existing.needsFieldProtection || needsFieldProtection
    existing.fieldPaths.push(fieldPath)
  }

  return [...byClass.values()]
}

function policyRuleName(sensitivityClass: WizardSensitivityClass): string {
  switch (sensitivityClass) {
    case 'secret':
      return 'Wizard: secret delivery'
    case 'security_metadata':
      return 'Wizard: security metadata delivery'
    default:
      return 'Wizard: personal data delivery'
  }
}

function classificationRuleName(sensitivityClass: WizardSensitivityClass): string {
  switch (sensitivityClass) {
    case 'secret':
      return 'Wizard: secret classification'
    case 'security_metadata':
      return 'Wizard: security metadata classification'
    default:
      return 'Wizard: personal data classification'
  }
}

export function buildDataProtectionPersistPreview(state: WizardDataProtectionState): {
  aggregated: AggregatedClassIntent[]
  enforcementIncomplete: boolean
  warnings: string[]
} {
  const validIntents = state.intents.filter(wizardDataProtectionIntentReady)
  const aggregated = aggregateIntents(validIntents)
  const enforcementIncomplete = validIntents.some((intent) =>
    protectionActionNeedsFieldRule(intent.protectionAction),
  )
  const warnings: string[] = []

  if (enforcementIncomplete) {
    warnings.push(
      'Field-level protection will apply after runtime detection confirms sensitive fields on this stream.',
    )
  }
  if (validIntents.some((intent) => intent.deliveryBehavior === 'block')) {
    warnings.push('Block delivery is stored as quarantine — the strongest delivery control available before runtime.')
  }

  return { aggregated, enforcementIncomplete, warnings }
}

export async function persistWizardDataProtectionIntents(
  streamId: number,
  state: WizardDataProtectionState,
): Promise<DataProtectionPersistResult> {
  const validIntents = state.intents.filter(wizardDataProtectionIntentReady)
  if (validIntents.length === 0) {
    return {
      policyRulesCreated: 0,
      classificationRulesCreated: 0,
      enforcementIncomplete: false,
      saved: true,
      errors: [],
      warnings: [],
    }
  }

  const preview = buildDataProtectionPersistPreview(state)
  const result: DataProtectionPersistResult = {
    policyRulesCreated: 0,
    classificationRulesCreated: 0,
    enforcementIncomplete: preview.enforcementIncomplete,
    saved: false,
    errors: [],
    warnings: [...preview.warnings],
  }

  for (const group of preview.aggregated) {
    try {
      await createPolicyRule(streamId, {
        name: policyRuleName(group.sensitivityClass),
        enabled: true,
        condition_json: { sensitivity_class: group.sensitivityClass },
        action_type: deliveryBehaviorToPolicyAction(group.deliveryBehavior),
      })
      result.policyRulesCreated += 1
    } catch (err) {
      result.errors.push(
        `policy-rules (${group.sensitivityClass}): ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    if (group.classificationLevel) {
      try {
        await createClassificationRule(streamId, {
          name: classificationRuleName(group.sensitivityClass),
          enabled: true,
          condition_json: { sensitivity_class: group.sensitivityClass },
          classification_level: group.classificationLevel,
        })
        result.classificationRulesCreated += 1
      } catch (err) {
        result.errors.push(
          `classification-rules (${group.sensitivityClass}): ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  result.saved = result.errors.length === 0
  return result
}
