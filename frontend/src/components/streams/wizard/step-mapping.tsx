import { useCallback, useMemo } from 'react'
import { MappingWorkspace } from '../../mappings/mapping-workspace'
import type { AdvancedTransformRuleDraft } from '../../../types/advancedTransform'
import { wrapTreeDocument, type MappingSourceSampleResult } from '../../../utils/mappingSourceSample'
import type { MappingRowModel } from '../stream-mapping-model'
import { enrichmentDictFromRules } from './enrichment-rules-model'
import type { WizardMappingRow, WizardState } from './wizard-state'

type StepMappingProps = {
  state: WizardState
  onChangeMapping: (rows: WizardMappingRow[]) => void
  transformRules: AdvancedTransformRuleDraft[]
  onChangeTransformRules: (rules: AdvancedTransformRuleDraft[]) => void
}

function wizardRowToModel(row: WizardMappingRow): MappingRowModel {
  return {
    id: row.id,
    sourceJsonPath: row.sourceJsonPath,
    outputField: row.outputField,
    type: 'string',
    origin: row.origin === 'stellar' || row.origin === 'auto' ? 'auto' : 'manual',
  }
}

function modelRowToWizard(row: MappingRowModel): WizardMappingRow {
  return {
    id: row.id,
    sourceJsonPath: row.sourceJsonPath,
    outputField: row.outputField,
    origin: row.origin === 'auto' ? 'auto' : 'manual',
  }
}

function buildWizardMappingSample(state: WizardState): MappingSourceSampleResult | null {
  const t = state.apiTest
  const rawPayload = t.parsedJson ?? t.rawResponse
  if (t.status !== 'success' || rawPayload == null) return null

  const extracted = t.extractedEvents
  const eventArrayPath = state.stream.useWholeResponseAsEvent ? '' : state.stream.eventArrayPath
  const eventRootPath = state.stream.eventRootPath

  return {
    ok: true,
    sourceType: state.connector.sourceType,
    rawPayload,
    treeDocument: wrapTreeDocument(extracted[0] ?? rawPayload),
    extractedEvents: extracted,
    eventArrayPath,
    eventRootPath,
    sampleEventIndex: 0,
    message: null,
    recordsLabel: `${extracted.length} event${extracted.length === 1 ? '' : 's'}`,
    fetchedAt: t.finishedAt != null ? new Date(t.finishedAt).toLocaleString() : 'Wizard sample',
  }
}

export function StepMapping({
  state,
  onChangeMapping,
  transformRules,
  onChangeTransformRules,
}: StepMappingProps) {
  const externalSample = useMemo(() => buildWizardMappingSample(state), [state])
  const initialRows = useMemo(() => state.mapping.map(wizardRowToModel), [state.mapping])
  const enrichment = useMemo(() => enrichmentDictFromRules(state.enrichment), [state.enrichment])

  const eventArrayPath = state.stream.useWholeResponseAsEvent ? '' : state.stream.eventArrayPath
  const eventRootPath = state.stream.eventRootPath

  const handleRowsChange = useCallback(
    (rows: MappingRowModel[]) => {
      onChangeMapping(rows.map(modelRowToWizard))
    },
    [onChangeMapping],
  )

  if (externalSample == null) {
    return (
      <section className="rounded-xl border border-dashed border-slate-300/90 bg-slate-50/40 p-6 text-center dark:border-gdc-border dark:bg-gdc-card">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Field Mapping</h3>
        <p className="mx-auto mt-2 max-w-md text-[12px] leading-relaxed text-slate-600 dark:text-gdc-muted">
          Complete <span className="font-semibold">JSON Preview</span> first — mapping uses the extracted sample from API Test.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
      <header className="mb-3 space-y-1">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Field Mapping</h3>
        <p className="text-[12px] leading-relaxed text-slate-600 dark:text-gdc-muted">
          Map source fields with JSONPath (Basic), JSONata expressions (Advanced), or regex extract (Expert). Rules are saved with
          the stream at creation.
        </p>
      </header>
      <MappingWorkspace
        streamId={null}
        streamTitle={state.stream.name.trim() || 'New stream'}
        connectorLabel={state.connector.connectorName.trim() || 'Connector'}
        sourceType={state.connector.sourceType}
        initialRows={initialRows}
        enrichment={enrichment}
        eventArrayPath={eventArrayPath}
        eventRootPath={eventRootPath}
        onRowsChange={handleRowsChange}
        transformRules={transformRules}
        onTransformRulesChange={onChangeTransformRules}
        externalSample={externalSample}
      />
    </section>
  )
}
