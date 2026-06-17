import { describe, expect, it, vi } from 'vitest'
import { buildUnionSchema } from '../../../utils/unionSchema'
import {
  buildUnionSchemaPersistPayload,
  persistWizardUnionSchema,
} from './wizard-union-schema-persist'

vi.mock('../../../api/gdcStreams', () => ({
  updateStream: vi.fn(),
  fetchStreamById: vi.fn(),
}))

import { fetchStreamById, updateStream } from '../../../api/gdcStreams'

describe('wizard union schema persist', () => {
  it('buildUnionSchemaPersistPayload returns null when schema is empty', () => {
    expect(buildUnionSchemaPersistPayload(null)).toBeNull()
    expect(buildUnionSchemaPersistPayload({ total_events: 0, fields: [] })).toBeNull()
  })

  it('buildUnionSchemaPersistPayload serializes wizard union schema', () => {
    const schema = buildUnionSchema([{ id: '1', email: 'a@test.com' }, { id: '2' }])
    const payload = buildUnionSchemaPersistPayload(schema)
    expect(payload).not.toBeNull()
    expect(payload?.total_events).toBe(2)
    expect(payload?.fields.length).toBeGreaterThan(0)
    expect(typeof payload?.snapshot_at).toBe('string')
  })

  it('persistWizardUnionSchema PUTs config_json.union_schema with merge', async () => {
    vi.mocked(updateStream).mockResolvedValueOnce({ id: 42, config_json: {} } as never)

    const schema = buildUnionSchema([{ id: '1' }, { id: '2' }])
    const result = await persistWizardUnionSchema(42, schema, {
      existingConfigJson: { endpoint: '/events' },
    })

    expect(result.saved).toBe(true)
    expect(updateStream).toHaveBeenCalledWith(42, {
      config_json: expect.objectContaining({
        endpoint: '/events',
        union_schema: expect.objectContaining({
          total_events: 2,
          fields: expect.any(Array),
          snapshot_at: expect.any(String),
        }),
      }),
    })
  })

  it('persistWizardUnionSchema fetches existing config when not provided', async () => {
    vi.mocked(fetchStreamById).mockResolvedValueOnce({
      id: 7,
      config_json: { method: 'GET' },
    } as never)
    vi.mocked(updateStream).mockResolvedValueOnce({ id: 7, config_json: {} } as never)

    const schema = buildUnionSchema([{ id: '1' }])
    await persistWizardUnionSchema(7, schema)

    expect(fetchStreamById).toHaveBeenCalledWith(7)
    expect(updateStream).toHaveBeenCalledWith(7, {
      config_json: expect.objectContaining({
        method: 'GET',
        union_schema: expect.objectContaining({ total_events: 1 }),
      }),
    })
  })

  it('persistWizardUnionSchema returns errors on API failure', async () => {
    vi.mocked(updateStream).mockRejectedValueOnce(new Error('network down'))
    const schema = buildUnionSchema([{ id: '1' }])
    const result = await persistWizardUnionSchema(1, schema, { existingConfigJson: {} })
    expect(result.saved).toBe(false)
    expect(result.errors[0]).toContain('network down')
  })
})
