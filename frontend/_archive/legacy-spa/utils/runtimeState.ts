import type { AppSection, TabKey } from '../runtimeTypes'

export type MappingRowLite = { outputField: string; sourcePath: string; sampleValue?: unknown }

export function mappingRowsSignature(rows: MappingRowLite[]): string {
  return JSON.stringify(rows.map((row) => ({ outputField: row.outputField, sourcePath: row.sourcePath })))
}

export type PersistedIds = {
  connectorId: string
  sourceId: string
  streamId: string
  routeId: string
  destinationId: string
}

export function buildIdChecklist(ids: PersistedIds): Array<{ key: string; value: string }> {
  return [
    { key: 'connector_id', value: ids.connectorId.trim() },
    { key: 'source_id', value: ids.sourceId.trim() },
    { key: 'stream_id', value: ids.streamId.trim() },
    { key: 'route_id', value: ids.routeId.trim() },
    { key: 'destination_id', value: ids.destinationId.trim() },
  ]
}

/** Single-line summary for compact operator HUD near Runtime Config actions. */
export function formatCompactRuntimeIds(ids: PersistedIds): string {
  const v = (s: string) => s.trim() || '—'
  return `connector=${v(ids.connectorId)} · source=${v(ids.sourceId)} · stream=${v(ids.streamId)} · route=${v(ids.routeId)} · destination=${v(ids.destinationId)}`
}

export type UnsavedTabInput = {
  connectorSave: string
  connectorSaveBaseline: string
  sourceSave: string
  sourceSaveBaseline: string
  streamSave: string
  streamSaveBaseline: string
  mappingRawResponseJson: string
  mappingRawBaseline: string
  mappingEnrichmentJson: string
  mappingEnrichmentBaseline: string
  mappingRowsSignature: string
  mappingRowsBaseline: string
  routeSave: string
  routeSaveBaseline: string
  destinationSave: string
  destinationSaveBaseline: string
}

export function computeUnsavedByTab(input: UnsavedTabInput): Record<TabKey, string[]> {
  return {
    connector: input.connectorSave !== input.connectorSaveBaseline ? ['connector save payload'] : [],
    source: input.sourceSave !== input.sourceSaveBaseline ? ['source save payload'] : [],
    stream: input.streamSave !== input.streamSaveBaseline ? ['stream save payload'] : [],
    mapping: [
      ...(input.mappingRawResponseJson !== input.mappingRawBaseline ? ['mapping raw_response'] : []),
      ...(input.mappingEnrichmentJson !== input.mappingEnrichmentBaseline ? ['mapping enrichment'] : []),
      ...(input.mappingRowsSignature !== input.mappingRowsBaseline ? ['mapping table'] : []),
    ],
    route: input.routeSave !== input.routeSaveBaseline ? ['route save payload'] : [],
    destination:
      input.destinationSave !== input.destinationSaveBaseline ? ['destination save payload'] : [],
  }
}

export type RecommendedNextActionInput = {
  activeSection: AppSection
  activeTab: TabKey
  missingIds: string[]
  hasStreamId: boolean
  hasRouteId: boolean
}

export function computeRecommendedNextAction(p: RecommendedNextActionInput): string {
  if (p.missingIds.length > 0) {
    return `누락된 ID 입력: ${p.missingIds.join(', ')}`
  }
  if (p.activeSection === 'config') {
    if (p.activeTab === 'mapping') {
      return 'Mapping 탭에서 raw payload tree를 확인하고 JSONPath를 선택한 뒤 preview를 실행하세요.'
    }
    return `${p.activeTab} 탭에서 Reload current tab으로 최신 설정을 불러오고 Save current tab으로 반영하세요.`
  }
  if (p.activeSection === 'controlTest') {
    return p.hasStreamId
      ? 'Start/Stop은 실제 제어입니다. 먼저 preview-only 테스트를 실행해 payload를 검증하세요.'
      : 'Runtime Test & Control 전에 stream_id를 먼저 입력하세요.'
  }
  if (p.activeSection === 'dashboard') {
    return 'Dashboard를 로드한 뒤 Stream Health로 이동해 영향 stream을 확인하세요.'
  }
  if (p.activeSection === 'health') {
    return p.hasStreamId
      ? 'Stream Health 다음으로 Stream Stats를 조회하세요.'
      : 'Stream Health 조회 전 stream_id를 입력하세요.'
  }
  if (p.activeSection === 'stats') {
    return 'Stats 확인 후 Timeline/Logs에서 실패 stage와 error_code를 추적하세요.'
  }
  if (p.activeSection === 'timeline' || p.activeSection === 'logs') {
    return 'Timeline/Logs 분석 후 Failure Trend에서 패턴을 확인하세요.'
  }
  if (p.activeSection === 'failureTrend') {
    return p.hasRouteId
      ? '문제 route_id 기준으로 Runtime Config(Route/Destination)에서 정책과 제한값을 점검하세요.'
      : 'Failure Trend 분석 후 route_id를 식별해 Route 설정을 점검하세요.'
  }
  if (p.activeSection === 'connectorWizard') {
    return 'Connector 마법사에서 미완료 단계를 Runtime Config와 동일한 Load/Save 흐름으로 맞춘 뒤 Review에서 확인하세요.'
  }
  if (p.activeSection === 'sourceApiOnboarding') {
    return 'Source / API 온보딩에서 Runtime Config(Source/Stream) 편집·저장 후 API Test 프리뷰로 검증하고 Mapping 탭으로 이어가세요.'
  }
  if (p.activeSection === 'liveSimulation') {
    return 'Live Simulation은 프론트 로컬 데모 전용입니다. Start 후 Execution History/Observability에서 변화를 확인하세요.'
  }
  return 'Runtime Config에서 엔터티 설정을 확인하고 Observability에서 상태를 점검하세요.'
}
