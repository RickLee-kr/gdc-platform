import type { AppSection, TabKey } from '../runtimeTypes'
import { buildRuntimeReadinessSummary } from './runtimeReadiness'
import type { PersistedIds } from './runtimeState'

export type OperatorScenarioKey = 'basicHttpOnboarding' | 'multiDestinationValidation'

export type OperatorScenarioStepState = 'completed' | 'unsaved' | 'missing'

export type OperatorScenarioStep = {
  key: string
  title: string
  section: AppSection
  summary: string
  state: OperatorScenarioStepState
}

export type OperatorScenario = {
  key: OperatorScenarioKey
  title: string
  description: string
  steps: OperatorScenarioStep[]
  completedCount: number
  missingPrerequisites: string[]
}

type ScenarioStepDef = {
  key: string
  title: string
  section: AppSection
  summary: string
  evaluate: (ctx: EvalCtx) => OperatorScenarioStepState
}

type EvalCtx = {
  ids: PersistedIds
  unsavedByTab: Record<TabKey, string[]>
}

const BASIC_HTTP_STEP_DEFS: ScenarioStepDef[] = [
  {
    key: 'template-or-workspace',
    title: 'Template or Workspace',
    section: 'workspaceSummary',
    summary: 'Use Workspace Summary or templates to align local starting values.',
    evaluate: (ctx) =>
      ctx.ids.connectorId.trim() || ctx.ids.sourceId.trim() || ctx.ids.streamId.trim() ? 'completed' : 'missing',
  },
  {
    key: 'runtime-config',
    title: 'Runtime Config',
    section: 'config',
    summary: 'Save Connector/Source/Stream definitions in Runtime Config.',
    evaluate: (ctx) => stateFromIdAndTab(ctx.ids.connectorId, ctx.unsavedByTab.connector),
  },
  {
    key: 'source-api-onboarding',
    title: 'Source/API Onboarding',
    section: 'sourceApiOnboarding',
    summary: 'Follow onboarding checklist and source/stream hints.',
    evaluate: (ctx) =>
      stateFromDual(ctx.ids.sourceId, ctx.unsavedByTab.source, ctx.ids.streamId, ctx.unsavedByTab.stream),
  },
  {
    key: 'api-test-preview',
    title: 'API Test',
    section: 'controlTest',
    summary: 'Run preview-only HTTP API test for extraction checks.',
    evaluate: (ctx) => stateFromIdAndTab(ctx.ids.streamId, ctx.unsavedByTab.stream),
  },
  {
    key: 'mapping-preview',
    title: 'Mapping Preview',
    section: 'config',
    summary: 'Run mapping preview and verify mapped/enriched output.',
    evaluate: (ctx) => stateFromIdAndTab(ctx.ids.streamId, ctx.unsavedByTab.mapping),
  },
  {
    key: 'start-stream',
    title: 'Start Stream',
    section: 'controlTest',
    summary: 'Perform real Start/Stop only after preview checks.',
    evaluate: (ctx) => stateFromIdAndTab(ctx.ids.streamId, []),
  },
  {
    key: 'observability',
    title: 'Observability',
    section: 'dashboard',
    summary: 'Validate runtime outcomes in dashboard/logs/timeline.',
    evaluate: (ctx) => (ctx.ids.streamId.trim() ? 'completed' : 'missing'),
  },
]

const MULTI_DEST_STEP_DEFS: ScenarioStepDef[] = [
  {
    key: 'template-or-workspace',
    title: 'Template or Workspace',
    section: 'workspaceSummary',
    summary: 'Prepare local IDs and baseline configs.',
    evaluate: (ctx) => (ctx.ids.streamId.trim() || ctx.ids.routeId.trim() || ctx.ids.destinationId.trim() ? 'completed' : 'missing'),
  },
  {
    key: 'runtime-config-route-destination',
    title: 'Runtime Config Route/Destination',
    section: 'config',
    summary: 'Save route and destination settings including failure policy/rate limit.',
    evaluate: (ctx) =>
      stateFromDual(ctx.ids.routeId, ctx.unsavedByTab.route, ctx.ids.destinationId, ctx.unsavedByTab.destination),
  },
  {
    key: 'route-visualization',
    title: 'Route Visualization',
    section: 'routeVisualization',
    summary: 'Review Stream -> Route -> Destination fan-out and readiness.',
    evaluate: (ctx) =>
      ctx.ids.streamId.trim() && ctx.ids.routeId.trim() && ctx.ids.destinationId.trim() ? 'completed' : 'missing',
  },
  {
    key: 'route-delivery-preview',
    title: 'Route Delivery Preview',
    section: 'controlTest',
    summary: 'Run preview-only route delivery validation.',
    evaluate: (ctx) => stateFromIdAndTab(ctx.ids.routeId, ctx.unsavedByTab.route),
  },
  {
    key: 'start-stream',
    title: 'Start Stream',
    section: 'controlTest',
    summary: 'Start stream only when route/destination readiness is confirmed.',
    evaluate: (ctx) => stateFromIdAndTab(ctx.ids.streamId, []),
  },
  {
    key: 'observability',
    title: 'Observability',
    section: 'dashboard',
    summary: 'Confirm fan-out outcomes in logs/timeline/failure trend.',
    evaluate: (ctx) =>
      ctx.ids.streamId.trim() && ctx.ids.routeId.trim() ? 'completed' : 'missing',
  },
]

export function buildOperatorScenarios(
  ids: PersistedIds,
  unsavedByTab: Record<TabKey, string[]>,
): OperatorScenario[] {
  const readiness = buildRuntimeReadinessSummary(ids, unsavedByTab)
  return [
    buildScenario('basicHttpOnboarding', 'Basic HTTP API onboarding', 'Template -> Config -> Onboarding -> API Test -> Mapping -> Start -> Observe', BASIC_HTTP_STEP_DEFS, ids, unsavedByTab, readiness.previewPrerequisites),
    buildScenario('multiDestinationValidation', 'Multi-destination route validation', 'Template -> Config(Route/Destination) -> Route Visualization -> Route Preview -> Start -> Observe', MULTI_DEST_STEP_DEFS, ids, unsavedByTab, readiness.previewPrerequisites),
  ]
}

function buildScenario(
  key: OperatorScenarioKey,
  title: string,
  description: string,
  defs: ScenarioStepDef[],
  ids: PersistedIds,
  unsavedByTab: Record<TabKey, string[]>,
  previewPrerequisites: string[],
): OperatorScenario {
  const ctx: EvalCtx = { ids, unsavedByTab }
  const steps = defs.map((def) => ({
    key: def.key,
    title: def.title,
    section: def.section,
    summary: def.summary,
    state: def.evaluate(ctx),
  }))
  const completedCount = steps.filter((s) => s.state === 'completed').length
  const missingPrerequisites = [
    ...previewPrerequisites,
    ...steps.filter((s) => s.state === 'missing').map((s) => `${s.title} is missing`),
  ]
  return { key, title, description, steps, completedCount, missingPrerequisites }
}

function stateFromIdAndTab(id: string, unsaved: string[]): OperatorScenarioStepState {
  if (!id.trim()) return 'missing'
  if (unsaved.length > 0) return 'unsaved'
  return 'completed'
}

function stateFromDual(
  idA: string,
  unsavedA: string[],
  idB: string,
  unsavedB: string[],
): OperatorScenarioStepState {
  if (!idA.trim() || !idB.trim()) return 'missing'
  if (unsavedA.length > 0 || unsavedB.length > 0) return 'unsaved'
  return 'completed'
}
