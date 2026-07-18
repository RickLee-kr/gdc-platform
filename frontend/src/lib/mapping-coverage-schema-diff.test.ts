import { describe, expect, it } from 'vitest'
import { computeMappingCoverage, computeSchemaDiff } from './mapping-coverage-schema-diff'

describe('mapping-coverage-schema-diff', () => {
  const sample = { src_ip: '1.1.1.1', msg: 'ok', unused: 1 }
  const mapping = [
    { sourceJsonPath: '$.src_ip', outputField: 'source.ip' },
    { sourceJsonPath: '$.msg', outputField: 'message' },
  ]

  it('computes coverage percent from sample top-level fields', () => {
    const stats = computeMappingCoverage({ sample, mappingRows: mapping })
    expect(stats.sampleFieldCount).toBe(3)
    expect(stats.mappedSourceCount).toBe(2)
    expect(stats.unmappedSourceCount).toBe(1)
    expect(stats.coveragePct).toBeCloseTo(66.7, 1)
  })

  it('builds schema diff rows for mapped, unmapped, and added paths', () => {
    const mappedOutput = { 'source.ip': '1.1.1.1', message: 'ok', enrich_flag: true }
    const diff = computeSchemaDiff({ sample, mappedOutput, mappingRows: mapping })
    expect(diff.find((r) => r.path === 'src_ip')?.kind).toBe('mapped')
    expect(diff.find((r) => r.path === 'unused')?.kind).toBe('unmapped')
    expect(diff.find((r) => r.path === 'enrich_flag')?.kind).toBe('added')
  })
})
