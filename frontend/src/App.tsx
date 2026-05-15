import { Navigate, Route, Routes } from 'react-router-dom'
import { ConnectorDetailPage } from './components/connectors/connector-detail-page'
import { DashboardOverview } from './components/dashboard/dashboard-overview'
import { DestinationDetailPage } from './components/destinations/destination-detail-page'
import { DestinationsManagementPage } from './components/destinations/destinations-management-page'
import { AppShellLayout, PlaceholderPage } from './components/layout/app-shell-layout'
import { LogsExplorerPage } from './components/logs/logs-explorer-page'
import { ConnectorsOverviewPage } from './components/connectors/connectors-overview-page'
import { NewConnectorWizardPage } from './components/connectors/new-connector-wizard-page'
import { MappingEditPage } from './components/mappings/mapping-edit-page'
import { MappingsOverviewPage } from './components/mappings/mappings-overview-page'
import { RuntimeOverviewPage } from './components/runtime/runtime-overview-page'
import { RuntimeAnalyticsPage } from './components/runtime/runtime-analytics-page'
import { StreamMappingPage } from './components/streams/stream-mapping-page'
import { StreamEditPage } from './components/streams/stream-edit-page'
import { RouteEditPage } from './components/routes/route-edit-page'
import { RoutesOverviewPage } from './components/routes/routes-overview-page'
import { StreamApiTestPage } from './components/streams/stream-api-test-page'
import { StreamEnrichmentPage } from './components/streams/stream-enrichment-page'
import { StreamRuntimeDetailPage } from './components/streams/stream-runtime-detail-page'
import { NewStreamWizardPage } from './components/streams/new-stream-wizard-page'
import { StreamsConsole } from './components/streams/streams-console'
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
        <Route path="connectors" element={<ConnectorsOverviewPage />} />
        <Route path="connectors/new" element={<NewConnectorWizardPage />} />
        <Route path="connectors/:connectorId" element={<ConnectorDetailPage />} />
        <Route path="mappings" element={<MappingsOverviewPage />} />
        <Route path="mappings/:mappingId/edit" element={<MappingEditPage />} />
        <Route path="destinations" element={<DestinationsManagementPage />} />
        <Route path="destinations/:destinationId" element={<DestinationDetailPage />} />
        <Route path="routes" element={<RoutesOverviewPage />} />
        <Route path="routes/:routeId/edit" element={<RouteEditPage />} />
        <Route path="runtime" element={<RuntimeOverviewPage />} />
        <Route path="runtime/analytics" element={<RuntimeAnalyticsPage />} />
        <Route path="validation" element={<ValidationShell />}>
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
        <Route path="templates" element={<TemplatesOverviewPage />} />
        <Route path="operations/backup" element={<OperationsBackupPage />} />
        <Route path="settings" element={<SettingsOverviewPage />} />
        {PLACEHOLDER_NAV_KEYS.map((key) => (
          <Route key={key} path={key} element={<PlaceholderPage title={PAGE_TITLE[key]} />} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
