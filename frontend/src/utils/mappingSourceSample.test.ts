import { describe, expect, it } from 'vitest'
import { resolveSourceTypePresentation } from './sourceTypePresentation'

describe('source-type-aware mapping copy', () => {
  it('uses distinct API test labels per source type', () => {
    const http = resolveSourceTypePresentation('HTTP_API_POLLING')
    const db = resolveSourceTypePresentation('DATABASE_QUERY')
    const s3 = resolveSourceTypePresentation('S3_OBJECT_POLLING')
    const remote = resolveSourceTypePresentation('REMOTE_FILE_POLLING')
    const wh = resolveSourceTypePresentation('WEBHOOK_RECEIVER')

    expect(http.workflow.apiTestShortLabel).toBe('API Test')
    expect(db.workflow.apiTestShortLabel).toBe('Query test')
    expect(s3.workflow.apiTestShortLabel).toBe('Object preview')
    expect(remote.workflow.apiTestShortLabel).toBe('Remote probe')
    expect(wh.workflow.apiTestShortLabel).toBe('Payload preview')
  })

  it('normalizes webhook alias types', () => {
    expect(resolveSourceTypePresentation('WEBHOOK').key).toBe('WEBHOOK_RECEIVER')
  })
})
