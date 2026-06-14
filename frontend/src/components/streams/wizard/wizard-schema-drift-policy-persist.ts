import { updateStream } from '../../../api/gdcStreams'
import {
  normalizeUnknownNormalFieldPolicy,
  normalizeUnknownSensitiveFieldPolicy,
  type WizardDataProtectionState,
} from './wizard-state'

export type SchemaDriftPolicyPersistPayload = {
  unknown_normal_field_policy: ReturnType<typeof normalizeUnknownNormalFieldPolicy>
  unknown_sensitive_field_policy: ReturnType<typeof normalizeUnknownSensitiveFieldPolicy>
}

export type SchemaDriftPolicyPersistResult = {
  saved: boolean
  errors: string[]
}

export function buildSchemaDriftPolicyPersistPayload(
  dataProtection: Pick<WizardDataProtectionState, 'unknownNormalFieldPolicy' | 'unknownSensitiveFieldPolicy'>,
): SchemaDriftPolicyPersistPayload {
  return {
    unknown_normal_field_policy: normalizeUnknownNormalFieldPolicy(dataProtection.unknownNormalFieldPolicy),
    unknown_sensitive_field_policy: normalizeUnknownSensitiveFieldPolicy(
      dataProtection.unknownSensitiveFieldPolicy,
    ),
  }
}

export async function persistWizardSchemaDriftPolicy(
  streamId: number,
  dataProtection: Pick<WizardDataProtectionState, 'unknownNormalFieldPolicy' | 'unknownSensitiveFieldPolicy'>,
  options?: { existingConfigJson?: Record<string, unknown> | null },
): Promise<SchemaDriftPolicyPersistResult> {
  const policy = buildSchemaDriftPolicyPersistPayload(dataProtection)
  const existing = options?.existingConfigJson ?? {}
  const governance =
    existing.governance && typeof existing.governance === 'object' && !Array.isArray(existing.governance)
      ? { ...(existing.governance as Record<string, unknown>) }
      : {}

  try {
    await updateStream(streamId, {
      config_json: {
        ...existing,
        governance: {
          ...governance,
          schema_drift_policy: policy,
        },
      },
    })
    return { saved: true, errors: [] }
  } catch (err) {
    return {
      saved: false,
      errors: [
        `schema-drift-policy: ${err instanceof Error ? err.message : String(err)}`,
      ],
    }
  }
}
