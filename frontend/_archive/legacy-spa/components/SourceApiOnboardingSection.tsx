import { useMemo } from 'react'
import type { TabKey } from '../runtimeTypes'
import { validateSourceSavePayload, validateStreamSavePayload } from '../utils/runtimeConfigValidation'
import { RUNTIME_MESSAGES } from '../utils/runtimeMessages'
import type { PersistedIds } from '../utils/runtimeState'
import { computeSourceApiOnboardingChecklist } from '../utils/sourceApiOnboarding'
import { RuntimeMessage } from './runtime/RuntimeAlert'

export type SourceApiOnboardingSectionProps = {
  ids: PersistedIds
  compactIdsLine: string
  sourceSave: string
  streamSave: string
  apiTestSource: string
  apiTestStream: string
  ctlRawResponse: string
  ctlEventArrayPath: string
  apiTestRawResponseAvailable: boolean
  mappingRawResponseJson: string
  onOpenRuntimeConfigTab: (tab: TabKey) => void
  onOpenRuntimeTestApiPanel: () => void
}

export function SourceApiOnboardingSection(p: SourceApiOnboardingSectionProps) {
  const sourceValidation = useMemo(() => validateSourceSavePayload(p.sourceSave), [p.sourceSave])
  const streamValidation = useMemo(() => validateStreamSavePayload(p.streamSave), [p.streamSave])
  const checklist = useMemo(
    () =>
      computeSourceApiOnboardingChecklist({
        ids: p.ids,
        sourceSave: p.sourceSave,
        streamSave: p.streamSave,
        apiTestSource: p.apiTestSource,
        apiTestStream: p.apiTestStream,
        ctlRawResponse: p.ctlRawResponse,
        ctlEventArrayPath: p.ctlEventArrayPath,
        apiTestRawResponseAvailable: p.apiTestRawResponseAvailable,
        mappingRawResponseJson: p.mappingRawResponseJson,
      }),
    [
      p.ids,
      p.sourceSave,
      p.streamSave,
      p.apiTestSource,
      p.apiTestStream,
      p.ctlRawResponse,
      p.ctlEventArrayPath,
      p.apiTestRawResponseAvailable,
      p.mappingRawResponseJson,
    ],
  )

  return (
    <section
      className="panel source-api-onboarding-panel panel-scroll"
      role="region"
      aria-label={RUNTIME_MESSAGES.sourceApiOnboardingRegionLabel}
    >
      <h2 className="ui-section-header">{RUNTIME_MESSAGES.sourceApiOnboardingTitle}</h2>
      <RuntimeMessage tone="muted" as="div">
        {RUNTIME_MESSAGES.sourceApiOnboardingIntro}
      </RuntimeMessage>

      <div className="source-api-guidance-block ui-helper-block">
        <RuntimeMessage tone="warning-banner" as="div">
          {RUNTIME_MESSAGES.sourceApiGuidancePreviewOnlyLine}
        </RuntimeMessage>
        <RuntimeMessage tone="obs-hint" as="div">
          {RUNTIME_MESSAGES.sourceApiGuidanceSaveRuntimeConfig}
        </RuntimeMessage>
        <RuntimeMessage tone="obs-hint" as="div">
          {RUNTIME_MESSAGES.sourceApiGuidanceEventArrayPath}
        </RuntimeMessage>
        <RuntimeMessage tone="muted" as="div">
          {RUNTIME_MESSAGES.sourceApiGuidanceNoCheckpointLine}
        </RuntimeMessage>
      </div>

      <p className="source-api-compact-ids">
        <strong>Toolbar IDs:</strong> <code>{p.compactIdsLine}</code>
      </p>

      <div className="source-api-checklist" aria-label={RUNTIME_MESSAGES.sourceApiChecklistHeading}>
        <h3 className="source-api-subheading">{RUNTIME_MESSAGES.sourceApiChecklistHeading}</h3>
        <ul className="source-api-checklist-list">
          {checklist.map((row) => (
            <li key={row.key} className={row.ok ? 'source-api-check-ok' : 'source-api-check-no'}>
              <span className="source-api-check-mark" aria-hidden="true">
                {row.ok ? '✓' : '○'}
              </span>
              {row.label}
            </li>
          ))}
        </ul>
      </div>

      <div className="source-api-validation-hints">
        <h3 className="source-api-subheading">{RUNTIME_MESSAGES.sourceApiValidationHeading}</h3>
        <RuntimeMessage tone="obs-hint">{RUNTIME_MESSAGES.frontendHintLabel}</RuntimeMessage>
        <ul className="frontend-hint-list">
          {sourceValidation.hints.map((hint) => (
            <li key={`source-${hint}`}>{hint}</li>
          ))}
          {streamValidation.hints.map((hint) => (
            <li key={`stream-${hint}`}>{hint}</li>
          ))}
          {sourceValidation.hints.length + streamValidation.hints.length === 0 ? <li>No Source/Stream hint found.</li> : null}
        </ul>
      </div>

      <div className="source-api-quick-nav">
        <h3 className="source-api-subheading">{RUNTIME_MESSAGES.sourceApiQuickNavHeading}</h3>
        <div className="source-api-quick-nav-buttons ui-action-group" role="group" aria-label="Source API onboarding quick navigation">
          <button type="button" className="source-api-nav-btn" onClick={() => p.onOpenRuntimeConfigTab('source')}>
            {RUNTIME_MESSAGES.sourceApiNavRuntimeSource}
          </button>
          <button type="button" className="source-api-nav-btn" onClick={() => p.onOpenRuntimeConfigTab('stream')}>
            {RUNTIME_MESSAGES.sourceApiNavRuntimeStream}
          </button>
          <button type="button" className="source-api-nav-btn" onClick={() => p.onOpenRuntimeTestApiPanel()}>
            {RUNTIME_MESSAGES.sourceApiNavControlApiTest}
          </button>
          <button type="button" className="source-api-nav-btn" onClick={() => p.onOpenRuntimeConfigTab('mapping')}>
            {RUNTIME_MESSAGES.sourceApiNavRuntimeMapping}
          </button>
        </div>
      </div>

      <div className="source-api-flow">
        <h3 className="source-api-subheading">{RUNTIME_MESSAGES.sourceApiFlowHeading}</h3>
        <ol className="source-api-flow-list">
          <li>
            Confirm <code>connector_id</code> in the toolbar and load/save Connector when needed (Runtime Config).
          </li>
          <li>
            Edit Source HTTP base/auth/config JSON — save via Runtime Config Source tab <strong>Save</strong>.
          </li>
          <li>
            Edit Stream endpoint/method/body/params JSON — save via Runtime Config Stream tab <strong>Save</strong>.
          </li>
          <li>
            Open <strong>{RUNTIME_MESSAGES.sourceApiNavControlApiTest}</strong>, mirror configs into API Test payloads
            if needed, run preview, inspect <code>raw_response</code> / extracted events.
          </li>
          <li>
            Set <code>event_array_path</code> to match the batch you need, re-run preview to validate extraction.
          </li>
          <li>
            Paste or sync <code>raw_response</code> into Runtime Config Mapping and continue mapping/enrichment preview
            there.
          </li>
        </ol>
      </div>
    </section>
  )
}
