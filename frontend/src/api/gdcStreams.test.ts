import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchStreamsList, fetchStreamsListResult } from './gdcStreams'

describe('fetchStreamsList', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('treats empty array as success with zero rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })),
    )

    const result = await fetchStreamsListResult()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual([])
    }
    expect(await fetchStreamsList()).toEqual([])
  })
})
