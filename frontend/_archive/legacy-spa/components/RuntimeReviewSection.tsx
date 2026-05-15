import type { AppSection } from '../runtimeTypes'
import { RUNTIME_MESSAGES } from '../utils/runtimeMessages'
import type { RuntimeReviewModel } from '../utils/runtimeReview'
import { RuntimeMessage } from './runtime/RuntimeAlert'

type RuntimeReviewSectionProps = {
  review: RuntimeReviewModel
  onGoSection: (section: AppSection) => void
}

export function RuntimeReviewSection(props: RuntimeReviewSectionProps) {
  return (
    <section className="panel runtime-review-panel panel-scroll" aria-label={RUNTIME_MESSAGES.runtimeReviewRegionLabel}>
      <h2 className="ui-section-header">{RUNTIME_MESSAGES.runtimeReviewTitle}</h2>
      <RuntimeMessage tone="warning-banner">{RUNTIME_MESSAGES.runtimeReviewFrontendOnly}</RuntimeMessage>
      <RuntimeMessage tone="muted">{RUNTIME_MESSAGES.runtimeReviewSaveRequired}</RuntimeMessage>

      <section className="ui-helper-block" aria-label="Implemented capability checklist">
        <h3>Implemented capability checklist</h3>
        <ul className="runtime-review-list">
          {props.review.capabilities.map((item) => (
            <li key={item.key}>
              {item.label}{' '}
              <span className={`ui-badge ${item.done ? 'is-ready' : 'is-missing'}`}>{item.done ? 'done' : 'missing'}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="ui-helper-block" aria-label="Operational readiness summary">
        <h3>Operational readiness summary</h3>
        <ul className="runtime-review-list">
          {props.review.selectedIdsSummary.map((line) => (
            <li key={line}>{line}</li>
          ))}
          <li>unsaved tabs count: {props.review.unsavedTabCount}</li>
          <li>ready for preview: {props.review.readyForPreview ? 'yes' : 'no'}</li>
          <li>ready for runtime start: {props.review.readyForRuntimeStart ? 'yes' : 'no'}</li>
          <li>backend save still required: {props.review.requiresBackendSave ? 'yes' : 'no'}</li>
        </ul>
      </section>

      <section className="ui-helper-block" aria-label="Recommended next steps">
        <h3>Recommended next steps</h3>
        <ol className="runtime-review-list">
          {props.review.nextSteps.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </section>

      <section className="ui-helper-block" aria-label="Runtime review warnings">
        <h3>Warnings</h3>
        <ul className="runtime-review-list">
          <li>{RUNTIME_MESSAGES.runtimeReviewFrontendOnly}</li>
          <li>{RUNTIME_MESSAGES.runtimeReviewSaveRequired}</li>
          <li>{RUNTIME_MESSAGES.operatorScenarioWarningPreview}</li>
          <li>{RUNTIME_MESSAGES.operatorScenarioWarningRealControl}</li>
        </ul>
      </section>

      <section className="ui-helper-block" aria-label="Runtime review quick navigation">
        <h3>Quick navigation</h3>
        <div className="ui-action-group" role="group" aria-label="Runtime review quick navigation actions">
          {props.review.quickNav.map((nav) => (
            <button key={nav.label} type="button" onClick={() => props.onGoSection(nav.section)}>
              Go to {nav.label}
            </button>
          ))}
        </div>
      </section>
    </section>
  )
}
