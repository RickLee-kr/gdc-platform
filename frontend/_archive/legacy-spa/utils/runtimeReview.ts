import type { AppSection, TabKey } from '../runtimeTypes'
import { buildRuntimeReadinessSummary } from './runtimeReadiness'
import type { PersistedIds } from './runtimeState'

export type RuntimeCapability = {
  key: string
  label: string
  done: boolean
}

export type RuntimeReviewModel = {
  capabilities: RuntimeCapability[]
  selectedIdsSummary: string[]
  unsavedTabCount: number
  readyForPreview: boolean
  readyForRuntimeStart: boolean
  requiresBackendSave: boolean
  nextSteps: string[]
  quickNav: Array<{ label: string; section: AppSection }>
}

export function buildRuntimeReviewModel(ids: PersistedIds, unsavedByTab: Record<TabKey, string[]>): RuntimeReviewModel {
  const readiness = buildRuntimeReadinessSummary(ids, unsavedByTab)
  const unsavedTabCount = Object.values(unsavedByTab).filter((items) => items.length > 0).length
  return {
    capabilities: [
      { key: 'demoScenarios', label: 'Demo Scenarios', done: true },
      { key: 'workspaceSummary', label: 'Workspace Summary', done: true },
      { key: 'connectorTemplates', label: 'Connector Templates', done: true },
      { key: 'connectorWizard', label: 'Connector Wizard', done: true },
      { key: 'sourceApiOnboarding', label: 'Source/API Onboarding', done: true },
      { key: 'runtimeConfig', label: 'Runtime Config', done: true },
      { key: 'liveSimulation', label: 'Live Simulation', done: true },
      { key: 'runtimeTestControl', label: 'Runtime Test & Control', done: true },
      { key: 'routeVisualization', label: 'Route Visualization', done: true },
      { key: 'obsDashboard', label: 'Observability Dashboard', done: true },
      { key: 'timelineFiltering', label: 'Timeline filtering', done: true },
      { key: 'operatorScenario', label: 'Operator Scenario Mode', done: true },
    ],
    selectedIdsSummary: [
      `connector_id: ${ids.connectorId.trim() ? 'present' : 'missing'}`,
      `source_id: ${ids.sourceId.trim() ? 'present' : 'missing'}`,
      `stream_id: ${ids.streamId.trim() ? 'present' : 'missing'}`,
      `route_id: ${ids.routeId.trim() ? 'present' : 'missing'}`,
      `destination_id: ${ids.destinationId.trim() ? 'present' : 'missing'}`,
    ],
    unsavedTabCount,
    readyForPreview: readiness.readyForPreview,
    readyForRuntimeStart: readiness.readyForRuntimeStart,
    requiresBackendSave: unsavedTabCount > 0,
    nextSteps: [
      'Save unsaved Runtime Config tabs',
      'Run API Test Preview',
      'Run Mapping Preview',
      'Run Route Delivery Preview',
      'Start Stream only after typed confirmation',
      'Inspect Observability Timeline/Logs',
    ],
    quickNav: [
      { label: 'Demo Scenarios', section: 'demoScenarios' },
      { label: 'Workspace Summary', section: 'workspaceSummary' },
      { label: 'Connector Templates', section: 'connectorTemplates' },
      { label: 'Connector Wizard', section: 'connectorWizard' },
      { label: 'Runtime Config', section: 'config' },
      { label: 'Live Simulation', section: 'liveSimulation' },
      { label: 'Runtime Test & Control', section: 'controlTest' },
      { label: 'Observability', section: 'dashboard' },
      { label: 'Operator Scenario Mode', section: 'operatorScenario' },
    ],
  }
}
