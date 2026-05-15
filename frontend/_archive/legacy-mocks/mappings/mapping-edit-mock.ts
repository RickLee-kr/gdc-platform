import { MOCK_MAPPING_ROWS } from './mappings-mock-data'

export type MappingFieldType = 'string' | 'number' | 'datetime'

export type MappingEditRow = {
  id: string
  sourceJsonPath: string
  outputField: string
  type: MappingFieldType
  required: boolean
  defaultValue: string
  source: 'auto' | 'manual' | 'custom'
}

const SOURCE_PAYLOAD: Record<string, unknown> = {
  malops: {
    data: [
      {
        id: '12345',
        name: 'Malop detected',
        severity: 'high',
        status: 'ACTIVE',
        first_detected: '2026-05-08T11:20:38Z',
        last_detected: '2026-05-08T11:30:22Z',
        confidence: 92,
        machine: { name: 'WIN-8392', os: 'Windows 11', ip_address: '10.1.2.54' },
        user: { name: 'jdoe', domain: 'corp' },
        file: { path: 'C:\\Windows\\System32\\malware.exe', hash: 'f2f3f8' },
        process: { name: 'malware.exe', pid: 3188 },
      },
    ],
  },
}

const BASE_ROWS: readonly MappingEditRow[] = [
  { id: 'r1', sourceJsonPath: '$.malops.data[0].id', outputField: 'event_id', type: 'string', required: true, defaultValue: '', source: 'auto' },
  { id: 'r2', sourceJsonPath: '$.malops.data[0].name', outputField: 'event_name', type: 'string', required: true, defaultValue: '', source: 'auto' },
  { id: 'r3', sourceJsonPath: '$.malops.data[0].severity', outputField: 'severity', type: 'string', required: true, defaultValue: '', source: 'auto' },
  { id: 'r4', sourceJsonPath: '$.malops.data[0].status', outputField: 'status', type: 'string', required: false, defaultValue: 'unknown', source: 'manual' },
  { id: 'r5', sourceJsonPath: '$.malops.data[0].machine.name', outputField: 'host_name', type: 'string', required: true, defaultValue: '', source: 'auto' },
  { id: 'r6', sourceJsonPath: '$.malops.data[0].machine.ip_address', outputField: 'host_ip', type: 'string', required: false, defaultValue: '', source: 'manual' },
  { id: 'r7', sourceJsonPath: '$.malops.data[0].user.name', outputField: 'user_name', type: 'string', required: false, defaultValue: '', source: 'manual' },
  { id: 'r8', sourceJsonPath: '$.malops.data[0].first_detected', outputField: 'event_time', type: 'datetime', required: true, defaultValue: '', source: 'auto' },
  { id: 'r9', sourceJsonPath: '$.malops.data[0].file.path', outputField: 'file_path', type: 'string', required: false, defaultValue: '', source: 'manual' },
  { id: 'r10', sourceJsonPath: '$.malops.data[0].process.name', outputField: 'process_name', type: 'string', required: false, defaultValue: '', source: 'auto' },
]

export type MappingEditMock = {
  mappingId: string
  mappingName: string
  connector: string
  stream: string
  sourceType: string
  status: 'ACTIVE' | 'INACTIVE'
  targetSchema: string
  updatedAt: string
  updatedBy: string
  sourceDocument: Record<string, unknown>
  initialRows: MappingEditRow[]
}

export function getMappingEditMock(mappingId: string): MappingEditMock {
  const row = MOCK_MAPPING_ROWS.find((v) => v.id === mappingId)
  return {
    mappingId: row?.id ?? mappingId,
    mappingName: row?.name ?? 'Mapping',
    connector: row?.connectorName ?? 'Cybereason EDR Platform',
    stream: row?.streamLabel ?? 'Malop API Stream',
    sourceType: 'HTTP API Polling',
    status: row?.enableStatus === 'DISABLED' ? 'INACTIVE' : 'ACTIVE',
    targetSchema: 'GDC Common Schema',
    updatedAt: '2026-05-08 11:30:22',
    updatedBy: 'operator',
    sourceDocument: SOURCE_PAYLOAD,
    initialRows: BASE_ROWS.map((v) => ({ ...v })),
  }
}
