import { prettyJson } from '../jsonUtils'

export type ConnectorTemplateFieldSuggestion = {
  outputField: string
  sourcePath: string
}

export type ConnectorTemplate = {
  key: string
  category: 'EDR/XDR' | 'NDR' | 'Microsoft Security' | 'Generic'
  name: string
  description: string
  operatorGuidance: {
    dataRepresents: string
    whenToUse: string
    destinationBehavior: string
  }
  connectorSave: string
  sourceSave: string
  streamSave: string
  mappingRawSample: string
  mappingFieldSuggestions: ConnectorTemplateFieldSuggestion[]
  mappingEventArrayPath: string
  enrichmentStaticFields: string
  routeDestinationGuidance: string[]
}

function asJson(value: unknown): string {
  return prettyJson(value)
}

export const CONNECTOR_TEMPLATES: ConnectorTemplate[] = [
  {
    key: 'cybereason-malop-api',
    category: 'EDR/XDR',
    name: 'Cybereason Malop API',
    description: 'Malop incident polling starter for common alert mapping.',
    operatorGuidance: {
      dataRepresents: 'Cybereason Malop incident-style endpoint alerts.',
      whenToUse: 'Use when validating endpoint incident polling onboarding.',
      destinationBehavior: 'Expected destination payload is alert-centric with severity/category fields.',
    },
    connectorSave: asJson({
      name: 'cybereason-malop-connector',
      vendor: 'cybereason',
      notes: 'Template only: review credentials and tenant fields.',
    }),
    sourceSave: asJson({
      enabled: true,
      config_json: {
        url: 'https://example.cybereason.local/rest/visualsearch/query/simple',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { queryPath: [{ requestedType: 'MalopProcess' }] },
      },
      auth_json: { authorization: 'Bearer ${TOKEN}' },
    }),
    streamSave: asJson({
      name: 'cybereason-malop-stream',
      enabled: false,
      polling_interval: 120,
      config_json: {
        method: 'POST',
        endpoint: '/rest/visualsearch/query/simple',
        event_array_path: '$.result.data',
      },
      rate_limit_json: { per_sec: 1 },
    }),
    mappingRawSample: asJson({
      result: {
        data: [
          {
            guid: 'malop-1',
            severity: 'HIGH',
            type: 'RANSOMWARE',
            machine_name: 'host-a',
            updated_time: 1710000000,
          },
        ],
      },
    }),
    mappingFieldSuggestions: [
      { outputField: 'alert_id', sourcePath: '$.guid' },
      { outputField: 'severity', sourcePath: '$.severity' },
      { outputField: 'category', sourcePath: '$.type' },
      { outputField: 'host', sourcePath: '$.machine_name' },
    ],
    mappingEventArrayPath: '$.result.data',
    enrichmentStaticFields: asJson({
      vendor: 'cybereason',
      feed: 'malop_api',
      source_type: 'endpoint_alert',
    }),
    routeDestinationGuidance: [
      'Route failure_policy를 운영 기준(LOG_AND_CONTINUE 또는 RETRY_AND_BACKOFF)으로 확인하세요.',
      'Destination rate_limit_json을 수신 시스템 허용치에 맞추세요.',
    ],
  },
  {
    key: 'cybereason-hunting-api',
    category: 'EDR/XDR',
    name: 'Cybereason Hunting API',
    description: 'Hunting query result polling starter with IOC style fields.',
    operatorGuidance: {
      dataRepresents: 'Cybereason hunting query events with IOC-like records.',
      whenToUse: 'Use when rehearsing hunt-result ingestion and mapping.',
      destinationBehavior: 'Expected destination payload includes indicator/confidence/host fields.',
    },
    connectorSave: asJson({
      name: 'cybereason-hunting-connector',
      vendor: 'cybereason',
      notes: 'Template only: query/filter payload must be reviewed.',
    }),
    sourceSave: asJson({
      enabled: true,
      config_json: {
        url: 'https://example.cybereason.local/rest/hunting/search',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { query: 'malicious OR suspicious' },
      },
      auth_json: { authorization: 'Bearer ${TOKEN}' },
    }),
    streamSave: asJson({
      name: 'cybereason-hunting-stream',
      enabled: false,
      polling_interval: 180,
      config_json: {
        method: 'POST',
        endpoint: '/rest/hunting/search',
        event_array_path: '$.items',
      },
      rate_limit_json: { per_sec: 1 },
    }),
    mappingRawSample: asJson({
      items: [
        {
          event_id: 'hunt-1',
          indicator: 'hash:abcd',
          confidence: 'MEDIUM',
          host: 'host-b',
          ts: '2026-05-01T10:00:00Z',
        },
      ],
    }),
    mappingFieldSuggestions: [
      { outputField: 'event_id', sourcePath: '$.event_id' },
      { outputField: 'indicator', sourcePath: '$.indicator' },
      { outputField: 'confidence', sourcePath: '$.confidence' },
      { outputField: 'host', sourcePath: '$.host' },
    ],
    mappingEventArrayPath: '$.items',
    enrichmentStaticFields: asJson({
      vendor: 'cybereason',
      feed: 'hunting_api',
      source_type: 'hunting_result',
    }),
    routeDestinationGuidance: [
      'Route formatter_config는 대상지 포맷(JSON/syslog)에 맞춰 조정하세요.',
      'Destination enabled/rate_limit 상태를 Runtime Config에서 저장 전 점검하세요.',
    ],
  },
  {
    key: 'vectra-ai-detection',
    category: 'NDR',
    name: 'Vectra AI Detection',
    description: 'Vectra detection polling starter focused on threat and triage context.',
    operatorGuidance: {
      dataRepresents: 'NDR detection events with certainty score and triage state.',
      whenToUse: 'Use when onboarding network detection alert streams.',
      destinationBehavior: 'Expected destination receives detection-centric events for SOC triage.',
    },
    connectorSave: asJson({
      name: 'vectra-detection-connector',
      vendor: 'vectra_ai',
      notes: 'Template example only. Review tenant/path/header values before production use.',
    }),
    sourceSave: asJson({
      enabled: true,
      config_json: {
        url: 'https://api.example.com/vectra/v2/detections',
        method: 'GET',
        headers: { Accept: 'application/json' },
      },
      auth_json: { authorization: 'Bearer ${TOKEN}' },
    }),
    streamSave: asJson({
      name: 'vectra-detection-stream',
      enabled: false,
      polling_interval: 90,
      config_json: {
        method: 'GET',
        endpoint: '/vectra/v2/detections',
        event_array_path: '$.results',
      },
      rate_limit_json: { per_sec: 2 },
    }),
    mappingRawSample: asJson({
      results: [
        {
          id: 'vectra-det-001',
          threat: 'COMMAND_AND_CONTROL',
          certainty: 87,
          host_name: 'endpoint-demo-01',
          triage: 'new',
          timestamp: '2026-05-01T10:10:00Z',
        },
      ],
    }),
    mappingFieldSuggestions: [
      { outputField: 'detection_id', sourcePath: '$.id' },
      { outputField: 'threat_type', sourcePath: '$.threat' },
      { outputField: 'certainty_score', sourcePath: '$.certainty' },
      { outputField: 'host_name', sourcePath: '$.host_name' },
      { outputField: 'triage_state', sourcePath: '$.triage' },
    ],
    mappingEventArrayPath: '$.results',
    enrichmentStaticFields: asJson({
      vendor: 'vectra_ai',
      product: 'detection',
      source_type: 'ndr_detection',
    }),
    routeDestinationGuidance: [
      'Network threat triage 용도라면 Destination formatter에서 detection_id, threat_type을 우선 유지하세요.',
      '초기 운영은 LOG_AND_CONTINUE + 낮은 rate_limit으로 시작해 전송 안정성을 확인하세요.',
    ],
  },
  {
    key: 'vectra-ai-entity-host-context',
    category: 'NDR',
    name: 'Vectra AI Entity / Host context',
    description: 'Vectra host/entity context polling starter for enrichment-oriented flows.',
    operatorGuidance: {
      dataRepresents: 'NDR entity/host context records for enrichment and correlation.',
      whenToUse: 'Use when testing host context augmentation before downstream routing.',
      destinationBehavior: 'Expected destination receives context-rich records rather than alert-only events.',
    },
    connectorSave: asJson({
      name: 'vectra-entity-context-connector',
      vendor: 'vectra_ai',
      notes: 'Template example only. Validate object semantics with your SOC mapping policy.',
    }),
    sourceSave: asJson({
      enabled: true,
      config_json: {
        url: 'https://api.example.com/vectra/v2/entities/hosts',
        method: 'GET',
        headers: { Accept: 'application/json' },
      },
      auth_json: { authorization: 'Bearer ${TOKEN}' },
    }),
    streamSave: asJson({
      name: 'vectra-entity-context-stream',
      enabled: false,
      polling_interval: 180,
      config_json: {
        method: 'GET',
        endpoint: '/vectra/v2/entities/hosts',
        event_array_path: '$.results',
      },
      rate_limit_json: { per_sec: 1 },
    }),
    mappingRawSample: asJson({
      results: [
        {
          id: 'vectra-host-001',
          name: 'host-demo-01',
          ip: '198.51.100.10',
          last_detection_timestamp: '2026-05-01T10:15:00Z',
          urgency_score: 64,
        },
      ],
    }),
    mappingFieldSuggestions: [
      { outputField: 'entity_id', sourcePath: '$.id' },
      { outputField: 'entity_name', sourcePath: '$.name' },
      { outputField: 'entity_ip', sourcePath: '$.ip' },
      { outputField: 'last_detection_timestamp', sourcePath: '$.last_detection_timestamp' },
      { outputField: 'urgency_score', sourcePath: '$.urgency_score' },
    ],
    mappingEventArrayPath: '$.results',
    enrichmentStaticFields: asJson({
      vendor: 'vectra_ai',
      product: 'entity_context',
      source_type: 'ndr_host_context',
    }),
    routeDestinationGuidance: [
      'Context 데이터는 alert와 별도 인덱스로 분리 전송하는 구성을 권장합니다.',
      'Destination 쪽에서 entity_id 중복 처리(upsert 전략)를 운영팀과 사전 합의하세요.',
    ],
  },
  {
    key: 'crowdstrike-detection',
    category: 'EDR/XDR',
    name: 'CrowdStrike Detection',
    description: 'CrowdStrike detection feed starter for endpoint detection response onboarding.',
    operatorGuidance: {
      dataRepresents: 'EDR detection events with tactic/technique and host identity context.',
      whenToUse: 'Use when testing Falcon-like detection normalization and routing.',
      destinationBehavior: 'Expected destination receives MITRE-friendly detection payload fields.',
    },
    connectorSave: asJson({
      name: 'crowdstrike-detection-connector',
      vendor: 'crowdstrike',
      notes: 'Template example only. Keep credentials placeholder-only in local preview.',
    }),
    sourceSave: asJson({
      enabled: true,
      config_json: {
        url: 'https://api.example.com/crowdstrike/detections/queries',
        method: 'GET',
        headers: { Accept: 'application/json' },
      },
      auth_json: { authorization: 'Bearer ${TOKEN}' },
    }),
    streamSave: asJson({
      name: 'crowdstrike-detection-stream',
      enabled: false,
      polling_interval: 120,
      config_json: {
        method: 'GET',
        endpoint: '/crowdstrike/detections/entities',
        event_array_path: '$.resources',
      },
      rate_limit_json: { per_sec: 2 },
    }),
    mappingRawSample: asJson({
      resources: [
        {
          detection_id: 'cs-det-1001',
          severity: 'high',
          tactic: 'credential-access',
          technique: 'T1003',
          device_name: 'workstation-demo',
          status: 'new',
          created_timestamp: '2026-05-01T10:20:00Z',
        },
      ],
    }),
    mappingFieldSuggestions: [
      { outputField: 'detection_id', sourcePath: '$.detection_id' },
      { outputField: 'severity', sourcePath: '$.severity' },
      { outputField: 'tactic', sourcePath: '$.tactic' },
      { outputField: 'technique', sourcePath: '$.technique' },
      { outputField: 'host_name', sourcePath: '$.device_name' },
    ],
    mappingEventArrayPath: '$.resources',
    enrichmentStaticFields: asJson({
      vendor: 'crowdstrike',
      product: 'falcon_detection',
      source_type: 'edr_detection',
    }),
    routeDestinationGuidance: [
      'EDR 알림 라우트는 retry/backoff 설정을 켜고 destination TPS 한도를 낮게 시작하세요.',
      'SIEM 대상 전송 시 tactic/technique 필드를 formatter에서 보존하도록 점검하세요.',
    ],
  },
  {
    key: 'microsoft-defender-alert',
    category: 'Microsoft Security',
    name: 'Microsoft Defender Alert',
    description: 'Microsoft Defender alert starter for unified security alert ingestion.',
    operatorGuidance: {
      dataRepresents: 'Microsoft Defender alert records with service/source and severity context.',
      whenToUse: 'Use when rehearsing Microsoft security alert onboarding in UI-only mode.',
      destinationBehavior: 'Expected destination receives normalized alert payloads with cloud service metadata.',
    },
    connectorSave: asJson({
      name: 'microsoft-defender-alert-connector',
      vendor: 'microsoft_defender',
      notes: 'Template example only. Keep tenant/app values as placeholders during local testing.',
    }),
    sourceSave: asJson({
      enabled: true,
      config_json: {
        url: 'https://api.example.com/microsoft/defender/alerts',
        method: 'GET',
        headers: { Accept: 'application/json' },
      },
      auth_json: { authorization: 'Bearer ${TOKEN}' },
    }),
    streamSave: asJson({
      name: 'microsoft-defender-alert-stream',
      enabled: false,
      polling_interval: 120,
      config_json: {
        method: 'GET',
        endpoint: '/microsoft/defender/alerts',
        event_array_path: '$.value',
      },
      rate_limit_json: { per_sec: 2 },
    }),
    mappingRawSample: asJson({
      value: [
        {
          id: 'md-alert-001',
          title: 'Suspicious OAuth grant',
          severity: 'high',
          serviceSource: 'MicrosoftDefenderForCloudApps',
          category: 'InitialAccess',
          createdDateTime: '2026-05-01T10:25:00Z',
        },
      ],
    }),
    mappingFieldSuggestions: [
      { outputField: 'alert_id', sourcePath: '$.id' },
      { outputField: 'title', sourcePath: '$.title' },
      { outputField: 'severity', sourcePath: '$.severity' },
      { outputField: 'service_source', sourcePath: '$.serviceSource' },
      { outputField: 'category', sourcePath: '$.category' },
    ],
    mappingEventArrayPath: '$.value',
    enrichmentStaticFields: asJson({
      vendor: 'microsoft',
      product: 'defender',
      source_type: 'cloud_alert',
    }),
    routeDestinationGuidance: [
      '클라우드 알림은 destination별 스키마 차이가 커서 formatter_config 검증을 먼저 수행하세요.',
      '초기에는 preview/test로 payload를 확정한 뒤 운영 destination enable을 권장합니다.',
    ],
  },
  {
    key: 'generic-webhook-receiver-example',
    category: 'Generic',
    name: 'Generic Webhook Receiver Example',
    description: 'Generic webhook receiver style payload starter for producer-agnostic integrations.',
    operatorGuidance: {
      dataRepresents: 'Webhook-delivered events from generic SaaS/security producers.',
      whenToUse: 'Use when testing unknown vendor payload onboarding with minimal assumptions.',
      destinationBehavior: 'Expected destination behavior focuses on robust forwarding and schema-tolerant mapping.',
    },
    connectorSave: asJson({
      name: 'generic-webhook-receiver-connector',
      vendor: 'generic_webhook',
      notes: 'Template example only. Use placeholder endpoints and headers during local rehearsal.',
    }),
    sourceSave: asJson({
      enabled: true,
      config_json: {
        url: 'https://api.example.com/webhook/events',
        method: 'GET',
        headers: { Accept: 'application/json' },
      },
      auth_json: { authorization: 'Bearer ${TOKEN}' },
    }),
    streamSave: asJson({
      name: 'generic-webhook-receiver-stream',
      enabled: false,
      polling_interval: 60,
      config_json: {
        method: 'GET',
        endpoint: '/webhook/events',
        event_array_path: '$.events',
      },
      rate_limit_json: { per_sec: 3 },
    }),
    mappingRawSample: asJson({
      events: [
        {
          event_id: 'webhook-evt-001',
          event_type: 'security.alert.created',
          source_system: 'producer-demo',
          occurred_at: '2026-05-01T10:30:00Z',
          payload: {
            severity: 'medium',
            summary: 'Example webhook alert payload',
          },
        },
      ],
    }),
    mappingFieldSuggestions: [
      { outputField: 'event_id', sourcePath: '$.event_id' },
      { outputField: 'event_type', sourcePath: '$.event_type' },
      { outputField: 'source_system', sourcePath: '$.source_system' },
      { outputField: 'occurred_at', sourcePath: '$.occurred_at' },
      { outputField: 'severity', sourcePath: '$.payload.severity' },
    ],
    mappingEventArrayPath: '$.events',
    enrichmentStaticFields: asJson({
      vendor: 'generic',
      product: 'webhook_receiver',
      source_type: 'webhook_event',
    }),
    routeDestinationGuidance: [
      'Webhook payload는 필드 변동이 잦으므로 mapping preview를 자주 갱신해 드리프트를 점검하세요.',
      'Destination은 collector-demo 같은 검증용 대상부터 연결해 운영 전송 전 확인하세요.',
    ],
  },
  {
    key: 'generic-rest-alerts-api',
    category: 'Generic',
    name: 'Generic REST Alerts API',
    description: 'Generic REST alert endpoint starter for non-vendor-specific APIs.',
    operatorGuidance: {
      dataRepresents: 'Generic REST alert list responses from arbitrary security APIs.',
      whenToUse: 'Use when vendor-specific template does not match your upstream schema.',
      destinationBehavior: 'Expected destination receives normalized generic alert fields.',
    },
    connectorSave: asJson({
      name: 'generic-rest-alerts-connector',
      vendor: 'generic_rest',
      notes: 'Template only: replace URL/token/header values.',
    }),
    sourceSave: asJson({
      enabled: true,
      config_json: {
        url: 'https://api.example.com/alerts/v1/list',
        method: 'GET',
        headers: { Accept: 'application/json' },
      },
      auth_json: { authorization: 'Bearer ${TOKEN}' },
    }),
    streamSave: asJson({
      name: 'generic-rest-alerts-stream',
      enabled: false,
      polling_interval: 60,
      config_json: {
        method: 'GET',
        endpoint: '/api/v1/alerts',
        event_array_path: '$.alerts',
      },
      rate_limit_json: { per_sec: 2 },
    }),
    mappingRawSample: asJson({
      alerts: [
        {
          id: 'alert-1',
          severity: 'high',
          title: 'Suspicious login',
          source_ip: '198.51.100.24',
          detected_at: '2026-05-01T09:00:00Z',
        },
      ],
    }),
    mappingFieldSuggestions: [
      { outputField: 'alert_id', sourcePath: '$.id' },
      { outputField: 'severity', sourcePath: '$.severity' },
      { outputField: 'title', sourcePath: '$.title' },
      { outputField: 'source_ip', sourcePath: '$.source_ip' },
    ],
    mappingEventArrayPath: '$.alerts',
    enrichmentStaticFields: asJson({
      vendor: 'generic_rest',
      feed: 'alerts_api',
      source_type: 'rest_alert',
    }),
    routeDestinationGuidance: [
      'Preview-only 테스트로 payload shape을 먼저 검증한 뒤 Save current tab을 수행하세요.',
      'Runtime start 전 Route/Destination의 enabled/failure_policy/rate_limit을 확인하세요.',
    ],
  },
]
