import { describe, expect, it } from 'vitest'
import {
  detectEventRootCandidates,
  toEventRootRelativePath,
  wizardExtractEvents,
} from './wizard-json-extract'

describe('wizardExtractEvents', () => {
  it('extracts $.items array', () => {
    const raw = { items: [{ id: '1' }, { id: '2' }] }
    const ev = wizardExtractEvents(raw, '$.items')
    expect(ev).toHaveLength(2)
    expect(ev[0].id).toBe('1')
  })

  it('extracts $.data.events', () => {
    const raw = { data: { events: [{ id: 'a' }] } }
    expect(wizardExtractEvents(raw, '$.data.events')).toHaveLength(1)
  })

  it('extracts $.malops', () => {
    const raw = { malops: [{ guid: 'g' }] }
    expect(wizardExtractEvents(raw, '$.malops')).toHaveLength(1)
  })

  it('uses entire object when path empty', () => {
    const raw = { hello: 'world' }
    const ev = wizardExtractEvents(raw, '')
    expect(ev).toHaveLength(1)
    expect(ev[0].hello).toBe('world')
  })

  it('uses list items when path empty and root is array', () => {
    const raw = [{ id: 1 }, { id: 2 }]
    const ev = wizardExtractEvents(raw, '')
    expect(ev).toHaveLength(2)
  })

  it('supports use-whole-response semantics with empty path on object root', () => {
    const raw = { nested: { x: 1 } }
    const ev = wizardExtractEvents(raw, '')
    expect(ev).toHaveLength(1)
    expect((ev[0] as { nested: { x: number } }).nested.x).toBe(1)
  })

  it('extracts nested event root when event_root_path is set', () => {
    const raw = { hits: { hits: [{ _source: { srcip: '1.1.1.1', dstip: '2.2.2.2' } }] } }
    const ev = wizardExtractEvents(raw, '$.hits.hits', '$._source')
    expect(ev).toHaveLength(1)
    expect(ev[0]).toEqual({ srcip: '1.1.1.1', dstip: '2.2.2.2' })
  })

  it('returns empty when event_root_path does not match', () => {
    const raw = { hits: { hits: [{ _source: { srcip: '1.1.1.1' } }] } }
    const ev = wizardExtractEvents(raw, '$.hits.hits', '$.payload')
    expect(ev).toHaveLength(0)
  })
})

describe('event root helpers', () => {
  it('normalizes item path to per-item event_root_path', () => {
    expect(toEventRootRelativePath('$.hits.hits[0]._source', '$.hits.hits')).toBe('$._source')
  })

  it('detects object-like event root candidates', () => {
    const candidates = detectEventRootCandidates({
      _index: 'x',
      _source: { a: 1 },
      payload: { b: 2 },
    })
    expect(candidates).toContain('$._source')
    expect(candidates).toContain('$.payload')
  })
})
