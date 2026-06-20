import { Suspense, lazy, type ComponentType, type LazyExoticComponent } from 'react'
import { RoutePageFallback } from '../components/layout/route-page-fallback'

function lazyNamed<T extends Record<string, ComponentType<unknown>>, K extends keyof T>(
  factory: () => Promise<T>,
  exportName: K,
) {
  return lazy(() => factory().then((module) => ({ default: module[exportName] as ComponentType<unknown> })))
}

function suspend<P extends object>(Lazy: LazyExoticComponent<ComponentType<P>>): ComponentType<P> {
  function SuspendedLazy(props: P) {
    return (
      <Suspense fallback={<RoutePageFallback />}>
        <Lazy {...props} />
      </Suspense>
    )
  }
  return SuspendedLazy
}

// Stream wizard
export const LazyNewStreamWizardPage = suspend(
  lazyNamed(() => import('../components/streams/new-stream-wizard-page'), 'NewStreamWizardPage'),
)

// Dashboard
export const LazyDashboardOverview = suspend(
  lazyNamed(() => import('../components/dashboard/dashboard-overview'), 'DashboardOverview'),
)

// Stream runtime detail
export const LazyStreamRuntimeDetailPage = suspend(
  lazyNamed(() => import('../components/streams/stream-runtime-detail-page'), 'StreamRuntimeDetailPage'),
)

// Logs
export const LazyLogsExplorerPage = suspend(
  lazyNamed(() => import('../components/logs/logs-explorer-page'), 'LogsExplorerPage'),
)

// Routes & destinations
export const LazyDestinationsManagementPage = suspend(
  lazyNamed(() => import('../components/destinations/destinations-management-page'), 'DestinationsManagementPage'),
)
export const LazyDestinationDetailPage = suspend(
  lazyNamed(() => import('../components/destinations/destination-detail-page'), 'DestinationDetailPage'),
)
export const LazyRoutesOverviewPage = suspend(
  lazyNamed(() => import('../components/routes/routes-overview-page'), 'RoutesOverviewPage'),
)
export const LazyRouteEditPage = suspend(
  lazyNamed(() => import('../components/routes/route-edit-page'), 'RouteEditPage'),
)

// Governance
export const LazyGovernanceShell = suspend(
  lazyNamed(() => import('../components/governance/governance-shell'), 'GovernanceShell'),
)
export const LazyGovernanceDashboardPage = suspend(
  lazyNamed(() => import('../components/governance/governance-dashboard-page'), 'GovernanceDashboardPage'),
)
export const LazyOperationsCenterPage = suspend(
  lazyNamed(() => import('../components/governance/operations-center-page'), 'OperationsCenterPage'),
)
export const LazyGovernanceDataProtectionHubPage = suspend(
  lazyNamed(
    () => import('../components/governance/governance-section-hub-pages'),
    'GovernanceDataProtectionHubPage',
  ),
)
export const LazyViolationCenterPage = suspend(
  lazyNamed(() => import('../components/governance/violation-center-page'), 'ViolationCenterPage'),
)
export const LazyQuarantineCenterPage = suspend(
  lazyNamed(() => import('../components/governance/quarantine-center-page'), 'QuarantineCenterPage'),
)
export const LazyAuditTrailPage = suspend(
  lazyNamed(() => import('../components/governance/audit-trail-page'), 'AuditTrailPage'),
)
export const LazyApprovalWorkflowPage = suspend(
  lazyNamed(() => import('../components/governance/approval-workflow-page'), 'ApprovalWorkflowPage'),
)
export const LazyReplayCenterPage = suspend(
  lazyNamed(() => import('../components/governance/replay-center-page'), 'ReplayCenterPage'),
)
export const LazyNotificationsPage = suspend(
  lazyNamed(() => import('../components/governance/notifications-page'), 'NotificationsPage'),
)
export const LazyGovernanceWorkspacePage = suspend(
  lazyNamed(() => import('../components/governance/governance-workspace-page'), 'GovernanceWorkspacePage'),
)

// Administration & settings
export const LazySettingsOverviewPage = suspend(
  lazyNamed(() => import('../components/settings/settings-overview-page'), 'SettingsOverviewPage'),
)
export const LazyConnectorCatalogPage = suspend(
  lazyNamed(() => import('../components/administration/connector-catalog-page'), 'ConnectorCatalogPage'),
)
export const LazyAuditLogsPage = suspend(
  lazyNamed(() => import('../components/settings/audit-logs-page'), 'AuditLogsPage'),
)
export const LazyOperationsBackupPage = suspend(
  lazyNamed(() => import('../components/operations/operations-backup-page'), 'OperationsBackupPage'),
)
