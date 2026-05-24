import { describe, expect, it } from 'vitest'
import {
  buildApiTestParams,
  buildPersistParams,
  DEPRECATED_CHECKPOINT_PLACEHOLDER,
  paginationQueryCheckpointVariable,
  PAGINATION_CURSOR_PARAM_PLACEHOLDER,
  PAGINATION_QUERY_CHECKPOINT_HELPER,
} from './stream-edit-request-params'

describe('stream-edit-request-params', () => {
  it('buildApiTestParams uses explicit next_cursor for cursor pagination', () => {
    expect(buildApiTestParams({ paginationType: 'Cursor based', cursorParam: 'cursor' })).toEqual({
      cursor: '{{checkpoint.next_cursor}}',
    })
  })

  it('buildApiTestParams returns empty params when pagination is None', () => {
    expect(buildApiTestParams({ paginationType: 'None', cursorParam: 'cursor' })).toEqual({})
  })

  it('buildApiTestParams does not use deprecated standalone checkpoint placeholder', () => {
    const params = buildApiTestParams({ paginationType: 'Page based', cursorParam: 'page_token' })
    expect(Object.values(params).join(' ')).not.toContain(DEPRECATED_CHECKPOINT_PLACEHOLDER)
    expect(params).toEqual({ page_token: '{{checkpoint.next_cursor}}' })
  })

  it('buildPersistParams aligns with buildApiTestParams explicit variables', () => {
    expect(buildPersistParams({ paginationType: 'Offset based', cursorParam: 'offset' })).toEqual({
      offset: '{{checkpoint.next_cursor}}',
    })
  })

  it('documents helper text and placeholder with explicit variables', () => {
    expect(PAGINATION_QUERY_CHECKPOINT_HELPER).toContain('explicit checkpoint variables')
    expect(PAGINATION_QUERY_CHECKPOINT_HELPER).toContain('deprecated')
    expect(PAGINATION_CURSOR_PARAM_PLACEHOLDER).toContain('{{checkpoint.next_cursor}}')
    expect(paginationQueryCheckpointVariable('Cursor based')).toBe('{{checkpoint.next_cursor}}')
  })
})
