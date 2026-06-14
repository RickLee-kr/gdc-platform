import { buildUnionSchema, buildRepresentativeEventFromUnionSchema } from '../../../utils/unionSchema'
import { wrapTreeDocument, type MappingSourceSampleResult } from '../../../utils/mappingSourceSample'
import { normalizeGdcStreamSourceType } from '../../../utils/sourceTypePresentation'
import type { MappingRowModel } from '../stream-mapping-model'
import { wizardExtractEvents } from './wizard-json-extract'
import type { WizardMappingRow, WizardState } from './wizard-state'

export function wizardMappingRowsToModel(rows: WizardMappingRow[]): MappingRowModel[] {
  return rows.map((r) => ({
    id: r.id,
    sourceJsonPath: r.sourceJsonPath,
    outputField: r.outputField,
    type: 'string',
    origin: r.origin === 'auto' ? 'auto' : 'manual',
  }))
}

export function mappingModelRowsToWizard(rows: MappingRowModel[]): WizardMappingRow[] {
  return rows.map((r) => ({
    id: r.id,
    sourceJsonPath: r.sourceJsonPath,
    outputField: r.outputField,
    origin: r.origin === 'auto' ? 'auto' : 'manual',
  }))
}

export function buildWizardTransformSample(state: WizardState): MappingSourceSampleResult | null {
  const t = state.apiTest
  const raw = t.parsedJson ?? t.rawResponse
  if (t.status !== 'success' || raw == null) return null

  const eventArrayPath = state.stream.useWholeResponseAsEvent ? '' : state.stream.eventArrayPath.trim()
  const eventRootPath = state.stream.eventRootPath.trim()
  const extracted = wizardExtractEvents(raw, eventArrayPath, eventRootPath)
  const events = extracted.filter(
    (e): e is Record<string, unknown> => e !== null && typeof e === 'object' && !Array.isArray(e),
  )
  const first = events[0] ?? null
  const unionSchema = events.length > 0 ? buildUnionSchema(events) : null
  const sourceType = normalizeGdcStreamSourceType(state.connector.sourceType)

  return {
    ok: true,
    sourceType,
    rawPayload: raw,
    treeDocument: unionSchema
      ? buildRepresentativeEventFromUnionSchema(unionSchema)
      : first ?? wrapTreeDocument(raw),
    extractedEvents: events,
    unionSchema,
    eventArrayPath,
    eventRootPath,
    sampleEventIndex: 0,
    message: events.length === 0 ? 'Confirm Record Path on the Sample step to extract events.' : null,
    recordsLabel: `${events.length} event${events.length === 1 ? '' : 's'}`,
    fetchedAt: t.finishedAt ? new Date(t.finishedAt).toISOString().slice(0, 19).replace('T', ' ') : 'wizard sample',
  }
}

export function wizardTransformSampleReady(state: WizardState): boolean {
  return buildWizardTransformSample(state) != null
}
