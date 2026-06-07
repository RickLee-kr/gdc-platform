import { Navigate, Route, Routes } from 'react-router-dom'
import { ConnectorDetailPage } from './components/connectors/connector-detail-page'
import { DashboardOverview } from './components/dashboard/dashboard-overview'
import { DestinationDetailPage } from './components/destinations/destination-detail-page'
import { DestinationsManagementPage } from './components/destinations/destinations-management-page'
import { AppShellLayout, PlaceholderPage } from './components/layout/app-shell-layout'
import { PreserveSearchRedirect } from './components/layout/preserve-search-redirect'
import { LogsExplorerPage } from './components/logs/logs-explorer-page'
import { ConnectorsOverviewPage } from './components/connectors/connectors-overview-page'
import { NewConnectorWizardPage } from './components/connectors/new-connector-wizard-page'
import { MappingEditPage } from './components/mappings/mapping-edit-page'
import { MappingsOverviewPage } from './components/mappings/mappings-overview-page'
import { RuntimeOverviewPage } from './components/runtime/runtime-overview-page'
import { RuntimeAnalyticsPage } from './components/runtime/runtime-analytics-page'
import { RuntimeTopologyPage } from './components/runtime/runtime-topology-page'
import { AiGatewayPage } from './components/runtime/ai-gateway-page'
import { GovernanceDashboardPage } from './components/governance/governance-dashboard-page'
import { OperationsCenterPage } from './components/governance/operations-center-page'
import { ViolationCenterPage } from './components/governance/violation-center-page'
import { GovernanceShell } from './components/governance/governance-shell'
import { QuarantineCenterPage } from './components/governance/quarantine-center-page'
import { ReplayCenterPage } from './components/governance/replay-center-page'
import { NotificationsPage } from './components/governance/notifications-page'
import { AuditTrailPage } from './components/governance/audit-trail-page'
import { ApprovalWorkflowPage } from './components/governance/approval-workflow-page'
import {
  GovernanceDataProtectionHubPage,
} from './components/governance/governance-section-hub-pages'
import { AdministrationHubPage } from './components/administration/administration-hub-page'
import { ConnectorCatalogPage } from './components/administration/connector-catalog-page'
import { StreamMappingPage } from './components/streams/stream-mapping-page'
import { StreamEditPage } from './components/streams/stream-edit-page'
import { RouteEditPage } from './components/routes/route-edit-page'
import { RoutesOverviewPage } from './components/routes/routes-overview-page'
import { StreamApiTestPage } from './components/streams/stream-api-test-page'
import { StreamEnrichmentPage } from './components/streams/stream-enrichment-page'
import { StreamRuntimeDetailPage } from './components/streams/stream-runtime-detail-page'
import { NewStreamWizardPage } from './components/streams/new-stream-wizard-page'
import { StreamsConsole } from './components/streams/streams-console'
import { AuditLogsPage } from './components/settings/audit-logs-page'
import { SettingsOverviewPage } from './components/settings/settings-overview-page'
import { OperationsBackupPage } from './components/operations/operations-backup-page'
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

const PLACEHOLDER_NAV_KEYS: AppNavKey[] = []

export default function App() {
  return (
    <Routes>
      <Route element={<AppShellLayout />}>
        <Route index element={<DashboardOverview />} />
        <Route path="streams" element={<StreamsConsole />} />
        <Route path="streams/new" element={<NewStreamWizardPage />} />
        <Route path="streams/:streamId/api-test" element={<StreamApiTestPage />} />
        <Route path="streams/:streamId/enrichment" element={<StreamEnrichmentPage />} />
        <Route path="streams/:streamId/runtime" element={<StreamRuntimeDetailPage />} />
        <Route path="streams/:streamId/mapping" element={<StreamMappingPage />} />
        <Route path="streams/:streamId/edit" element={<StreamEditPage />} />
        <Route path="monitoring" element={<RuntimeOverviewPage />} />
        <Route path="monitoring/topology" element={<RuntimeTopologyPage />} />
        <Route path="monitoring/analytics" element={<RuntimeAnalyticsPage />} />
        <Route path="runtime" element={<PreserveSearchRedirect to={NAV_PATH.monitoring} />} />
        <Route path="runtime/topology" element={<PreserveSearchRedirect to={NAV_PATH.topology} />} />
        <Route path="runtime/analytics" element={<PreserveSearchRedirect to={NAV_PATH.analytics} />} />
        <Route path="runtime/ai-gateway" element={<PreserveSearchRedirect to={NAV_PATH.aiGateway} />} />
        <Route path="admin" element={<AdministrationHubPage />} />
        <Route path="admin/connector-catalog" element={<OssRouteGuard redirectTo={NAV_PATH.administration}><ConnectorCatalogPage /></OssRouteGuard>} />
        <Route path="connectors" element={<ConnectorsOverviewPage />} />
        <Route path="connectors/new" element={<NewConnectorWizardPage />} />
        <Route path="connectors/:connectorId" element={<ConnectorDetailPage />} />
        <Route path="mappings" element={<MappingsOverviewPage />} />
        <Route path="mappings/:mappingId/edit" element={<MappingEditPage />} />
        <Route path="destinations" element={<DestinationsManagementPage />} />
        <Route path="destinations/:destinationId" element={<DestinationDetailPage />} />
        <Route path="routes" element={<RoutesOverviewPage />} />
        <Route path="routes/:routeId/edit" element={<RouteEditPage />} />
        <Route path="governance" element={<GovernanceShell />}>
          <Route index element={<GovernanceDashboardPage />} />
          <Route path="operations" element={<OperationsCenterPage />} />
          <Route path="data-protection" element={<OssRouteGuard redirectTo={NAV_PATH.governance}><GovernanceDataProtectionHubPage /></OssRouteGuard>} />
          <Route path="violations" element={<ViolationCenterPage />} />
          <Route path="ai" element={<OssRouteGuard redirectTo={NAV_PATH.governance}><AiGatewayPage /></OssRouteGuard>} />
          <Route path="quarantine" element={<QuarantineCenterPage />} />
          <Route path="audit" element={<AuditTrailPage />} />
          <Route path="approvals" element={<ApprovalWorkflowPage />} />
          <Route path="replay" element={<ReplayCenterPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
        </Route>
        <Route
          path="validation"
          element={
            <OssRouteGuard redirectTo={NAV_PATH.monitoring}>
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
        <Route path="logs" element={<LogsExplorerPage />} />
        <Route path="logs/:streamId" element={<LogsExplorerPage />} />
        <Route path="templates" element={<OssRouteGuard redirectTo={NAV_PATH.streams}><TemplatesOverviewPage /></OssRouteGuard>} />
        <Route path="operations/backup" element={<OperationsBackupPage />} />
        <Route path="settings" element={<SettingsOverviewPage />} />
        <Route path="settings/audit-logs" element={<AuditLogsPage />} />
        <Route path="settings/network" element={<Navigate to="/settings" replace />} />
        {PLACEHOLDER_NAV_KEYS.map((key) => (
          <Route key={key} path={key} element={<PlaceholderPage title={PAGE_TITLE[key]} />} />
        ))}
        <Route path="*" element={<Navigate to="/streams" replace />} />
      </Route>
    </Routes>
  )
}
