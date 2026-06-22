import { describe, expect, it } from 'vitest'
import {
  applyMappingWithPassThrough,
  mergeUnknownFieldPassThrough,
} from './mappingPassThrough'

describe('mappingPassThrough', () => {
  it('passes through unmapped top-level fields', () => {
    const event = { user: 'aaa', email: 'aaa@test.com', phone: '010' }
    const rows = [
      { id: '1', outputField: 'user', sourceJsonPath: '$.user' },
      { id: '2', outputField: 'email', sourceJsonPath: '$.email' },
    ]
    const out = applyMappingWithPassThrough(event, rows, (ev, path) => {
      const key = path.replace('$.', '')
      return (ev as Record<string, unknown>)[key]
    })
    expect(out).toEqual({ user: 'aaa', email: 'aaa@test.com', phone: '010' })
  })

  it('passes through nested sibling fields', () => {
    const event = { user: { name: 'aaa', department: 'sales' } }
    const out = mergeUnknownFieldPassThrough(event, { user_name: 'aaa' }, ['$.user.name'])
    expect(out).toEqual({ user_name: 'aaa', user: { department: 'sales' } })
  })

  it('passes through array element siblings', () => {
    const event = { items: [{ id: 1, tag: 'a' }, { id: 2, tag: 'b' }] }
    const out = mergeUnknownFieldPassThrough(event, { first_tag: 'a' }, ['$.items[0].tag'])
    expect(out).toEqual({ first_tag: 'a', items: [{ id: 1 }, { id: 2, tag: 'b' }] })
  })

  it('returns a deep copy of the entire event when mapping rows are empty', () => {
    const event = { a: 1, nested: { b: 2 }, items: [{ id: 1 }] }
    const out = applyMappingWithPassThrough(event, [], () => undefined)
    expect(out).toEqual(event)
    expect(out).not.toBe(event)
    expect(out.nested).not.toBe(event.nested)
    expect(out.items).not.toBe(event.items)
  })

  it('drops unmapped source fields when policy is drop_unmapped', () => {
    const event = { id: '1', user: { name: 'alice' }, message: 'hi' }
    const rows = [
      { id: '1', outputField: 'event_id', sourceJsonPath: '$.id' },
      { id: '2', outputField: 'message', sourceJsonPath: '$.message' },
    ]
    const out = applyMappingWithPassThrough(
      event,
      rows,
      (ev, path) => {
        if (path === '$.id') return ev.id
        if (path === '$.message') return ev.message
        return undefined
      },
      'drop_unmapped',
    )
    expect(out).toEqual({ event_id: '1', message: 'hi' })
  })
})
