import { describe, expect, it } from 'vitest'
import { analyzeIncrementalFetchCompatibility } from './incremental-fetch-compatibility'

describe('analyzeIncrementalFetchCompatibility', () => {
  it('detects full fetch risk when body has no checkpoint variable', () => {
    const result = analyzeIncrementalFetchCompatibility({
      requestBodyText: '{"limit":1000}',
    })
    expect(result.hints).toContain('CHECKPOINT_VARIABLE_MISSING')
    expect(result.hints).toContain('FULL_FETCH_RISK')
    expect(result.messages.join(' ')).toContain('No checkpoint variable found')
  })

  it('detects deprecated standalone {{checkpoint}}', () => {
    const result = analyzeIncrementalFetchCompatibility({
      requestBodyText: '{"cursor":"{{checkpoint}}"}',
    })
    expect(result.hints).toContain('DEPRECATED_CHECKPOINT_VARIABLE')
    expect(result.messages.join(' ')).toContain('Deprecated checkpoint variable found')
  })

  it('detects timestamp incremental with sort warning when sort is missing', () => {
    const result = analyzeIncrementalFetchCompatibility({
      requestBodyText: JSON.stringify({
        filters: [
          {
            fieldName: 'creationTime',
            operator: 'GreaterThan',
            values: ['{{checkpoint.last_timestamp}}'],
          },
        ],
      }),
    })
    expect(result.hints).toContain('TIMESTAMP_INCREMENTAL_LIKELY')
    expect(result.hints).toContain('SORT_REQUIRED')
    expect(result.messages.join(' ')).toContain('ascending sort')
  })

  it('does not require sort warning when ascending sort is present', () => {
    const result = analyzeIncrementalFetchCompatibility({
      requestBodyText: JSON.stringify({
        filters: [
          {
            fieldName: 'creationTime',
            operator: 'GreaterThan',
            values: ['{{checkpoint.last_timestamp}}'],
          },
        ],
        sort: [{ fieldName: 'creationTime', order: 'ASC' }],
      }),
    })
    expect(result.hints).toContain('TIMESTAMP_INCREMENTAL_LIKELY')
    expect(result.hints).not.toContain('SORT_REQUIRED')
  })

  it('detects cursor incremental from body and query params', () => {
    const body = analyzeIncrementalFetchCompatibility({
      requestBodyText: '{"cursor":"{{checkpoint.next_cursor}}","limit":1000}',
    })
    expect(body.hints).toContain('CURSOR_INCREMENTAL_LIKELY')
    expect(body.messages.join(' ')).toContain('next cursor extraction')

    const query = analyzeIncrementalFetchCompatibility({
      queryParams: { cursor: '{{checkpoint.next_cursor}}' },
    })
    expect(query.hints).toContain('CURSOR_INCREMENTAL_LIKELY')
  })

  it('detects event ID incremental configuration', () => {
    const result = analyzeIncrementalFetchCompatibility({
      requestBodyText: JSON.stringify({
        filter: { id_gt: '{{checkpoint.last_event_id}}' },
        sort: [{ fieldName: 'id', order: 'ASC' }],
      }),
    })
    expect(result.hints).toContain('EVENT_ID_INCREMENTAL_LIKELY')
    expect(result.messages.join(' ')).toContain('stable ascending ID order')
  })

  it('skips checkpoint-missing hint when platform checkpoint is configured', () => {
    const result = analyzeIncrementalFetchCompatibility({
      requestBodyText: '{"limit":1000}',
      platformCheckpointConfigured: true,
    })
    expect(result.hints).not.toContain('CHECKPOINT_VARIABLE_MISSING')
    expect(result.messages.join(' ')).not.toContain('No checkpoint variable found')
  })
})
