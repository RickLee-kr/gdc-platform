import type { WizardApiTestState, WizardHttpApiAnalysis } from '../components/streams/wizard/wizard-state'
import { flattenSampleFields } from '../components/streams/wizard/wizard-json-extract'
import { unionSchemaFromExtractedEvents, type UnionSchema } from './unionSchema'

export function buildApiTestExtractedEventsPatch(
  extractedEvents: Array<Record<string, unknown>>,
  analysis: WizardHttpApiAnalysis | null,
): Pick<WizardApiTestState, 'extractedEvents' | 'eventCount' | 'unionSchema' | 'analysis'> {
  const unionSchema = unionSchemaFromExtractedEvents(extractedEvents)
  const flat = flattenSampleFields(extractedEvents[0] ?? null)
  const nextAnalysis =
    analysis != null
      ? {
          ...analysis,
          sampleEvent: (extractedEvents[0] ?? null) as Record<string, unknown> | null,
          flatPreviewFields: flat.length ? flat : analysis.flatPreviewFields,
        }
      : analysis

  return {
    extractedEvents,
    eventCount: extractedEvents.length,
    unionSchema,
    analysis: nextAnalysis,
  }
}

export function unionSchemaFieldPaths(schema: UnionSchema | null | undefined): string[] {
  if (!schema) return []
  return schema.fields.map((f) => f.field_path)
}
