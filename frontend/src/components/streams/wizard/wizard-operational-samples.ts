import type { WizardCheckpointFieldType, WizardHttpApiAnalysis } from './wizard-state'
import { detectEventRootCandidates, wizardExtractEvents } from './wizard-json-extract'
import { normalizeEventArrayPath } from '../../../utils/eventExtractionPaths'

export type OperationalSampleId =
  | 'aws_cloudtrail'
  | 'microsoft_365_audit'
  | 'edr_detections'
  | 'firewall_events'
  | 'webhook_nested'

export type OperationalSampleDef = {
  id: OperationalSampleId
  label: string
  vendor: string
  description: string
  defaultEventArrayPath: string
  defaultEventRootPath: string
  payload: Record<string, unknown>
}

function cloudTrailRecord(i: number): Record<string, unknown> {
  const regions = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1']
  const actions = ['ConsoleLogin', 'PutObject', 'DeleteBucket', 'AssumeRole', 'RunInstances']
  return {
    eventVersion: '1.11',
    userIdentity: {
      type: 'IAMUser',
      principalId: `AIDAI${String(i).padStart(8, '0')}`,
      arn: `arn:aws:iam::123456789012:user/operator-${i}`,
      accountId: '123456789012',
      userName: `operator-${i % 5}`,
    },
    eventTime: `2024-01-${String(10 + (i % 18)).padStart(2, '0')}T14:${String(i % 60).padStart(2, '0')}:32Z`,
    eventSource: 'ec2.amazonaws.com',
    eventName: actions[i % actions.length],
    awsRegion: regions[i % regions.length],
    sourceIPAddress: `203.0.113.${(i % 200) + 10}`,
    userAgent: 'console.amazonaws.com',
    requestParameters: { instanceType: 't3.medium', monitoring: { enabled: i % 2 === 0 } },
    responseElements: null,
    requestID: `a1b2c3d4-${i}-5678-90ab-cdef-EXAMPLE${String(i).padStart(8, '0')}`,
    eventID: `evt-${i}-${Date.now()}`,
    readOnly: i % 3 === 0,
    eventType: 'AwsApiCall',
    managementEvent: true,
    recipientAccountId: '123456789012',
    eventCategory: 'Management',
    tlsDetails: { tlsVersion: 'TLSv1.3', cipherSuite: 'TLS_AES_128_GCM_SHA256' },
    sessionCredentialFromConsole: 'true',
    additionalEventData: { MFAUsed: i % 4 === 0 ? 'Yes' : 'No', MobileVersion: 'No' },
    vpcEndpointId: i % 2 === 0 ? `vpce-0${i}` : null,
    errorCode: i % 17 === 0 ? 'AccessDenied' : null,
    errorMessage: i % 17 === 0 ? 'User is not authorized' : null,
    resources: [{ type: 'AWS::EC2::Instance', ARN: `arn:aws:ec2:us-east-1:123456789012:instance/i-${i}` }],
    sharedEventID: i % 5 === 0 ? `shared-${i}` : undefined,
  }
}

function buildCloudTrailPayload(recordCount: number): Record<string, unknown> {
  const Records = Array.from({ length: recordCount }, (_, i) => ({
    metadata: { ingestionTime: `2024-01-15T14:${String(i % 60).padStart(2, '0')}:00Z`, schemaVersion: 2 },
    event: cloudTrailRecord(i),
    entities: [{ type: 'user', id: `user-${i}` }],
  }))
  return {
    ResponseMetadata: {
      RequestId: 'a1b2c3d4-5678-90ab-cdef-EXAMPLE11111',
      HTTPStatusCode: 200,
      HTTPHeaders: { 'x-amzn-requestid': 'a1b2c3d4-5678-90ab-cdef-EXAMPLE11111' },
      RetryAttempts: 0,
    },
    Records,
    NextToken: 'eyJOZXh0VG9rZW4iOiAiYWJjMTIzZGVmNDU2IiwgInBhZ2luYXRpb24iOiB7InBhZ2UiOjJ9fQ==',
  }
}

function m365AuditRecord(i: number): Record<string, unknown> {
  return {
    id: `audit-${i}`,
    creationTime: `2024-02-${String(1 + (i % 27)).padStart(2, '0')}T09:15:${String(i % 60).padStart(2, '0')}Z`,
    operation: ['FileDownloaded', 'MailItemsAccessed', 'UserLoggedIn', 'Add member to group.'][i % 4],
    organizationId: 'contoso.onmicrosoft.com',
    userType: 0,
    userId: `user${i % 12}@contoso.com`,
    clientIP: `198.51.100.${(i % 200) + 1}`,
    workload: 'Exchange',
    objectId: `file-${i}`,
    auditData: {
      AppAccessContext: { AADSessionId: `sess-${i}` },
      IsManagedDevice: i % 2 === 0,
      FileSizeBytes: 1024 * (i + 1),
      SiteUrl: `https://contoso.sharepoint.com/sites/ops-${i % 3}`,
    },
    optionalField: i % 7 === 0 ? null : `value-${i}`,
  }
}

function edrDetection(i: number): Record<string, unknown> {
  return {
    detection_id: `det-${1000 + i}`,
    severity: ['low', 'medium', 'high', 'critical'][i % 4],
    timestamp: `2024-03-10T18:${String(i % 60).padStart(2, '0')}:00Z`,
    host: { hostname: `ws-${i % 40}.corp.local`, os: 'Windows 11', agent_version: '7.2.1' },
    threat: {
      name: 'Suspicious PowerShell',
      tactic: 'Execution',
      technique: 'T1059.001',
      confidence: 0.72 + (i % 10) * 0.02,
    },
    process: {
      pid: 4000 + i,
      name: 'powershell.exe',
      command_line: `powershell.exe -enc Q21kLSR7aX0=`,
      parent_name: 'explorer.exe',
    },
    network: i % 3 === 0 ? { dst_ip: '203.0.113.55', dst_port: 443, protocol: 'tcp' } : null,
    mitre: ['TA0002', 'TA0005'],
    next_cursor: i === 49 ? 'eyJwYWdlIjoyfQ==' : undefined,
  }
}

function firewallEvent(i: number): Record<string, unknown> {
  return {
    log_id: i,
    receive_time: `2024-04-01T12:${String(i % 60).padStart(2, '0')}:05Z`,
    serial: 'PA-VM-001',
    type: 'TRAFFIC',
    subtype: 'end',
    action: ['allow', 'deny', 'drop'][i % 3],
    src: { ip: `10.0.${i % 16}.${(i % 200) + 1}`, port: 52000 + (i % 1000), zone: 'trust' },
    dst: { ip: `198.51.100.${(i % 200) + 1}`, port: [80, 443, 53, 22][i % 4], zone: 'untrust' },
    app: ['ssl', 'web-browsing', 'dns', 'ssh'][i % 4],
    bytes: { sent: 1200 + i, received: 4800 + i * 2 },
    sessionid: 900000 + i,
    rule: `allow-corporate-${i % 8}`,
    threat: i % 11 === 0 ? { id: 'spyware', name: 'Generic Spyware' } : null,
  }
}

function webhookNestedPayload(): Record<string, unknown> {
  const events = Array.from({ length: 25 }, (_, i) => ({
    id: `wh-${i}`,
    type: 'security.alert',
    created_at: `2024-05-20T16:${String(i % 60).padStart(2, '0')}:00Z`,
    payload: {
      alert: {
        title: `Alert ${i}`,
        severity: i % 5,
        indicators: Array.from({ length: 3 }, (_, j) => ({ type: 'ip', value: `10.1.${i}.${j}` })),
      },
      tenant: { id: `tenant-${i % 4}`, name: `Customer ${i % 4}` },
    },
    cursor: i === 24 ? 'page-2-token-abc' : undefined,
  }))
  return {
    webhook: { delivery_id: 'del-001', signature: 'sha256=abc' },
    data: { events, pagination: { next: 'page-2-token-abc', total: 250 } },
  }
}

export const OPERATIONAL_SAMPLES: OperationalSampleDef[] = [
  {
    id: 'aws_cloudtrail',
    label: 'AWS CloudTrail',
    vendor: 'Amazon Web Services',
    description: 'Nested Records[] with per-record event object and pagination token.',
    defaultEventArrayPath: '$.Records',
    defaultEventRootPath: '$.event',
    payload: buildCloudTrailPayload(10),
  },
  {
    id: 'microsoft_365_audit',
    label: 'Microsoft 365 Audit',
    vendor: 'Microsoft',
    description: 'Audit log value array with timestamps, workloads, and optional null fields.',
    defaultEventArrayPath: '$.value',
    defaultEventRootPath: '',
    payload: {
      '@odata.context': 'https://graph.microsoft.com/v1.0/$metadata#auditLogs',
      value: Array.from({ length: 15 }, (_, i) => m365AuditRecord(i)),
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/auditLogs/directoryAudits?$skiptoken=abc',
    },
  },
  {
    id: 'edr_detections',
    label: 'EDR / XDR Detections',
    vendor: 'Endpoint Security',
    description: 'Detections array with deep process/network objects and cursor pagination.',
    defaultEventArrayPath: '$.detections',
    defaultEventRootPath: '',
    payload: {
      vendor: 'Example EDR',
      detections: Array.from({ length: 50 }, (_, i) => edrDetection(i)),
      meta: { query_ms: 42, page: 1 },
    },
  },
  {
    id: 'firewall_events',
    label: 'Firewall Events',
    vendor: 'Network Security',
    description: 'High-volume traffic logs with nested src/dst and intermittent threat objects.',
    defaultEventArrayPath: '$.logs',
    defaultEventRootPath: '',
    payload: {
      device: { name: 'PA-FW-DC1', version: '11.1.0' },
      logs: Array.from({ length: 40 }, (_, i) => firewallEvent(i)),
    },
  },
  {
    id: 'webhook_nested',
    label: 'Webhook Nested Payload',
    vendor: 'Generic Webhook',
    description: 'Deeply nested webhook envelope with data.events[] and pagination cursor.',
    defaultEventArrayPath: '$.data.events',
    defaultEventRootPath: '$.payload',
    payload: webhookNestedPayload(),
  },
]

export function getOperationalSample(id: OperationalSampleId): OperationalSampleDef {
  const found = OPERATIONAL_SAMPLES.find((s) => s.id === id)
  if (!found) throw new Error(`Unknown operational sample: ${id}`)
  return found
}

export function buildAnalysisForSample(
  sample: OperationalSampleDef,
  eventArrayPath: string,
  eventRootPath: string,
): WizardHttpApiAnalysis {
  const confirmedEap = eventArrayPath.trim() ? normalizeEventArrayPath(eventArrayPath) : ''
  const suggestedEap = normalizeEventArrayPath(sample.defaultEventArrayPath)
  const previewEap = confirmedEap || suggestedEap
  const erp = eventRootPath.trim() || (confirmedEap ? sample.defaultEventRootPath : '')
  const events = wizardExtractEvents(sample.payload, previewEap, erp)
  const resolved = wizardExtractEvents(sample.payload, previewEap, '')
  const firstRecord = resolved[0] ?? null

  const detectedArrays: WizardHttpApiAnalysis['detectedArrays'] = []
  function scanArrays(value: unknown, base: string, depth: number) {
    if (depth > 8 || detectedArrays.length >= 12) return
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
      detectedArrays.push({
        path: base,
        count: value.length,
        confidence: base === suggestedEap ? 0.98 : 0.75,
        reason: base === suggestedEap ? 'Suggested record path' : 'Array of objects',
        sample_item_preview: value[0],
      })
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const child = base === '$' ? `$.${k}` : `${base}.${k}`
        scanArrays(v, child, depth + 1)
      }
    }
  }
  scanArrays(sample.payload, '$', 0)

  const checkpointCandidates: WizardHttpApiAnalysis['detectedCheckpointCandidates'] = []
  const pushCandidate = (
    path: string,
    checkpoint_type: WizardCheckpointFieldType,
    sample_value: unknown,
    reason: string,
  ) => {
    checkpointCandidates.push({ path, checkpoint_type, confidence: 0.9, sample_value, reason })
  }

  if (sample.id === 'aws_cloudtrail') {
    pushCandidate('event.eventTime', 'TIMESTAMP', events[0]?.eventTime ?? null, 'CloudTrail event time')
    pushCandidate('event.eventID', 'EVENT_ID', events[0]?.eventID ?? null, 'Unique event identifier')
  }
  if (sample.id === 'microsoft_365_audit') {
    pushCandidate('creationTime', 'TIMESTAMP', events[0]?.creationTime ?? null, 'Audit record timestamp')
    pushCandidate('id', 'EVENT_ID', events[0]?.id ?? null, 'Audit record id')
  }
  if (sample.id === 'edr_detections') {
    pushCandidate('timestamp', 'TIMESTAMP', events[0]?.timestamp ?? null, 'Detection time')
    pushCandidate('next_cursor', 'CURSOR', 'eyJwYWdlIjoyfQ==', 'Pagination cursor on last item')
  }
  if (sample.id === 'webhook_nested') {
    pushCandidate('created_at', 'TIMESTAMP', events[0]?.created_at ?? null, 'Webhook event time')
    pushCandidate('cursor', 'CURSOR', 'page-2-token-abc', 'Per-event cursor token')
  }
  pushCandidate('NextToken', 'CURSOR', (sample.payload as { NextToken?: string }).NextToken ?? null, 'Top-level pagination token')

  return {
    responseSummary: {
      root_type: 'object',
      approx_size_bytes: JSON.stringify(sample.payload).length,
      top_level_keys: Object.keys(sample.payload),
      item_count_root: null,
      truncation: null,
    },
    detectedArrays,
    detectedCheckpointCandidates: checkpointCandidates,
    sampleEvent: (events[0] ?? null) as Record<string, unknown> | null,
    selectedEventArrayDefault: suggestedEap,
    flatPreviewFields: firstRecord ? Object.keys(firstRecord).map((k) => `$.${k}`) : [],
    eventRootCandidates: detectEventRootCandidates(firstRecord),
    previewError: null,
  }
}
