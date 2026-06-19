import { Navigate, Route, Routes } from 'react-router-dom'
import { ConnectorDetailPage } from './components/connectors/connector-detail-page'
import { DashboardOverview } from './components/dashboard/dashboard-overview'
import { AppShellLayout, PlaceholderPage } from './components/layout/app-shell-layout'
import { PreserveSearchRedirect } from './components/layout/preserve-search-redirect'
import { ConnectorsOverviewPage } from './components/connectors/connectors-overview-page'
import { NewConnectorWizardPage } from './components/connectors/new-connector-wizard-page'
import { MappingEditPage } from './components/mappings/mapping-edit-page'
import { MappingsOverviewPage } from './components/mappings/mappings-overview-page'
import { StreamMappingPage } from './components/streams/stream-mapping-page'
import { StreamEditPage } from './components/streams/stream-edit-page'
import { StreamApiTestPage } from './components/streams/stream-api-test-page'
import { StreamEnrichmentPage } from './components/streams/stream-enrichment-page'
import { StreamRuntimeDetailPage } from './components/streams/stream-runtime-detail-page'
import { StreamsConsole } from './components/streams/streams-console'
import { TemplatesOverviewPage } from './components/templates/templates-overview-page'
import { ValidationShell } from './components/validation/validation-shell'
import { ValidationOverviewPage } from './components/validation/validation-overview-page'
import { ValidationRunsPage } from './components/validation/validation-runs-page'
import { ValidationFailingPage } from './components/validation/validation-failing-page'
import { ValidationAuthPage } from './components/validation/validation-auth-page'
import { ValidationDeliveryPage } from './components/validation/validation-delivery-page'
import { ValidationAlertsPage } from './components/validation/validation-alerts-page'
import { ValidationCheckpointPage } from './components/validation/validation-checkpoint-page'
import { OssRouteGuard } from './components/oss/oss-route-guard'
import { NAV_PATH } from './config/nav-paths'
import { PAGE_TITLE, type AppNavKey } from './config/app-navigation'
import {
  LazyApprovalWorkflowPage,
  LazyAuditLogsPage,
  LazyAuditTrailPage,
  LazyConnectorCatalogPage,
  LazyDestinationDetailPage,
  LazyDestinationsManagementPage,
  LazyGovernanceDashboardPage,
  LazyGovernanceDataProtectionHubPage,
  LazyGovernanceShell,
  LazyGovernanceWorkspacePage,
  LazyLogsExplorerPage,
  LazyNewStreamWizardPage,
  LazyNotificationsPage,
  LazyOperationsBackupPage,
  LazyOperationsCenterPage,
  LazyQuarantineCenterPage,
  LazyReplayCenterPage,
  LazyRouteEditPage,
  LazyRoutesOverviewPage,
  LazySettingsOverviewPage,
  LazyViolationCenterPage,
} from './routes/lazy-routes'

const PLACEHOLDER_NAV_KEYS: AppNavKey[] = []

export default function App() {
  return (
    <Routes>
      <Route element={<AppShellLayout />}>
        <Route index element={<Navigate to={NAV_PATH.dashboard} replace />} />
        <Route path="streams" element={<StreamsConsole />} />
        <Route path="streams/new" element={<LazyNewStreamWizardPage />} />
        <Route path="streams/:streamId/api-test" element={<StreamApiTestPage />} />
        <Route path="streams/:streamId/enrichment" element={<StreamEnrichmentPage />} />
        <Route path="streams/:streamId/runtime" element={<StreamRuntimeDetailPage />} />
        <Route path="streams/:streamId/mapping" element={<StreamMappingPage />} />
        <Route path="streams/:streamId/edit" element={<StreamEditPage />} />
        <Route path="monitoring" element={<DashboardOverview />} />
        <Route path="monitoring/streams" element={<PreserveSearchRedirect to={NAV_PATH.streams} />} />
        <Route path="monitoring/topology" element={<PreserveSearchRedirect to={NAV_PATH.dashboard} />} />
        <Route path="monitoring/analytics" element={<PreserveSearchRedirect to={NAV_PATH.dashboard} />} />
        <Route path="runtime" element={<PreserveSearchRedirect to={NAV_PATH.dashboard} />} />
        <Route path="runtime/topology" element={<PreserveSearchRedirect to={NAV_PATH.dashboard} />} />
        <Route path="runtime/analytics" element={<PreserveSearchRedirect to={NAV_PATH.dashboard} />} />
        <Route path="runtime/ai-gateway" element={<PreserveSearchRedirect to={NAV_PATH.streams} />} />
        <Route path="admin" element={<LazySettingsOverviewPage />} />
        <Route
          path="admin/connector-catalog"
          element={
            <OssRouteGuard redirectTo={NAV_PATH.administration}>
              <LazyConnectorCatalogPage />
            </OssRouteGuard>
          }
        />
        <Route path="connectors" element={<ConnectorsOverviewPage />} />
        <Route path="connectors/new" element={<NewConnectorWizardPage />} />
        <Route path="connectors/:connectorId" element={<ConnectorDetailPage />} />
        <Route path="mappings" element={<MappingsOverviewPage />} />
        <Route path="mappings/:mappingId/edit" element={<MappingEditPage />} />
        <Route path="destinations" element={<LazyDestinationsManagementPage />} />
        <Route path="destinations/:destinationId" element={<LazyDestinationDetailPage />} />
        <Route path="routes" element={<LazyRoutesOverviewPage />} />
        <Route path="routes/:routeId/edit" element={<LazyRouteEditPage />} />
        <Route path="governance" element={<LazyGovernanceShell />}>
          <Route index element={<LazyGovernanceDashboardPage />} />
          <Route path="operations" element={<LazyOperationsCenterPage />} />
          <Route
            path="data-protection"
            element={
              <OssRouteGuard redirectTo={NAV_PATH.governance}>
                <LazyGovernanceDataProtectionHubPage />
              </OssRouteGuard>
            }
          />
          <Route path="violations" element={<LazyViolationCenterPage />} />
          <Route path="quarantine" element={<LazyQuarantineCenterPage />} />
          <Route path="audit" element={<LazyAuditTrailPage />} />
          <Route path="approvals" element={<LazyApprovalWorkflowPage />} />
          <Route path="replay" element={<LazyReplayCenterPage />} />
          <Route path="notifications" element={<LazyNotificationsPage />} />
          <Route path="workspace" element={<LazyGovernanceWorkspacePage />} />
        </Route>
        <Route
          path="validation"
          element={
            <OssRouteGuard redirectTo={NAV_PATH.dashboard}>
              <ValidationShell />
            </OssRouteGuard>
          }
        >
          <Route index element={<ValidationOverviewPage />} />
          <Route path="alerts" element={<ValidationAlertsPage />} />
          <Route path="runs" element={<ValidationRunsPage />} />
          <Route path="failing" element={<ValidationFailingPage />} />
          <Route path="auth" element={<ValidationAuthPage />} />
          <Route path="delivery" element={<ValidationDeliveryPage />} />
          <Route path="checkpoints" element={<ValidationCheckpointPage />} />
        </Route>
        <Route path="logs" element={<LazyLogsExplorerPage />} />
        <Route path="logs/:streamId" element={<LazyLogsExplorerPage />} />
        <Route
          path="templates"
          element={
            <OssRouteGuard redirectTo={NAV_PATH.streams}>
              <TemplatesOverviewPage />
            </OssRouteGuard>
          }
        />
        <Route path="operations/backup" element={<LazyOperationsBackupPage />} />
        <Route path="settings" element={<LazySettingsOverviewPage />} />
        <Route path="settings/audit-logs" element={<LazyAuditLogsPage />} />
        <Route path="settings/network" element={<Navigate to="/settings" replace />} />
        {PLACEHOLDER_NAV_KEYS.map((key) => (
          <Route key={key} path={key} element={<PlaceholderPage title={PAGE_TITLE[key]} />} />
        ))}
        <Route path="*" element={<Navigate to="/streams" replace />} />
      </Route>
    </Routes>
  )
}
