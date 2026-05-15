import type { ConnectorTemplate } from '../utils/connectorTemplates'
import { CONNECTOR_TEMPLATES } from '../utils/connectorTemplates'
import { RUNTIME_MESSAGES } from '../utils/runtimeMessages'
import { RuntimeMessage } from './runtime/RuntimeAlert'

type ConnectorTemplatesSectionProps = {
  onApplyTemplate: (template: ConnectorTemplate) => void
  onGoRuntimeConfig: () => void
  onGoSourceApiOnboarding: () => void
  onGoRuntimeTestControl: () => void
  onGoConnectorWizardReview: () => void
}

export function ConnectorTemplatesSection(props: ConnectorTemplatesSectionProps) {
  const groupedTemplates = CONNECTOR_TEMPLATES.reduce<Record<string, ConnectorTemplate[]>>((acc, template) => {
    const current = acc[template.category] ?? []
    current.push(template)
    acc[template.category] = current
    return acc
  }, {})

  return (
    <section className="panel connector-templates-panel panel-scroll" aria-label={RUNTIME_MESSAGES.connectorTemplatesRegionLabel}>
      <h2>Connector Templates</h2>
      <RuntimeMessage tone="warning-banner" as="div">
        {RUNTIME_MESSAGES.connectorTemplatesLocalWarning}
      </RuntimeMessage>
      <RuntimeMessage tone="warning-banner" as="div">
        Template examples only: review endpoint/auth/mapping fields before production use.
      </RuntimeMessage>
      <RuntimeMessage tone="obs-hint">
        {RUNTIME_MESSAGES.connectorTemplatesApplyHint}
      </RuntimeMessage>

      <div className="connector-template-nav">
        <button type="button" onClick={props.onGoRuntimeConfig}>
          Go to Runtime Config
        </button>
        <button type="button" onClick={props.onGoSourceApiOnboarding}>
          Go to Source/API Onboarding
        </button>
        <button type="button" onClick={props.onGoRuntimeTestControl}>
          Go to Runtime Test & Control
        </button>
        <button type="button" onClick={props.onGoConnectorWizardReview}>
          Go to Connector Wizard Review
        </button>
      </div>

      {Object.entries(groupedTemplates).map(([category, templates]) => (
        <section key={category}>
          <h3>{category}</h3>
          <div className="connector-template-grid">
            {templates.map((template) => (
              <article key={template.key} className="connector-template-card">
                <h3>{template.name}</h3>
                <p className="muted">{template.description}</p>
                <button type="button" onClick={() => props.onApplyTemplate(template)}>
                  Apply to local form state
                </button>

                <h4>Operator guidance</h4>
                <ul>
                  <li>{template.operatorGuidance.dataRepresents}</li>
                  <li>{template.operatorGuidance.whenToUse}</li>
                  <li>{template.operatorGuidance.destinationBehavior}</li>
                </ul>

                <h4>Mapping field suggestions</h4>
                <ul>
                  {template.mappingFieldSuggestions.map((row) => (
                    <li key={`${template.key}-${row.outputField}`}>
                      <code>{row.outputField}</code> ← <code>{row.sourcePath}</code>
                    </li>
                  ))}
                </ul>

                <h4>Route / Destination guidance</h4>
                <ul>
                  {template.routeDestinationGuidance.map((line) => (
                    <li key={`${template.key}-${line}`}>{line}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      ))}
    </section>
  )
}
