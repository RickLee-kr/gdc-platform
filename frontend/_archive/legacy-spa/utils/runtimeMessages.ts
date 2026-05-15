/**
 * Canonical operator-facing copy for Runtime UI.
 * Keep strings stable: tests and operator docs depend on exact wording.
 */

import type { TabKey } from '../runtimeTypes'

export const RUNTIME_MESSAGES = {
  requestSucceededInline: '요청 성공',
  loading: '로딩 중...',
  lastSuccessPlaceholder: '아직 없음',
  lastErrorPlaceholder: '아직 없음',
  mappingSaveUnsupported: '현재 탭은 Save를 지원하지 않습니다. Mapping은 Preview 전용입니다.',
  toolbarPersistenceNote:
    'Local persistence: IDs, display density, API URL override는 브라우저 localStorage에 저장됩니다. Reset 버튼은 백엔드 호출 없이 로컬 값만 초기화합니다.',
  realControlBanner:
    'REAL RUNTIME CONTROL: Start / Stop persist stream enabled + status in the database. Does not invoke StreamRunner.',
  streamControlEndpointHint: 'POST /api/v1/runtime/streams/{stream_id}/start | /stop — uses stream_id above',
  previewZoneTitle: 'Preview / test only',
  previewOnlyIntro:
    'PREVIEW-ONLY: No checkpoint updates. No live destination delivery. Read-only or in-memory preview endpoints only.',
  suggestedInvestigationOrder:
    'Suggested investigation order: dashboard -> stream health -> stats -> timeline/logs -> failure trend',
  previewSummaryHttpApiTest: 'Preview result summary: extracted event count + raw_response sample',
  previewSummaryMapping: 'Preview result summary: input vs mapped event counts',
  previewSummaryFormat: 'Preview result summary: destination type + message count',
  previewSummaryRouteDelivery: 'Preview result summary: route/destination context + message count',
  configOperatorGuidanceRegionLabel: 'Runtime Config operator guidance',
  tabDirtyBadgeTitle: 'Unsaved local edits on this tab',
  tabDirtyBadgeText: 'unsaved',
  configChipLocalOnly: 'Local-only: toolbar prefs & ID inputs (browser storage)',
  configChipBackendLoadSave: 'Backend save/load: Reload current tab → GET; Save current tab / Save → POST',
  configChipMappingPreview: 'Preview-only: Mapping panel Preview → POST /preview/mapping (no persistence)',
  configChipMappingReloadGet: 'Backend read: Mapping Reload loads GET mapping-ui/config',
  configChipRealControlPointer:
    'Real runtime control: Runtime Test & Control → stream Start/Stop (database-backed)',
  observabilityGuideRegionLabel: 'Observability operator overview',
  observabilityInvestigationGuide:
    'Investigation order: Health → Stats → Failure trend → Logs → Timeline (narrow filters as needed).',
  observabilityCleanupGlanceLabel: 'Logs cleanup at-a-glance',
  observabilityCleanupNoRunYet:
    'No cleanup response yet — keep dry_run ON until you review matched candidates; cleanup POST is separate from read/search.',
  observabilityEmptyTimelineDetailed:
    'Timeline loaded: no events matched the current filters (items empty). Try widening stage/level filters or increasing limit.',
  timelineOperatorGuidanceDeliveryLogs:
    'delivery_logs(DB)는 커밋된 런타임 결과만 포함합니다.',
  timelineOperatorGuidanceRunFailed:
    'run_failed는 application/file logger 전용이며 delivery_logs에는 저장되지 않습니다.',
  timelineOperatorGuidanceCheckpoint:
    'checkpoint는 destination 전달 성공 이후에만 전진합니다.',
  timelineOperatorGuidanceCrossCheck:
    'Timeline은 Logs / Failure Trend와 함께 교차 확인하세요.',
  timelineLocalFilterStageLabel: 'local filter: stage',
  timelineLocalFilterLevelStatusLabel: 'local filter: level/status',
  timelineLocalFilterEntityLabel: 'local filter: stream/route/destination',
  timelineLocalFilterClear: 'Clear local filters',
  timelineEmptyFiltered:
    'Local filter result is empty. Clear filters or widen stage/level/entity text.',
  observabilityEmptyFailureTrendDetailed:
    'Failure trend loaded: no buckets returned for current filters — widen stream/route/window or raise limit.',
  observabilityEmptyLogsSearchDetailed:
    'Search completed: no log rows matched — relax filters or verify stream/route IDs.',
  observabilityEmptyLogsPageDetailed:
    'Page loaded: no items on this page — adjust filters or use search/timeline for broader context.',
  observabilityEmptyCleanupNoCandidates:
    'Cleanup response: matched_count is 0 — nothing eligible under this cutoff/dry_run configuration.',
  observabilityEmptyStatsRecentLogs:
    'Stats loaded: recent_logs is empty in this response — delivery activity may be idle or logs rolled off.',
  connectorWizardRegionLabel: 'Connector creation wizard',
  connectorWizardTitle: 'Connector creation wizard (MVP)',
  connectorWizardIntro:
    'Frontend-only guide: each step uses the same Runtime Config tabs and existing GET load / POST save APIs. No new backend endpoints.',
  connectorWizardProgressHeading: 'Wizard progress',
  connectorWizardStepNavLabel: 'Wizard steps',
  connectorWizardCurrentStepHeading: 'Current step',
  connectorWizardStatusMissing: 'Missing',
  connectorWizardStatusUnsaved: 'Local edits unsaved',
  connectorWizardStatusReady: 'Ready / no local edits',
  connectorWizardStatusPreviewOnly: 'Preview-only',
  connectorWizardReviewHeading: 'Review checklist',
  connectorWizardReviewIdsHeading: 'Selected IDs',
  connectorWizardReviewMappingHeading: 'Mapping / enrichment',
  connectorWizardReviewNextHeading: 'Recommended next action',
  connectorWizardReviewMissingCountHeading: 'Missing steps',
  connectorWizardReviewUnsavedCountHeading: 'Unsaved steps',
  connectorWizardReviewPreviewGateHeading: 'Ready for preview',
  connectorWizardReviewRuntimeGateHeading: 'Ready for runtime start',
  connectorWizardReviewSaveReminder:
    'Wizard does not save directly. Use Runtime Config Save current tab.',
  connectorWizardActionGoUnsaved: 'Go to unsaved tab',
  connectorWizardActionGoMissing: 'Go to first missing step',
  connectorWizardActionGoSaveArea: 'Go to Runtime Config Save area',
  connectorWizardReviewPreviewRealControl:
    'Reminder: Mapping preview and Runtime Test & Control preview calls are preview-only (no checkpoint updates, no live destination delivery). Stream Start/Stop under Runtime Test & Control is real runtime control and persists stream enabled/status in the database.',
  runtimeTestControlRegionLabel: 'Runtime test and control',
  runtimeTestControlTitle: 'Runtime Test & Control',
  runtimePreviewZoneHeading: 'Preview / Test actions (preview-only)',
  runtimeRealControlZoneHeading: 'Runtime control actions (real runtime effect)',
  runtimePreviewBlurbApiTest:
    'HTTP API test: exercise Source fetch-style extraction against posted source/stream JSON — no checkpoint, no delivery.',
  runtimePreviewBlurbMapping:
    'Mapping preview: raw_response + field_mappings + enrichment → mapped events — in-memory only.',
  runtimePreviewBlurbFormat:
    'Final event / delivery format preview: shapes events for destination formatter — does not send live traffic.',
  runtimePreviewBlurbRoute:
    'Route delivery preview: resolves route/destination context and formatter output for sample final_events — no sender.',
  runtimeQuickJumpApiTest: 'API Test',
  runtimeQuickJumpMapping: 'Mapping Preview',
  runtimeQuickJumpFormat: 'Final Event Preview',
  runtimeQuickJumpRoute: 'Route Delivery Preview',
  runtimeSelectedIdsHeading: 'Selected IDs (toolbar)',
  runtimePreviewPrerequisitesHeading: 'Preview prerequisites / gaps',
  runtimeRealControlAckAriaLabel: 'I understand Start/Stop affects real stream runtime state',
  runtimePreviewBeforeStartHint: 'Use preview/test actions above before starting runtime streams.',
  runtimeRealControlPreviewSafetyNote:
    'Preview/Test actions are safe checks only: they must not change checkpoints or delivery_logs.',
  runtimeControlStartConfirmLabel: 'Start confirmation input',
  runtimeControlStopConfirmLabel: 'Stop confirmation input',
  runtimeControlStartExpectedPrefix: 'Type exact phrase to enable Start:',
  runtimeControlStopExpectedPrefix: 'Type exact phrase to enable Stop:',
  runtimeControlConfirmMismatchHint: 'Confirmation mismatch: check action verb and stream_id exactly.',
  readinessSummaryAriaLabel: 'Operator readiness summary',
  readinessSummaryHeading: 'Readiness summary',
  readinessConnectorSelected: 'Connector selected',
  readinessSourceConfigured: 'Source configured',
  readinessStreamConfigured: 'Stream configured',
  readinessMappingReady: 'Mapping ready',
  readinessRouteReady: 'Route ready',
  readinessDestinationReady: 'Destination ready',
  readinessReadyForPreview: 'Ready for preview',
  readinessReadyForRuntimeStart: 'Ready for runtime start',
  runtimeReadinessNeedStreamForPipeline: 'stream_id recommended for mapping context and stream control.',
  runtimeReadinessNeedRouteForRoutePreview: 'route_id required for route delivery preview using toolbar binding.',
  runtimeReadinessMappingDirty: 'Resolve Mapping unsaved edits in Runtime Config for consistent preview payloads.',
  runtimePreviewPrerequisitesNone: 'No toolbar gaps flagged for common previews.',
  sourceApiOnboardingRegionLabel: 'HTTP API source onboarding',
  sourceApiOnboardingTitle: 'Source / API Onboarding',
  sourceApiOnboardingIntro:
    'Frontend-only guide for HTTP API polling sources: edit payloads in Runtime Config, validate with API Test preview, then continue in Mapping. Uses existing GET/POST preview endpoints only.',
  sourceApiGuidancePreviewOnlyLine:
    'API Test preview calls POST /api/v1/runtime/api-test/http — preview-only: no checkpoint updates and no live destination delivery.',
  sourceApiGuidanceSaveRuntimeConfig:
    'Persist Source and Stream definitions through Runtime Config tabs using Reload current tab / Save current tab (existing POST save APIs). Onboarding does not save on its own.',
  sourceApiGuidanceEventArrayPath:
    'event_array_path (API Test panel or stream JSON) drives how extracted_events are built from raw_response during preview; align it with the JSON structure you inspect.',
  sourceApiGuidanceNoCheckpointLine:
    'Previews do not mutate runtime DB state or checkpoints — only Start/Stop under Runtime Test & Control changes persisted stream control.',
  sourceApiChecklistHeading: 'Onboarding checklist',
  sourceApiQuickNavHeading: 'Quick navigation',
  sourceApiNavRuntimeSource: 'Open Runtime Config: Source',
  sourceApiNavRuntimeStream: 'Open Runtime Config: Stream',
  sourceApiNavRuntimeMapping: 'Open Runtime Config: Mapping',
  sourceApiNavControlApiTest: 'Open Runtime Test & Control: API Test',
  sourceApiFlowHeading: 'Suggested flow',
  sourceApiCheckConnectorSelected: 'Connector selected',
  sourceApiCheckSourceConfigPresent: 'Source config present',
  sourceApiCheckStreamConfigPresent: 'Stream config present',
  sourceApiCheckApiTestReady: 'API test payloads ready',
  sourceApiCheckRawAvailable: 'Raw response available',
  sourceApiCheckEventArrayPath: 'event_array_path configured',
  sourceApiCheckReadyForMapping: 'Ready for Mapping tab',
  frontendHintLabel: 'Frontend hint (operator check)',
  frontendHintSourceInvalidJson: 'Source save payload is not valid JSON object.',
  frontendHintSourceMissingBaseUrl: 'Source base_url/url is missing (config_json.base_url or config_json.url).',
  frontendHintSourceConfigShape: 'Source config_json should be an object.',
  frontendHintSourceAuthShape: 'Source auth_json should be an object when provided.',
  frontendHintStreamInvalidJson: 'Stream save payload is not valid JSON object.',
  frontendHintStreamMissingMethod: 'Stream method is missing.',
  frontendHintStreamMissingEndpoint: 'Stream endpoint/path is missing.',
  frontendHintStreamEventArrayPath: 'Set event_array_path for predictable event extraction.',
  frontendHintStreamParamsShape: 'Stream params should be an object when provided.',
  frontendHintStreamBodyShape: 'Stream body should be object/string/array/null when provided.',
  sourceApiValidationHeading: 'Source/Stream frontend validation hints',
  connectorWizardReviewValidationHeading: 'Source/Stream frontend hints',
  connectorTemplatesRegionLabel: 'Connector templates',
  connectorTemplatesLocalWarning:
    'Templates are local-only. Credentials/secrets must be reviewed manually. Save is not automatic. Run preview/test before runtime start.',
  connectorTemplatesApplyHint:
    'Apply to local form state only: Runtime Config Save current tab is still required.',
  workspaceSummaryRegionLabel: 'Workspace summary',
  workspaceSummaryWarning:
    'Local workspace state is not backend state. Unsaved local edits are not persisted until Save current tab. Template-applied values are local-only until saved.',
  runtimeNavigationRegionLabel: 'Runtime navigation helper',
  runtimeNavigationSwitcherLabel: 'Runtime quick switcher',
  runtimeNavigationWorkflowGuide:
    'Recommended workflow: Template or Workspace -> Config -> Onboarding -> Test/Preview -> Start/Stop -> Observe.',
  runtimeNavigationLocalOnlyReminder:
    'Reminder: local workspace values and templates are not backend state until Save current tab.',
  operatorScenarioRegionLabel: 'Operator scenario mode',
  operatorScenarioTitle: 'Operator Scenario Mode',
  operatorScenarioIntro:
    'Frontend-only guided walkthroughs using current toolbar IDs/local edits and existing Runtime sections.',
  operatorScenarioWarningPreview:
    'Preview/test does not affect checkpoint or delivery_logs.',
  operatorScenarioWarningRealControl:
    'Start/Stop changes real runtime state in database-backed control.',
  operatorScenarioWarningLocalOnly:
    'Local template/workspace state is not backend persisted until Save current tab.',
  runtimeReviewRegionLabel: 'Runtime feature review',
  runtimeReviewTitle: 'Runtime Review',
  runtimeReviewFrontendOnly:
    'This review panel is frontend-only. It does not verify backend persistence.',
  runtimeReviewSaveRequired:
    'Local/template-applied values require Save current tab for backend persistence.',
} as const

export type RuntimeConfigActionModeKind = 'local-only' | 'preview-only' | 'backend-save' | 'real-control'

export type RuntimeConfigActionChip = {
  key: string
  label: string
  mode: RuntimeConfigActionModeKind
}

/** Labels for how the active Runtime Config tab interacts with backend vs preview vs local-only UI. */
export function runtimeConfigActionChips(activeTab: TabKey): RuntimeConfigActionChip[] {
  const chips: RuntimeConfigActionChip[] = [
    { key: 'local', label: RUNTIME_MESSAGES.configChipLocalOnly, mode: 'local-only' },
  ]
  if (activeTab === 'mapping') {
    chips.push({ key: 'preview', label: RUNTIME_MESSAGES.configChipMappingPreview, mode: 'preview-only' })
    chips.push({ key: 'backend-read', label: RUNTIME_MESSAGES.configChipMappingReloadGet, mode: 'backend-save' })
  } else {
    chips.push({ key: 'backend', label: RUNTIME_MESSAGES.configChipBackendLoadSave, mode: 'backend-save' })
  }
  chips.push({ key: 'control', label: RUNTIME_MESSAGES.configChipRealControlPointer, mode: 'real-control' })
  return chips
}

export function formatRuntimeOperationSuccess(label: string): string {
  return `${label} 성공`
}

export function formatRuntimeOperationFailure(label: string, message: string): string {
  return `${label} 실패: ${message}`
}

export function preferenceFeedbackResetIds(): string {
  return 'Reset IDs 완료: 브라우저 로컬 저장 ID를 비우고 입력값을 초기화했습니다.'
}

export function preferenceFeedbackResetUiPreferences(): string {
  return 'Reset UI preferences 완료: 표시 밀도를 기본값(comfortable)으로 복원했습니다.'
}

export function preferenceFeedbackApplyApiUrl(trimmedDraft: string): string {
  return trimmedDraft
    ? `API URL override 적용: ${trimmedDraft} (브라우저 로컬 저장)`
    : 'API URL override 입력값이 비어 있어 기본 API URL을 사용합니다.'
}

export function preferenceFeedbackResetApiUrl(): string {
  return 'Reset API URL 완료: 브라우저 로컬 override를 제거하고 기본 API URL로 복원했습니다.'
}

/** Matches legacy jsonUtils parse error templates (object JSON input). */
export function formatJsonObjectParseFailure(label: string, parseMessage: string): string {
  return `${label} JSON 파싱 실패: ${parseMessage} (유효한 JSON object 형식인지 확인하세요)`
}

export function formatJsonValueParseFailure(label: string, parseMessage: string): string {
  return `${label} JSON 파싱 실패: ${parseMessage} (유효한 JSON 형식인지 확인하세요)`
}

export function formatJsonArrayParseFailure(label: string, parseMessage: string): string {
  return `${label} JSON 파싱 실패: ${parseMessage} (유효한 JSON array 형식인지 확인하세요)`
}

export function formatExpectJsonObject(label: string): string {
  return `${label}는 JSON object여야 합니다.`
}

export function formatExpectJsonArray(label: string): string {
  return `${label}는 JSON array여야 합니다.`
}

export function formatExpectJsonArrayItemObject(label: string, index: number): string {
  return `${label}[${index}]는 JSON object여야 합니다.`
}
