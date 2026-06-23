import { describe, expect, it } from 'vitest'
import { resolveStreamEndpointPath } from './streamHttpConfigFromStreamRead'

describe('resolveStreamEndpointPath', () => {
  it('reads endpoint from stream config_json', () => {
    expect(resolveStreamEndpointPath({ endpoint: '/connect/api/dataexport/anomalies/malop/_search' })).toBe(
      '/connect/api/dataexport/anomalies/malop/_search',
    )
  })

  it('falls back to source_config endpoint_path when stream config is empty', () => {
    expect(
      resolveStreamEndpointPath({}, { endpoint_path: '/connect/api/dataexport/anomalies/malop/_search' }),
    ).toBe('/connect/api/dataexport/anomalies/malop/_search')
  })
})
