import { useMemo, useState } from 'react'
import type { AppSection, TabKey } from '../runtimeTypes'
import { RUNTIME_MESSAGES } from '../utils/runtimeMessages'
import { buildOperatorScenarios, type OperatorScenarioKey } from '../utils/operatorScenarios'
import type { PersistedIds } from '../utils/runtimeState'
import { RuntimeMessage } from './runtime/RuntimeAlert'

type OperatorScenarioSectionProps = {
  ids: PersistedIds
  unsavedByTab: Record<TabKey, string[]>
  onGoSection: (section: AppSection) => void
}

export function OperatorScenarioSection(props: OperatorScenarioSectionProps) {
  const [activeScenarioKey, setActiveScenarioKey] = useState<OperatorScenarioKey>('basicHttpOnboarding')
  const scenarios = useMemo(
    () => buildOperatorScenarios(props.ids, props.unsavedByTab),
    [props.ids, props.unsavedByTab],
  )
  const activeScenario = scenarios.find((s) => s.key === activeScenarioKey) ?? scenarios[0]

  return (
    <section className="panel operator-scenario-panel panel-scroll" aria-label={RUNTIME_MESSAGES.operatorScenarioRegionLabel}>
      <h2 className="ui-section-header">{RUNTIME_MESSAGES.operatorScenarioTitle}</h2>
      <RuntimeMessage tone="muted">{RUNTIME_MESSAGES.operatorScenarioIntro}</RuntimeMessage>

      <div className="operator-scenario-cards" role="tablist" aria-label="Operator scenarios">
        {scenarios.map((scenario) => (
          <button
            key={scenario.key}
            type="button"
            role="tab"
            aria-selected={scenario.key === activeScenario.key}
            className={scenario.key === activeScenario.key ? 'active' : ''}
            onClick={() => setActiveScenarioKey(scenario.key)}
          >
            {scenario.title}
          </button>
        ))}
      </div>

      <section className="operator-scenario-detail ui-helper-block" aria-label={`${activeScenario.title} walkthrough`}>
        <h3>{activeScenario.title}</h3>
        <p>{activeScenario.description}</p>
        <p>
          <strong>progress</strong>: {activeScenario.completedCount}/{activeScenario.steps.length}
        </p>
        <ol className="operator-scenario-steps">
          {activeScenario.steps.map((step) => (
            <li key={step.key}>
              <strong>{step.title}</strong> - {step.summary}{' '}
              <span
                className={`ui-badge ${step.state === 'completed' ? 'is-ready' : step.state === 'unsaved' ? 'is-dirty' : 'is-missing'}`}
              >
                {step.state}
              </span>
              <button
                type="button"
                aria-label={`Go to ${step.title} (${step.section})`}
                onClick={() => props.onGoSection(step.section)}
              >
                Go to {step.title}
              </button>
            </li>
          ))}
        </ol>
      </section>

      <section className="operator-scenario-missing ui-helper-block" aria-label="Operator scenario missing prerequisites">
        <h3>Missing prerequisites</h3>
        {activeScenario.missingPrerequisites.length > 0 ? (
          <ul>
            {activeScenario.missingPrerequisites.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <RuntimeMessage tone="result-summary">No missing prerequisites.</RuntimeMessage>
        )}
      </section>

      <section className="operator-scenario-warnings ui-helper-block" aria-label="Operator scenario warnings">
        <h3>Operator warnings</h3>
        <ul>
          <li>{RUNTIME_MESSAGES.operatorScenarioWarningPreview}</li>
          <li>{RUNTIME_MESSAGES.operatorScenarioWarningRealControl}</li>
          <li>{RUNTIME_MESSAGES.operatorScenarioWarningLocalOnly}</li>
        </ul>
      </section>
    </section>
  )
}
