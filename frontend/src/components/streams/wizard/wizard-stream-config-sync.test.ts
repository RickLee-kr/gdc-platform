import { describe, expect, it } from 'vitest'
import {
  buildAdvancedStreamConfigJsonPatch,
  checkpointSourcePathFromPersistedCursor,
  readAdvancedStreamConfigFromPersisted,
} from './wizard-stream-config-sync'

describe('wizard-stream-config-sync', () => {
  it('hydrates checkpoint and schema paths from persisted config and mapping', () => {
    const hydrated = readAdvancedStreamConfigFromPersisted(
      {
        checkpoint: {
          mode: 'Timestamp',
          cursor_path: '$.data.results[*].creationTime',
          secondary_cursor_path: '$.data.results[*].id',
          cursor_paths: ['$.data.results[*].creationTime', '$.data.results[*].id'],
        },
        schema: { root_path: '$.metadata' },
        runtime_ui: { record_selection_mode: 'advanced' },
        initial_delay_sec: 5,
        pagination: { type: 'none' },
      },
      {
        event_array_path: '$.data.results',
        event_root_path: '$.EventDetailsKey',
      },
    )

    expect(hydrated.eventArrayPath).toBe('data.results')
    expect(hydrated.eventRootPath).toBe('EventDetailsKey')
    expect(hydrated.checkpointMode).toBe('Timestamp')
    expect(hydrated.recordSelectionMode).toBe('advanced')
    expect(hydrated.checkpointSourcePath).toBe('$.creationTime')
    expect(hydrated.checkpointSecondaryPath).toBe('$.id')
    expect(hydrated.schemaRootPath).toBe('$.metadata')
    expect(hydrated.initialDelaySec).toBe(5)
  })

  it('persists wizard checkpoint paths back to config_json.checkpoint', () => {
    const patch = buildAdvancedStreamConfigJsonPatch({
      checkpointMode: 'Cursor',
      checkpointSourcePath: '$.creationTime',
      checkpointSecondaryPath: '',
      checkpointFieldType: 'TIMESTAMP',
      eventArrayPath: 'data.results',
      recordSelectionMode: 'advanced',
      schemaRootPath: '',
      initialDelaySec: 0,
      paginationType: 'None',
      paginationCursorParam: '',
      paginationPageSize: 0,
      paginationMaxPages: 0,
    })

    expect(patch.checkpoint).toMatchObject({
      mode: 'Cursor',
      cursor_path: '$.data.results[*].creationTime',
    })
    expect(patch.runtime_ui).toMatchObject({ record_selection_mode: 'advanced' })
  })

  it('converts persisted absolute cursor paths to wizard-relative paths', () => {
    expect(
      checkpointSourcePathFromPersistedCursor('$.data.results[*].EventDetailsKey.id', 'data.results'),
    ).toBe('$.EventDetailsKey.id')
  })
})
