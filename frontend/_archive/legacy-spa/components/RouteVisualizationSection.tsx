import type { TabKey } from '../runtimeTypes'
import type { PersistedIds } from '../utils/runtimeState'
import { buildRouteVisualizationHints, buildRouteVisualizationSummary } from '../utils/routeVisualization'
import { RuntimeMessage } from './runtime/RuntimeAlert'

type RouteVisualizationSectionProps = {
  ids: PersistedIds
  routeConfig: string
  destinationConfig: string
  unsavedByTab: Record<TabKey, string[]>
  onGoRuntimeConfigTab: (tab: TabKey) => void
  onGoRouteDeliveryPreview: () => void
  onGoObservabilityLogs: () => void
}

function readinessLabel(ok: boolean): string {
  return ok ? 'READY' : 'NOT READY'
}

export function RouteVisualizationSection(props: RouteVisualizationSectionProps) {
  const summary = buildRouteVisualizationSummary(props.routeConfig, props.destinationConfig)
  const hints = buildRouteVisualizationHints(props.ids, props.unsavedByTab)

  return (
    <section className="panel route-visualization-panel panel-scroll" aria-label="Route visualization">
      <h2 className="ui-section-header">Route Visualization</h2>
      <RuntimeMessage tone="obs-hint">
        Frontend-only fan-out view based on selected IDs and loaded Runtime Config JSON.
      </RuntimeMessage>

      <section className="route-viz-grid" aria-label="Fan-out summary">
        <article className="route-viz-card">
          <h3>Fan-out selection</h3>
          <ul>
            <li>selected stream_id: <code>{props.ids.streamId.trim() ? 'set (see Flow)' : '—'}</code></li>
            <li>selected route_id: <code>{props.ids.routeId.trim() ? 'set (see Flow)' : '—'}</code></li>
            <li>selected destination_id: <code>{props.ids.destinationId.trim() ? 'set (see Flow)' : '—'}</code></li>
            <li>route state: <code>{summary.routeEnabled}</code></li>
            <li>destination type: <code>{summary.destinationType}</code></li>
            <li>failure_policy: <code>{summary.failurePolicy}</code></li>
            <li>rate_limit summary: <code>{summary.rateLimitSummary}</code></li>
          </ul>
        </article>

        <article className="route-viz-card">
          <h3>Flow</h3>
          <p className="route-viz-flow" aria-label="Stream Route Destination flow">
            <code>{props.ids.streamId.trim() || 'stream_id'}</code> <span>→</span> <code>{props.ids.routeId.trim() || 'route_id'}</code>{' '}
            <span>→</span> <code>{props.ids.destinationId.trim() || 'destination_id'}</code>
          </p>
        </article>
      </section>

      <section className="route-viz-card" aria-label="Visualization guidance">
        <h3>Operator guidance</h3>
        <ul>
          <li>Multi-destination means one Stream can have multiple Routes.</li>
          <li>Route connects Stream to Destination.</li>
          <li>Destination failure policy/rate limit affects delivery behavior.</li>
          <li>Checkpoint must only advance after successful delivery.</li>
          <li>Preview/test does not affect checkpoint or delivery_logs.</li>
        </ul>
      </section>

      <section className="route-viz-card" aria-label="Visualization readiness">
        <h3>Readiness and hints</h3>
        <ul className="route-viz-readiness">
          <li>
            {hints.missingStreamId ? 'missing stream_id' : 'stream_id present'}{' '}
            <span className={`ui-badge ${hints.missingStreamId ? 'is-missing' : 'is-ready'}`}>
              {hints.missingStreamId ? 'missing' : 'ready'}
            </span>
          </li>
          <li>
            {hints.missingRouteId ? 'missing route_id' : 'route_id present'}{' '}
            <span className={`ui-badge ${hints.missingRouteId ? 'is-missing' : 'is-ready'}`}>
              {hints.missingRouteId ? 'missing' : 'ready'}
            </span>
          </li>
          <li>
            {hints.missingDestinationId ? 'missing destination_id' : 'destination_id present'}{' '}
            <span className={`ui-badge ${hints.missingDestinationId ? 'is-missing' : 'is-ready'}`}>
              {hints.missingDestinationId ? 'missing' : 'ready'}
            </span>
          </li>
          <li>
            {hints.routeDirty ? 'route config dirty/unsaved' : 'route config synced'}{' '}
            <span className={`ui-badge ${hints.routeDirty ? 'is-dirty' : 'is-ready'}`}>
              {hints.routeDirty ? 'unsaved' : 'ready'}
            </span>
          </li>
          <li>
            {hints.destinationDirty ? 'destination config dirty/unsaved' : 'destination config synced'}{' '}
            <span className={`ui-badge ${hints.destinationDirty ? 'is-dirty' : 'is-ready'}`}>
              {hints.destinationDirty ? 'unsaved' : 'ready'}
            </span>
          </li>
          <li>
            ready for route delivery preview: {readinessLabel(hints.readyForRouteDeliveryPreview)}{' '}
            <span className={`ui-badge ${hints.readyForRouteDeliveryPreview ? 'is-preview' : 'is-missing'}`}>
              {hints.readyForRouteDeliveryPreview ? 'preview-ready' : 'blocked'}
            </span>
          </li>
          <li>
            ready for runtime start: {readinessLabel(hints.readyForRuntimeStart)}{' '}
            <span className={`ui-badge ${hints.readyForRuntimeStart ? 'is-ready' : 'is-missing'}`}>
              {hints.readyForRuntimeStart ? 'runtime-ready' : 'blocked'}
            </span>
          </li>
        </ul>
      </section>

      <section className="route-viz-card" aria-label="Visualization quick navigation">
        <h3>Quick navigation</h3>
        <div className="route-viz-actions ui-action-group" role="group" aria-label="Route visualization quick actions">
          <button type="button" onClick={() => props.onGoRuntimeConfigTab('route')}>
            Go to Runtime Config {'>'} Route
          </button>
          <button type="button" onClick={() => props.onGoRuntimeConfigTab('destination')}>
            Go to Runtime Config {'>'} Destination
          </button>
          <button type="button" onClick={props.onGoRouteDeliveryPreview}>
            Go to Runtime Test & Control {'>'} Route Delivery Preview
          </button>
          <button type="button" onClick={props.onGoObservabilityLogs}>
            Go to Observability logs
          </button>
        </div>
      </section>
    </section>
  )
}
