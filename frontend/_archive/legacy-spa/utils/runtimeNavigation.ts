import type { AppSection, TabKey } from '../runtimeTypes'

export type RuntimeNavGroupKey = 'setup' | 'configure' | 'validateRun' | 'observe'

export type RuntimeNavItem = {
  key: string
  label: string
  section: AppSection
  purpose: string
}

export type RuntimeNavGroup = {
  key: RuntimeNavGroupKey
  label: string
  items: RuntimeNavItem[]
}

export const RUNTIME_NAV_GROUPS: RuntimeNavGroup[] = [
  {
    key: 'setup',
    label: 'Setup',
    items: [
      {
        key: 'demoScenarios',
        label: 'Demo Scenarios',
        section: 'demoScenarios',
        purpose: 'Load local demo presets for realistic operator rehearsal.',
      },
      { key: 'runtimeReview', label: 'Runtime Review', section: 'runtimeReview', purpose: 'Review implemented capabilities and next actions.' },
      { key: 'operatorScenario', label: 'Operator Scenario Mode', section: 'operatorScenario', purpose: 'Run guided end-to-end operator walkthroughs.' },
      { key: 'workspaceSummary', label: 'Workspace Summary', section: 'workspaceSummary', purpose: 'Check local session state and resets.' },
      { key: 'connectorTemplates', label: 'Connector Templates', section: 'connectorTemplates', purpose: 'Apply local starter templates quickly.' },
      { key: 'connectorWizard', label: 'Connector Wizard', section: 'connectorWizard', purpose: 'Follow guided setup and review.' },
      { key: 'sourceApiOnboarding', label: 'Source/API Onboarding', section: 'sourceApiOnboarding', purpose: 'Validate API source onboarding flow.' },
    ],
  },
  {
    key: 'configure',
    label: 'Configure',
    items: [
      { key: 'config', label: 'Runtime Config', section: 'config', purpose: 'Load/edit/save runtime entity tabs.' },
      { key: 'routeVisualization', label: 'Route Visualization', section: 'routeVisualization', purpose: 'Inspect Stream -> Route -> Destination fan-out.' },
    ],
  },
  {
    key: 'validateRun',
    label: 'Validate/Run',
    items: [
      {
        key: 'liveSimulation',
        label: 'Live Simulation',
        section: 'liveSimulation',
        purpose: 'Run frontend-only local runtime event simulation.',
      },
      { key: 'controlTest', label: 'Runtime Test & Control', section: 'controlTest', purpose: 'Run previews, then real Start/Stop.' },
    ],
  },
  {
    key: 'observe',
    label: 'Observe',
    items: [
      {
        key: 'executionHistory',
        label: 'Execution History',
        section: 'executionHistory',
        purpose: 'Review grouped runtime events using already loaded timeline/log rows.',
      },
      { key: 'observeDashboard', label: 'Observability', section: 'dashboard', purpose: 'Open observability dashboards and investigation views.' },
    ],
  },
]

export type RuntimeNavModel = {
  groups: RuntimeNavGroup[]
  activeSection: AppSection
  switcherSection: AppSection
  activeLabel: string
  unsavedBySection: Partial<Record<AppSection, number>>
}

export function buildRuntimeNavModel(params: {
  activeSection: AppSection
  unsavedByTab: Record<TabKey, string[]>
}): RuntimeNavModel {
  const totalUnsaved = Object.values(params.unsavedByTab).filter((items) => items.length > 0).length
  const routeVizUnsaved = Number(params.unsavedByTab.route.length > 0) + Number(params.unsavedByTab.destination.length > 0)
  return {
    groups: RUNTIME_NAV_GROUPS,
    activeSection: params.activeSection,
    switcherSection: normalizeSwitcherSection(params.activeSection),
    activeLabel: activeSectionLabel(params.activeSection),
    unsavedBySection: {
      runtimeReview: totalUnsaved,
      operatorScenario: totalUnsaved,
      workspaceSummary: totalUnsaved,
      connectorWizard: totalUnsaved,
      config: totalUnsaved,
      routeVisualization: routeVizUnsaved,
    },
  }
}

function normalizeSwitcherSection(section: AppSection): AppSection {
  if (section === 'health' || section === 'stats' || section === 'timeline' || section === 'logs' || section === 'failureTrend') {
    return 'dashboard'
  }
  return section
}

function activeSectionLabel(section: AppSection): string {
  for (const group of RUNTIME_NAV_GROUPS) {
    const item = group.items.find((candidate) => candidate.section === section)
    if (item) return item.label
  }
  if (section === 'health' || section === 'stats' || section === 'timeline' || section === 'logs' || section === 'failureTrend') {
    return 'Observability'
  }
  return section
}
