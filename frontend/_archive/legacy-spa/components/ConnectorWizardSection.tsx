import { useEffect, useMemo, useState } from 'react'
import type { TabKey } from '../runtimeTypes'
import { RUNTIME_MESSAGES } from '../utils/runtimeMessages'
import type { PersistedIds } from '../utils/runtimeState'
import {
  CONNECTOR_WIZARD_STEP_ORDER,
  computeConnectorWizardStepStatuses,
  countCompletedWizardSteps,
  countMissingWizardSteps,
  countUnsavedWizardSteps,
  firstUnsavedWizardStep,
  firstIncompleteWizardStep,
  formatMappingConfiguredSummary,
  formatWizardMissingSummary,
  wizardEntityStepTotal,
  wizardOpenRuntimeConfigButtonLabel,
} from '../utils/connectorWizard'
import { buildRuntimeReadinessSummary } from '../utils/runtimeReadiness'
import { validateSourceSavePayload, validateStreamSavePayload } from '../utils/runtimeConfigValidation'
import { RuntimeMessage } from './runtime/RuntimeAlert'

export type ConnectorWizardSectionProps = {
  ids: PersistedIds
  compactIdsLine: string
  unsavedByTab: Record<TabKey, string[]>
  recommendedNextAction: string
  mappingRawResponseJson: string
  sourceSave: string
  streamSave: string
  onOpenRuntimeConfigTab: (tab: TabKey) => void
  requestedStepKey?: 'review' | null
}

export function ConnectorWizardSection(p: ConnectorWizardSectionProps) {
  const [stepIndex, setStepIndex] = useState(0)

  useEffect(() => {
    if (p.requestedStepKey === 'review') {
      const reviewIdx = CONNECTOR_WIZARD_STEP_ORDER.findIndex((step) => step.key === 'review')
      if (reviewIdx >= 0) {
        setStepIndex(reviewIdx)
      }
    }
  }, [p.requestedStepKey])

  const statuses = useMemo(
    () => computeConnectorWizardStepStatuses(p.ids, p.unsavedByTab, p.mappingRawResponseJson),
    [p.ids, p.unsavedByTab, p.mappingRawResponseJson],
  )

  const completedEntitySteps = countCompletedWizardSteps(statuses)
  const missingCount = countMissingWizardSteps(statuses)
  const unsavedCount = countUnsavedWizardSteps(statuses)
  const entityTotal = wizardEntityStepTotal()
  const firstMissing = firstIncompleteWizardStep(statuses)
  const firstUnsaved = firstUnsavedWizardStep(statuses)
  const missingSummary = formatWizardMissingSummary(statuses)
  const readiness = buildRuntimeReadinessSummary(p.ids, p.unsavedByTab)

  const currentDef = CONNECTOR_WIZARD_STEP_ORDER[stepIndex]
  const currentStatus = statuses.find((s) => s.key === currentDef.key)
  const reviewMappingLine = formatMappingConfiguredSummary(p.unsavedByTab.mapping)
  const sourceValidation = useMemo(() => validateSourceSavePayload(p.sourceSave), [p.sourceSave])
  const streamValidation = useMemo(() => validateStreamSavePayload(p.streamSave), [p.streamSave])

  return (
    <section
      className="connector-wizard panel panel-scroll"
      role="region"
      aria-label={RUNTIME_MESSAGES.connectorWizardRegionLabel}
    >
      <h2 className="ui-section-header">{RUNTIME_MESSAGES.connectorWizardTitle}</h2>
      <RuntimeMessage tone="obs-hint" as="div">
        {RUNTIME_MESSAGES.connectorWizardIntro}
      </RuntimeMessage>

      <div className="wizard-progress-block ui-helper-block" aria-live="polite">
        <h3 className="wizard-subheading">{RUNTIME_MESSAGES.connectorWizardProgressHeading}</h3>
        <p className="wizard-progress-line">
          <strong>Completed:</strong> {completedEntitySteps}/{entityTotal} entity steps
        </p>
        <p className="wizard-progress-line">
          <strong>Missing / blocking:</strong> {missingSummary}
        </p>
        <p className="wizard-progress-line">
          <strong>Next recommended:</strong> {firstMissing ? firstMissing.label : unsavedCount > 0 ? 'Save unsaved tabs' : 'Review'}
        </p>
      </div>

      <nav className="wizard-step-nav ui-action-group" aria-label={RUNTIME_MESSAGES.connectorWizardStepNavLabel}>
        {CONNECTOR_WIZARD_STEP_ORDER.map((step, i) => {
          const st = statuses.find((x) => x.key === step.key)
          const state = st?.state ?? 'missing'
          return (
            <button
              key={step.key}
              type="button"
              className={`wizard-step-chip ${stepIndex === i ? 'active' : ''} ${state}`}
              onClick={() => setStepIndex(i)}
            >
              <span className="wizard-step-chip-label">{step.label}</span>
              <span className="wizard-step-chip-status">{state}</span>
            </button>
          )
        })}
      </nav>

      <div className="wizard-step-detail">
        <h3 className="wizard-subheading">{RUNTIME_MESSAGES.connectorWizardCurrentStepHeading}</h3>
        <p className="wizard-compact-ids">
          <strong>IDs:</strong> <code>{p.compactIdsLine}</code>
        </p>

        {currentDef.key !== 'review' && currentStatus ? (
          <>
            <p className="wizard-status-row">
              <span className={`wizard-status-badge ${currentStatus.state}`}>
                {currentStatus.state === 'missing' && RUNTIME_MESSAGES.connectorWizardStatusMissing}
                {currentStatus.state === 'unsaved' && RUNTIME_MESSAGES.connectorWizardStatusUnsaved}
                {currentStatus.state === 'ready' && RUNTIME_MESSAGES.connectorWizardStatusReady}
                {currentStatus.state === 'preview-only' && RUNTIME_MESSAGES.connectorWizardStatusPreviewOnly}
              </span>
            </p>
            {currentStatus.missingReasons.length > 0 && (
              <ul className="wizard-missing-list">
                {currentStatus.missingReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
            {currentDef.tabKey ? (
              <button
                type="button"
                className="wizard-open-config-btn"
                onClick={() => p.onOpenRuntimeConfigTab(currentDef.tabKey!)}
              >
                {wizardOpenRuntimeConfigButtonLabel(currentDef.label)}
              </button>
            ) : null}
            <RuntimeMessage tone="muted" as="p">
              Use Reload current tab / Save current tab (or per-panel Save) in Runtime Config — same APIs as before.
            </RuntimeMessage>
          </>
        ) : (
          <>
            <h3 className="wizard-subheading">{RUNTIME_MESSAGES.connectorWizardReviewHeading}</h3>
            <RuntimeMessage tone="warning-banner" as="div">
              {RUNTIME_MESSAGES.connectorWizardReviewPreviewRealControl}
            </RuntimeMessage>
            <div className="wizard-review-block">
              <h4>{RUNTIME_MESSAGES.connectorWizardReviewIdsHeading}</h4>
              <pre className="wizard-review-ids">{p.compactIdsLine}</pre>
              <h4>{RUNTIME_MESSAGES.connectorWizardReviewMissingCountHeading}</h4>
              <p>{missingCount}</p>
              <h4>{RUNTIME_MESSAGES.connectorWizardReviewUnsavedCountHeading}</h4>
              <p>{unsavedCount}</p>
              <h4>{RUNTIME_MESSAGES.connectorWizardReviewMappingHeading}</h4>
              <p>{reviewMappingLine}</p>
              <h4>{RUNTIME_MESSAGES.connectorWizardReviewPreviewGateHeading}</h4>
              <p>{readiness.readyForPreview ? 'yes' : 'no'}</p>
              <h4>{RUNTIME_MESSAGES.connectorWizardReviewRuntimeGateHeading}</h4>
              <p>{readiness.readyForRuntimeStart ? 'yes' : 'no'}</p>
              <h4>{RUNTIME_MESSAGES.connectorWizardReviewNextHeading}</h4>
              <p>{p.recommendedNextAction}</p>
              <h4>{RUNTIME_MESSAGES.connectorWizardReviewValidationHeading}</h4>
              <ul className="frontend-hint-list">
                {sourceValidation.hints.map((hint) => (
                  <li key={`wiz-source-${hint}`}>{hint}</li>
                ))}
                {streamValidation.hints.map((hint) => (
                  <li key={`wiz-stream-${hint}`}>{hint}</li>
                ))}
                {sourceValidation.hints.length + streamValidation.hints.length === 0 ? <li>No Source/Stream hint found.</li> : null}
              </ul>
            </div>
            <div className="wizard-review-actions ui-action-group" role="group" aria-label="Connector wizard review quick actions">
              {firstUnsaved?.tabKey ? (
                <button type="button" className="wizard-open-config-btn" onClick={() => p.onOpenRuntimeConfigTab(firstUnsaved.tabKey!)}>
                  {RUNTIME_MESSAGES.connectorWizardActionGoUnsaved}
                </button>
              ) : null}
              {firstMissing?.tabKey ? (
                <button type="button" className="wizard-open-config-btn" onClick={() => p.onOpenRuntimeConfigTab(firstMissing.tabKey!)}>
                  {RUNTIME_MESSAGES.connectorWizardActionGoMissing}
                </button>
              ) : null}
              <button type="button" className="wizard-open-config-btn" onClick={() => p.onOpenRuntimeConfigTab('connector')}>
                {RUNTIME_MESSAGES.connectorWizardActionGoSaveArea}
              </button>
            </div>
            <RuntimeMessage tone="muted" as="p">
              {RUNTIME_MESSAGES.connectorWizardReviewSaveReminder}
            </RuntimeMessage>
          </>
        )}
      </div>
    </section>
  )
}
