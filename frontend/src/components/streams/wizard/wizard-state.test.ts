import { describe, expect, it } from 'vitest'
import {
  buildSourceAuthPayload,
  buildInitialState,
  buildSourceConfig,
  buildStreamConfigPayload,
  buildStreamCreatePayload,
  buildRouteCreatePayloads,
  computeStepCompletion,
  enrichmentDictFromRows,
  fieldMappingsFromRows,
} from './wizard-state'

describe('wizard-state computeStepCompletion', () => {
  it('flags connector step incomplete until connector + source are selected', () => {
    const state = buildInitialState()
    const out = computeStepCompletion(state)
    expect(out.connector).toBe('in_progress')
    expect(out.stream).toBe('incomplete')
    expect(out.api_test).toBe('incomplete')
    expect(out.done).toBe('incomplete')
  })

  it('marks connector complete and stream complete with defaults', () => {
    const state = buildInitialState()
    state.connector.connectorId = 1
    state.connector.sourceId = 2
    const out = computeStepCompletion(state)
    expect(out.connector).toBe('complete')
    expect(out.stream).toBe('complete')
    expect(out.api_test).toBe('in_progress')
  })

  it('marks stream complete for S3 without HTTP endpoint', () => {
    const state = buildInitialState()
    state.connector.connectorId = 1
    state.connector.sourceId = 2
    state.connector.sourceType = 'S3_OBJECT_POLLING'
    state.stream.name = 'S3 stream'
    state.stream.endpoint = ''
    state.stream.maxObjectsPerRun = 5
    const out = computeStepCompletion(state)
    expect(out.stream).toBe('complete')
  })

  it('marks stream incomplete for REMOTE without remote directory', () => {
    const state = buildInitialState()
    state.connector.connectorId = 1
    state.connector.sourceId = 2
    state.connector.sourceType = 'REMOTE_FILE_POLLING'
    state.stream.name = 'RF'
    state.stream.remoteDirectory = ''
    expect(computeStepCompletion(state).stream).toBe('in_progress')
  })

  it('marks stream complete for REMOTE with remote directory and no HTTP endpoint', () => {
    const state = buildInitialState()
    state.connector.connectorId = 1
    state.connector.sourceId = 2
    state.connector.sourceType = 'REMOTE_FILE_POLLING'
    state.stream.name = 'RF'
    state.stream.endpoint = ''
    state.stream.remoteDirectory = '/data'
    expect(computeStepCompletion(state).stream).toBe('complete')
  })

  it('requires s3ConnectivityPassed before api_test completes for S3 connectors', () => {
    const state = buildInitialState()
    state.connector.connectorId = 1
    state.connector.sourceId = 2
    state.connector.sourceType = 'S3_OBJECT_POLLING'
    state.stream.name = 'S3 stream'
    state.stream.maxObjectsPerRun = 5
    state.apiTest.status = 'success'
    state.apiTest.s3ConnectivityPassed = false
    expect(computeStepCompletion(state).api_test).toBe('in_progress')
    state.apiTest.s3ConnectivityPassed = true
    expect(computeStepCompletion(state).api_test).toBe('complete')
  })

  it('requires remoteProbe.ok before api_test completes for REMOTE_FILE_POLLING connectors', () => {
    const state = buildInitialState()
    state.connector.connectorId = 1
    state.connector.sourceId = 2
    state.connector.sourceType = 'REMOTE_FILE_POLLING'
    state.stream.name = 'RF'
    state.stream.remoteDirectory = '/data'
    state.apiTest.status = 'success'
    state.apiTest.eventCount = 1
    state.apiTest.remoteProbe = { ok: false, auth_type: 'REMOTE_FILE_POLLING' }
    expect(computeStepCompletion(state).api_test).toBe('in_progress')
    state.apiTest.remoteProbe = { ok: true, auth_type: 'REMOTE_FILE_POLLING' }
    expect(computeStepCompletion(state).api_test).toBe('complete')
  })

  it('marks api_test complete after success and preview in_progress until events', () => {
    const state = buildInitialState()
    state.connector.connectorId = 1
    state.connector.sourceId = 2
    state.apiTest.status = 'success'
    state.apiTest.eventCount = 0
    const out = computeStepCompletion(state)
    expect(out.api_test).toBe('complete')
    expect(out.preview).toBe('in_progress')
  })

  it('blocks preview completion when analysis.previewError is set', () => {
    const state = buildInitialState()
    state.connector.connectorId = 1
    state.connector.sourceId = 2
    state.apiTest.status = 'success'
    state.apiTest.eventCount = 3
    state.stream.eventArrayPath = '$.items'
    state.apiTest.analysis = {
      responseSummary: {
        root_type: 'null',
        approx_size_bytes: 0,
        top_level_keys: [],
        item_count_root: null,
        truncation: null,
      },
      detectedArrays: [],
      detectedCheckpointCandidates: [],
      sampleEvent: null,
      selectedEventArrayDefault: null,
      flatPreviewFields: [],
      previewError: 'invalid_json_response',
    }
    expect(computeStepCompletion(state).preview).toBe('in_progress')
  })

  it('marks preview complete when user chose whole response as single event', () => {
    const state = buildInitialState()
    state.connector.connectorId = 1
    state.connector.sourceId = 2
    state.apiTest.status = 'success'
    state.apiTest.eventCount = 1
    state.stream.useWholeResponseAsEvent = true
    state.stream.eventArrayPath = ''
    expect(computeStepCompletion(state).preview).toBe('complete')
  })

  it('keeps analysis on apiTest slice for JSON preview persistence', () => {
    const state = buildInitialState()
    state.apiTest.status = 'success'
    state.apiTest.parsedJson = { a: 1 }
    state.apiTest.analysis = {
      responseSummary: {
        root_type: 'object',
        approx_size_bytes: 10,
        top_level_keys: ['a'],
        item_count_root: null,
        truncation: null,
      },
      detectedArrays: [],
      detectedCheckpointCandidates: [],
      sampleEvent: null,
      selectedEventArrayDefault: null,
      flatPreviewFields: [],
      previewError: null,
    }
    expect(state.apiTest.analysis?.responseSummary.top_level_keys).toContain('a')
  })

  it('keeps connector incomplete without catalog selection', () => {
    const state = buildInitialState()
    const out = computeStepCompletion(state)
    expect(out.connector).toBe('in_progress')
  })

  it('marks done as complete only after stream creation outcome.streamId', () => {
    const state = buildInitialState()
    state.connector.connectorId = 1
    state.connector.sourceId = 2
    state.apiTest.status = 'success'
    state.apiTest.eventCount = 1
    state.mapping = [{ id: 'm1', outputField: 'event_id', sourceJsonPath: '$.id' }]
    state.destinations.routeDrafts = [
      { key: 't1', destinationId: 1, enabled: true, failurePolicy: 'LOG_AND_CONTINUE', rateLimitJson: {} },
    ]
    state.outcome = {
      streamId: 7,
      routeId: 5,
      mappingSaved: true,
      enrichmentSaved: false,
      errors: [],
      apiBacked: true,
    }
    expect(computeStepCompletion(state).done).toBe('complete')
  })

  it('keeps done incomplete when mapping/destination are missing', () => {
    const state = buildInitialState()
    state.connector.connectorId = 1
    state.connector.sourceId = 2
    state.apiTest.status = 'success'
    state.outcome = {
      streamId: 9,
      routeId: null,
      mappingSaved: false,
      enrichmentSaved: false,
      errors: [],
      apiBacked: true,
    }
    const out = computeStepCompletion(state)
    expect(out.api_test).toBe('complete')
    expect(out.done).toBe('incomplete')
  })

  it('keeps done incomplete when outcome.streamId is null', () => {
    const state = buildInitialState()
    state.connector.connectorId = 1
    state.connector.sourceId = 2
    state.apiTest.status = 'success'
    state.mapping = [{ id: 'm1', outputField: 'event_id', sourceJsonPath: '$.id' }]
    state.destinations.routeDrafts = [
      { key: 't1', destinationId: 1, enabled: true, failurePolicy: 'LOG_AND_CONTINUE', rateLimitJson: {} },
    ]
    state.outcome = {
      streamId: null,
      routeId: 3,
      mappingSaved: true,
      enrichmentSaved: true,
      errors: [],
      apiBacked: true,
    }
    expect(computeStepCompletion(state).done).toBe('incomplete')
  })
})

describe('wizard-state buildStreamConfigPayload', () => {
  it('serializes headers/params and includes event_array_path when provided', () => {
    const state = buildInitialState()
    state.stream.headers = [
      { id: 'h1', key: 'Authorization', value: 'Bearer X' },
      { id: 'h2', key: '', value: 'ignored' },
    ]
    state.stream.params = [{ id: 'p1', key: 'limit', value: '50' }]
    state.stream.eventArrayPath = '$.items'
    state.stream.eventRootPath = '$.payload'
    const payload = buildStreamConfigPayload(state) as Record<string, unknown>
    expect(payload.headers).toEqual({ Authorization: 'Bearer X' })
    expect(payload.params).toEqual({ limit: '50' })
    expect(payload.method).toBe('GET')
    expect(payload.event_array_path).toBe('$.items')
    expect(payload.event_root_path).toBe('$.payload')
  })

  it('omits event_array_path when useWholeResponseAsEvent is true', () => {
    const state = buildInitialState()
    state.stream.eventArrayPath = '$.items'
    state.stream.useWholeResponseAsEvent = true
    const payload = buildStreamConfigPayload(state) as Record<string, unknown>
    expect(payload).not.toHaveProperty('event_array_path')
  })
})

describe('wizard-state buildStreamCreatePayload', () => {
  it('returns null when connector or source is missing', () => {
    const state = buildInitialState()
    expect(buildStreamCreatePayload(state)).toBeNull()
  })

  it('returns REMOTE_FILE_POLLING stream_type and remote stream_config when connector is REMOTE_FILE_POLLING', () => {
    const state = buildInitialState()
    state.connector.connectorId = 11
    state.connector.sourceId = 22
    state.connector.sourceType = 'REMOTE_FILE_POLLING'
    state.stream.name = 'RF stream'
    state.stream.remoteDirectory = '/data/logs'
    state.stream.filePattern = '*.ndjson'
    state.stream.parserType = 'NDJSON'
    state.stream.maxFilesPerRun = 3
    state.stream.maxFileSizeMb = 2
    const payload = buildStreamCreatePayload(state)
    expect(payload?.stream_type).toBe('REMOTE_FILE_POLLING')
    expect(payload?.config_json).toMatchObject({
      remote_directory: '/data/logs',
      file_pattern: '*.ndjson',
      parser_type: 'NDJSON',
      max_files_per_run: 3,
      max_file_size_mb: 2,
    })
  })
})

describe('wizard-state buildSourceConfig', () => {
  it('captures base_url and timeout_seconds', () => {
    const state = buildInitialState()
    state.connector.hostBaseUrl = '  https://api.foo.com  '
    state.stream.timeoutSec = 45
    expect(buildSourceConfig(state)).toMatchObject({ base_url: 'https://api.foo.com', timeout_seconds: 45 })
  })

  it('starts with no default query parameter rows', () => {
    const state = buildInitialState()
    expect(state.stream.params).toEqual([])
  })

  it('starts with empty additional stream headers (connector may supply Accept / Content-Type)', () => {
    const state = buildInitialState()
    expect(state.stream.headers.length).toBe(0)
  })

  it('keeps connector config separated from stream request payload', () => {
    const state = buildInitialState()
    state.connector.hostBaseUrl = 'https://api.example.com'
    state.connector.authType = 'BEARER'
    state.connector.bearerToken = 'secret-token'
    const sourceConfig = buildSourceConfig(state) as Record<string, unknown>
    const sourceAuth = buildSourceAuthPayload(state) as Record<string, unknown>
    const streamConfig = buildStreamConfigPayload(state) as Record<string, unknown>
    expect(sourceConfig.base_url).toBeTruthy()
    expect(sourceConfig).not.toHaveProperty('endpoint')
    expect(streamConfig.endpoint).toBeTruthy()
    expect(streamConfig).not.toHaveProperty('base_url')
    expect(sourceAuth.auth_type).toBe('BEARER')
  })
})

describe('wizard-state mapping/enrichment helpers', () => {
  it('skips empty mapping rows', () => {
    expect(
      fieldMappingsFromRows([
        { id: '1', outputField: 'event_id', sourceJsonPath: '$.id' },
        { id: '2', outputField: '', sourceJsonPath: '$.skipped' },
        { id: '3', outputField: 'severity', sourceJsonPath: '   ' },
      ]),
    ).toEqual({ event_id: '$.id' })
  })

  it('skips empty enrichment rows', () => {
    expect(
      enrichmentDictFromRows([
        { id: '1', fieldName: 'tenant', value: 'acme' },
        { id: '2', fieldName: '   ', value: 'ignored' },
      ]),
    ).toEqual({ tenant: 'acme' })
  })
})

describe('wizard-state buildRouteCreatePayloads', () => {
  it('builds one route payload per route draft', () => {
    const state = buildInitialState()
    state.destinations.routeDrafts = [
      { key: 'a', destinationId: 11, enabled: true, failurePolicy: 'RETRY_AND_BACKOFF', rateLimitJson: {} },
      { key: 'b', destinationId: 22, enabled: true, failurePolicy: 'RETRY_AND_BACKOFF', rateLimitJson: {} },
    ]
    state.destinations.destinationKindsById = { 11: 'SYSLOG_UDP', 22: 'WEBHOOK_POST' }
    const out = buildRouteCreatePayloads(7, state.destinations)
    expect(out).toEqual([
      {
        stream_id: 7,
        destination_id: 11,
        enabled: true,
        failure_policy: 'RETRY_AND_BACKOFF',
        formatter_config_json: {
          message_prefix_enabled: true,
          message_prefix_template: '<134> gdc generic-connector event:',
        },
        status: 'ENABLED',
        rate_limit_json: {},
      },
      {
        stream_id: 7,
        destination_id: 22,
        enabled: true,
        failure_policy: 'RETRY_AND_BACKOFF',
        formatter_config_json: {
          message_prefix_enabled: false,
          message_prefix_template: '<134> gdc generic-connector event:',
        },
        status: 'ENABLED',
        rate_limit_json: {},
      },
    ])
  })
})
