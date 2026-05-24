import { describe, expect, it } from 'vitest'
import {
  CHECKPOINT_TEMPLATE_VARIABLES,
  INCREMENTAL_FETCH_CHECKPOINT_HELPER,
  INCREMENTAL_FETCH_TEMPLATES,
} from './incremental-fetch-templates'

describe('incremental-fetch-templates', () => {
  it('lists all six incremental fetch categories', () => {
    expect(INCREMENTAL_FETCH_TEMPLATES.map((t) => t.label)).toEqual([
      'No checkpoint / full fetch',
      'Timestamp JSON body filter',
      'Time range body',
      'Cursor / next page token',
      'Event ID greater-than',
      'Elasticsearch / Stellar _search',
    ])
  })

  it('uses explicit checkpoint and runtime variables only', () => {
    const joined = INCREMENTAL_FETCH_TEMPLATES.map((t) => t.body).join('\n')
    expect(joined).toContain('{{checkpoint.last_timestamp}}')
    expect(joined).toContain('{{checkpoint.last_timestamp_ms}}')
    expect(joined).toContain('{{checkpoint.last_event_id}}')
    expect(joined).toContain('{{checkpoint.next_cursor}}')
    expect(joined).toContain('{{runtime.now_ms}}')
    expect(joined).not.toMatch(/\{\{checkpoint\}\}/)
    expect(joined).not.toContain('{{start_ms}}')
    expect(joined).not.toContain('{{end_ms}}')
  })

  it('includes required warning copy per template type', () => {
    const full = INCREMENTAL_FETCH_TEMPLATES.find((t) => t.id === 'full_fetch')
    expect(full?.warning).toContain('does not use checkpoint variables')

    const timestamp = INCREMENTAL_FETCH_TEMPLATES.find((t) => t.id === 'timestamp_filter')
    expect(timestamp?.warning).toContain('Requires API-side filtering and ascending sort')

    const cursor = INCREMENTAL_FETCH_TEMPLATES.find((t) => t.id === 'cursor')
    expect(cursor?.warning).toContain('next_cursor extraction')

    const search = INCREMENTAL_FETCH_TEMPLATES.find((t) => t.id === 'elasticsearch_search')
    expect(search?.warning).toContain('timestamp + _id')
  })

  it('documents checkpoint helper text for the request body editor', () => {
    expect(INCREMENTAL_FETCH_CHECKPOINT_HELPER).toContain('only injected where you place them')
    expect(CHECKPOINT_TEMPLATE_VARIABLES).toContain('{{checkpoint.last_timestamp}}')
    expect(CHECKPOINT_TEMPLATE_VARIABLES).toContain('{{runtime.now_iso}}')
  })
})
