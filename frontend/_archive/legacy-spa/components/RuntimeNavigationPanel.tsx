import type { AppSection } from '../runtimeTypes'
import { RUNTIME_MESSAGES } from '../utils/runtimeMessages'
import type { RuntimeNavModel } from '../utils/runtimeNavigation'

type RuntimeNavigationPanelProps = {
  model: RuntimeNavModel
  onSelectSection: (section: AppSection) => void
}

export function RuntimeNavigationPanel(props: RuntimeNavigationPanelProps) {
  return (
    <section className="panel runtime-navigation-panel" aria-label={RUNTIME_MESSAGES.runtimeNavigationRegionLabel}>
      <h2 className="ui-section-header">Runtime quick switcher</h2>
      <p>
        <strong>Active section</strong>: {props.model.activeLabel}
      </p>

      <label className="runtime-nav-switcher-label">
        Quick switch
        <select
          aria-label={RUNTIME_MESSAGES.runtimeNavigationSwitcherLabel}
          value={props.model.switcherSection}
          onChange={(e) => props.onSelectSection(e.target.value as AppSection)}
        >
          {props.model.groups.map((group) =>
            group.items.map((item) => (
              <option key={item.key} value={item.section}>
                [{group.label}] {item.label}
              </option>
            )),
          )}
        </select>
      </label>

      <div className="runtime-nav-groups">
        {props.model.groups.map((group) => (
          <article key={group.key} className="runtime-nav-group-card">
            <h3>{group.label}</h3>
            <ul>
              {group.items.map((item) => {
                const unsavedCount = props.model.unsavedBySection[item.section] ?? 0
                const isActive = item.section === props.model.activeSection
                return (
                  <li key={item.key}>
                    <span className={isActive ? 'runtime-nav-item-label active' : 'runtime-nav-item-label'}>
                      {item.label}
                    </span>
                    <button
                      type="button"
                      aria-label={`Switch to ${item.label}`}
                      onClick={() => props.onSelectSection(item.section)}
                    >
                      Open
                    </button>
                    {unsavedCount > 0 && (
                      <span className="runtime-nav-unsaved-badge" aria-label={`${item.label} unsaved count`}>
                        unsaved {unsavedCount}
                      </span>
                    )}
                    <p>{item.purpose}</p>
                  </li>
                )
              })}
            </ul>
          </article>
        ))}
      </div>

      <div className="runtime-nav-guidance ui-helper-block" aria-label="Runtime navigation guidance">
        <p>{RUNTIME_MESSAGES.runtimeNavigationWorkflowGuide}</p>
        <p>{RUNTIME_MESSAGES.runtimeNavigationLocalOnlyReminder}</p>
      </div>
    </section>
  )
}
