import { describe, expect, it } from 'vitest'
import { hasStreamCheckpointConfigured } from './stream-checkpoint-config'

describe('hasStreamCheckpointConfigured', () => {
  it('detects explicit checkpoint variables in request body', () => {
    expect(
      hasStreamCheckpointConfigured({
        requestBodyText: '{"filters":[{"values":["{{checkpoint.last_timestamp}}"]}]}',
      }),
    ).toBe(true)
  })

  it('detects runtime CUSTOM_FIELD checkpoint without request-body variables', () => {
    expect(
      hasStreamCheckpointConfigured({
        runtimeCheckpointType: 'CUSTOM_FIELD',
      }),
    ).toBe(true)
  })

  it('returns false when no checkpoint is configured', () => {
    expect(hasStreamCheckpointConfigured({ requestBodyText: '{}' })).toBe(false)
  })
})
