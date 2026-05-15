import { describe, expect, it } from 'vitest'
import { formatCheckpointValueForConsole } from './streamRows'

describe('formatCheckpointValueForConsole', () => {
  it('formats remote file checkpoint fields readably', () => {
    const v = {
      last_processed_file: '/data/a.ndjson',
      last_processed_mtime: '2024-01-01T00:00:00Z',
      last_processed_size: 42,
      last_processed_offset: 10,
      last_processed_hash: 'abc',
      last_success_event: { gdc_remote_path: '/data/a.ndjson' },
    }
    const out = formatCheckpointValueForConsole(v)
    expect(out).toContain('last_processed_file: /data/a.ndjson')
    expect(out).toContain('last_processed_mtime:')
    expect(out).toContain('last_processed_size: 42')
    expect(out).toContain('last_processed_offset: 10')
    expect(out).toContain('last_processed_hash: abc')
  })

  it('keeps S3-style checkpoints as compact JSON', () => {
    const v = {
      last_processed_key: 's3://bucket/obj.json',
      last_processed_last_modified: '2024-01-01T00:00:00Z',
      last_processed_etag: '"etag"',
      last_success_event: { s3_key: 'obj.json' },
    }
    const out = formatCheckpointValueForConsole(v)
    expect(out).toContain('last_processed_key:')
    expect(out).toContain('last_processed_last_modified:')
    expect(out).toContain('last_processed_etag:')
  })
})
