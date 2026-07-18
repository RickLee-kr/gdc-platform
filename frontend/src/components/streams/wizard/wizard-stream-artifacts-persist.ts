import type { WizardState } from './wizard-state'
import { buildWizardSamplePersistPayload, persistWizardSampleData } from './wizard-sample-persist'
import { persistWizardUnionSchema } from './wizard-union-schema-persist'

export type WizardStreamArtifactsPersistResult = {
  errors: string[]
}

/**
 * Unified Create/Edit persist for sample artifacts and union schema.
 * Ensures union_schema, sample_count, event_root, and record_path are saved together.
 */
export async function persistWizardStreamArtifacts(
  streamId: number,
  state: WizardState,
  options?: { existingConfigJson?: Record<string, unknown> | null },
): Promise<WizardStreamArtifactsPersistResult> {
  const errors: string[] = []

  const samplePayload = buildWizardSamplePersistPayload({
    apiTest: state.apiTest,
    stream: state.stream,
    unionSchema: state.apiTest.unionSchema,
    incrementalTestResult: state.stream.incrementalRequestTestResult,
  })

  if (samplePayload) {
    try {
      await persistWizardSampleData(streamId, samplePayload)
    } catch (err) {
      errors.push(`sample-data: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (state.apiTest.unionSchema?.fields?.length) {
    const unionResult = await persistWizardUnionSchema(streamId, state.apiTest.unionSchema, options)
    if (unionResult.errors.length > 0) {
      errors.push(...unionResult.errors)
    }
  }

  return { errors }
}
