import type { HistoryGroup } from '../utils/runtimeExecutionHistory'
import { RuntimeMessage } from './runtime/RuntimeAlert'

type RuntimeExecutionHistorySectionProps = {
  groups: HistoryGroup[]
}

export function RuntimeExecutionHistorySection(props: RuntimeExecutionHistorySectionProps) {
  return (
    <section className="panel runtime-execution-history-panel panel-scroll" aria-label="Runtime execution history">
      <h2>Runtime Execution History</h2>
      <RuntimeMessage tone="muted">
        Frontend-only advisory: this view only groups already loaded Timeline/Logs results in the browser. It does not call
        new backend APIs and does not modify runtime state.
      </RuntimeMessage>
      {props.groups.length === 0 ? (
        <RuntimeMessage tone="obs-empty">
          No loaded runtime logs yet. Load Timeline or Logs first, then return here to review grouped execution history.
        </RuntimeMessage>
      ) : (
        <div className="reh-groups">
          {props.groups.map((group) => (
            <article key={group.key} className="reh-group-card">
              <h3>{group.title}</h3>
              <p className="muted">events: {group.events.length}</p>
              <div className="reh-events">
                {group.events.map((event) => (
                  <article key={event.id} className="reh-event-card">
                    <header className="reh-event-header">
                      <p className="obs-timeline-ts">{event.createdAt || 'created_at unavailable'}</p>
                      <div className="obs-timeline-badges">
                        <span className="obs-badge obs-badge-stage">{event.stage}</span>
                        <span className="obs-badge obs-badge-level">{event.level}</span>
                        <span className="obs-badge obs-badge-status">{event.status}</span>
                      </div>
                    </header>
                    <p className="obs-timeline-message">{event.message}</p>
                    <p className="obs-timeline-ids">
                      <span>stream_id={event.streamId}</span>
                      <span>route_id={event.routeId}</span>
                      <span>destination_id={event.destinationId}</span>
                    </p>
                    <details>
                      <summary>payload/details</summary>
                      <pre className="obs-json">{event.payloadSample || '(no payload sample in loaded row)'}</pre>
                    </details>
                    <details>
                      <summary>raw event row</summary>
                      <pre className="obs-json">{JSON.stringify(event.raw, null, 2)}</pre>
                    </details>
                  </article>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
