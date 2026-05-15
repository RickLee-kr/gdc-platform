import type { DemoScenarioPreset } from '../utils/demoScenarios'
import { RuntimeMessage } from './runtime/RuntimeAlert'

type DemoScenariosSectionProps = {
  presets: DemoScenarioPreset[]
  onLoadPreset: (preset: DemoScenarioPreset) => void
  onClear: () => void
}

export function DemoScenariosSection(props: DemoScenariosSectionProps) {
  return (
    <section className="panel demo-scenarios-panel panel-scroll" aria-label="Demo scenarios">
      <h2>Demo Scenarios</h2>
      <RuntimeMessage tone="warning-banner" as="div">
        Demo-only: these presets populate local frontend runtime state for operator rehearsal. They are not persisted.
      </RuntimeMessage>
      <RuntimeMessage tone="muted">
        Runtime execution shown after loading is simulated/local UI data (no backend save, no new API calls).
      </RuntimeMessage>
      <div className="ui-action-group">
        <button type="button" onClick={props.onClear}>
          Clear Demo State
        </button>
      </div>

      <div className="demo-scenarios-grid">
        {props.presets.map((preset) => (
          <article key={preset.key} className="demo-scenario-card">
            <h3>{preset.name}</h3>
            <p className="muted">{preset.explanation}</p>
            <ul>
              <li>Source type: {preset.sourceType}</li>
              <li>Destination topology: {preset.destinationTopology}</li>
            </ul>
            <button type="button" onClick={() => props.onLoadPreset(preset)}>
              Load demo preset
            </button>
          </article>
        ))}
      </div>
    </section>
  )
}
