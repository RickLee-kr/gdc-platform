import type { WorkspaceRestoreStatus, WorkspaceSummaryModel } from '../utils/workspaceSummary'
import { RuntimeMessage } from './runtime/RuntimeAlert'
import { RUNTIME_MESSAGES } from '../utils/runtimeMessages'

type WorkspaceSummarySectionProps = {
  summary: WorkspaceSummaryModel
  restoreStatus: WorkspaceRestoreStatus
  onGoFirstUnsavedTab: () => void
  onGoConnectorWizardReview: () => void
  onGoRuntimeTestControl: () => void
  onGoObservability: () => void
  onResetIds: () => void
  onResetUiPreferences: () => void
  onResetApiUrl: () => void
}

export function WorkspaceSummarySection(props: WorkspaceSummarySectionProps) {
  return (
    <section
      className="panel workspace-summary-panel panel-scroll"
      aria-label={RUNTIME_MESSAGES.workspaceSummaryRegionLabel}
    >
      <h2 className="ui-section-header">Workspace Summary</h2>
      <RuntimeMessage tone="warning-banner" as="div">
        {RUNTIME_MESSAGES.workspaceSummaryWarning}
      </RuntimeMessage>

      <div className="workspace-summary-grid">
        <article className="workspace-summary-card">
          <h3>Current local workspace</h3>
          <p>
            <strong>selected IDs</strong>: <code>{props.summary.idsLine}</code>
          </p>
          <p>
            <strong>current API base URL</strong>: <code>{props.summary.apiBaseUrl}</code>
          </p>
          <p>
            <strong>active primary section/tab</strong>: {props.summary.activeSection} / {props.summary.activeTab}
          </p>
          <p>
            <strong>display density</strong>: {props.summary.density}
          </p>
          <p>
            <strong>last success</strong>: {props.summary.lastSuccess}
          </p>
          <p>
            <strong>last error</strong>: {props.summary.lastError}
          </p>
        </article>

        <article className="workspace-summary-card">
          <h3>Unsaved tabs</h3>
          <p>
            <strong>count</strong>: {props.summary.unsavedCount}
          </p>
          {props.summary.unsavedLines.length > 0 ? (
            <ul>
              {props.summary.unsavedLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <RuntimeMessage tone="muted">No unsaved Runtime Config tabs.</RuntimeMessage>
          )}
        </article>
      </div>

      <section className="workspace-summary-card" aria-label="Session restore status">
        <h3>Session restore status</h3>
        <p>{props.restoreStatus.note}</p>
        <p>Values can be reset with: Reset IDs / Reset UI preferences / Reset API URL.</p>
      </section>

      <section className="workspace-summary-card" aria-label="Workspace quick actions">
        <h3>Quick actions</h3>
        <div className="workspace-summary-actions ui-action-group" role="group" aria-label="Workspace summary quick actions">
          <button type="button" onClick={props.onGoFirstUnsavedTab}>
            Go to first unsaved Runtime Config tab
          </button>
          <button type="button" onClick={props.onGoConnectorWizardReview}>
            Go to Connector Wizard Review
          </button>
          <button type="button" onClick={props.onGoRuntimeTestControl}>
            Go to Runtime Test & Control
          </button>
          <button type="button" onClick={props.onGoObservability}>
            Go to Observability
          </button>
          <button type="button" onClick={props.onResetIds}>
            Reset workspace IDs
          </button>
          <button type="button" onClick={props.onResetUiPreferences}>
            Reset UI preferences
          </button>
          <button type="button" onClick={props.onResetApiUrl}>
            Reset API URL
          </button>
        </div>
      </section>
    </section>
  )
}
