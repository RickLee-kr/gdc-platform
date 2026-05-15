import type { LiveRuntimeStatus, LiveSimulationPreset, LiveSimulationPresetKey } from '../utils/liveRuntimeSimulation'
import { RuntimeMessage } from './runtime/RuntimeAlert'

type LiveRuntimeSimulationSectionProps = {
  running: boolean
  preset: LiveSimulationPresetKey
  presets: LiveSimulationPreset[]
  status: LiveRuntimeStatus
  eps: number
  totalEvents: number
  retryBursts: number
  destinationDegradationCount: number
  onPresetChange: (preset: LiveSimulationPresetKey) => void
  onStart: () => void
  onStop: () => void
}

export function LiveRuntimeSimulationSection(props: LiveRuntimeSimulationSectionProps) {
  return (
    <section className="panel live-simulation-panel panel-scroll" aria-label="Live runtime simulation">
      <h2>Live Runtime Simulation</h2>
      <RuntimeMessage tone="warning-banner" as="div">
        Demo-only local simulation: non-persistent, non-backend, not actual connector execution.
      </RuntimeMessage>
      <RuntimeMessage tone="muted">
        Simulated events continuously update Execution History and Observability panels without network/API calls.
      </RuntimeMessage>

      <div className="obs-controls">
        <label className="inline-field">
          simulation preset
          <select value={props.preset} onChange={(e) => props.onPresetChange(e.target.value as LiveSimulationPresetKey)}>
            {props.presets.map((preset) => (
              <option key={preset.key} value={preset.key}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={props.onStart} disabled={props.running}>
          Start Simulation
        </button>
        <button type="button" onClick={props.onStop} disabled={!props.running}>
          Stop Simulation
        </button>
      </div>

      <div className="stat-grid">
        <div className="stat-row">
          <dt>simulation_status</dt>
          <dd>{props.running ? 'RUNNING' : 'STOPPED'}</dd>
        </div>
        <div className="stat-row">
          <dt>runtime_state</dt>
          <dd>{props.status}</dd>
        </div>
        <div className="stat-row">
          <dt>simulated_eps</dt>
          <dd>{props.eps}</dd>
        </div>
        <div className="stat-row">
          <dt>total_simulated_events</dt>
          <dd>{props.totalEvents}</dd>
        </div>
        <div className="stat-row">
          <dt>retry_bursts</dt>
          <dd>{props.retryBursts}</dd>
        </div>
        <div className="stat-row">
          <dt>destination_degradation_count</dt>
          <dd>{props.destinationDegradationCount}</dd>
        </div>
      </div>

      <ul className="runtime-review-list">
        {props.presets.map((preset) => (
          <li key={preset.key}>
            <strong>{preset.label}</strong>: {preset.description}
          </li>
        ))}
      </ul>
    </section>
  )
}
