import { describe, expect, it } from 'vitest'
import {
  buildOperationalStreamBadges,
  classifyStreamDataset,
  GDC_BUNDLED_DEMO_STREAM_NAME,
  operationalRunControlTooltipSupplement,
} from './streamOperationalBadges'
import { DEV_E2E_VISIBLE_NAME_PREFIX, DEV_VALIDATION_NAME_PREFIX } from './devValidationLab'

describe('classifyStreamDataset', () => {
  it('classifies bundled demo seed', () => {
    expect(classifyStreamDataset(GDC_BUNDLED_DEMO_STREAM_NAME)).toBe('bundled_demo_seed')
  })

  it('classifies dev validation lab prefix', () => {
    expect(classifyStreamDataset(`${DEV_VALIDATION_NAME_PREFIX}HTTP Stream`)).toBe('dev_validation_fixture')
  })

  it('classifies visible E2E prefix', () => {
    expect(classifyStreamDataset(`${DEV_E2E_VISIBLE_NAME_PREFIX}Fixture`)).toBe('dev_validation_fixture')
  })

  it('classifies operator streams', () => {
    expect(classifyStreamDataset('prod-http-alerts')).toBe('operator_defined')
  })
})

describe('buildOperationalStreamBadges', () => {
  it('returns primary HTTP runtime + demo seed', () => {
    const b = buildOperationalStreamBadges(GDC_BUNDLED_DEMO_STREAM_NAME, 'HTTP_API_POLLING')
    expect(b.map((x) => x.key)).toEqual(['dataset-demo', 'runtime-primary'])
  })

  it('returns extended runtime for S3', () => {
    const b = buildOperationalStreamBadges('Prod S3', 'S3_OBJECT_POLLING')
    expect(b.map((x) => x.key)).toEqual(['runtime-extended'])
  })

  it('includes lab badge for validation prefix', () => {
    const b = buildOperationalStreamBadges(`${DEV_VALIDATION_NAME_PREFIX}X`, 'DATABASE_QUERY')
    expect(b.map((x) => x.key)).toEqual(['dataset-lab', 'runtime-extended'])
  })
})

describe('operationalRunControlTooltipSupplement', () => {
  it('returns supplement for demo seed', () => {
    expect(operationalRunControlTooltipSupplement(GDC_BUNDLED_DEMO_STREAM_NAME)).toContain('Demo seed')
  })

  it('returns null for normal streams', () => {
    expect(operationalRunControlTooltipSupplement('ingest-prod')).toBeNull()
  })

  it('returns supplement for dev validation lab streams', () => {
    expect(operationalRunControlTooltipSupplement(`${DEV_VALIDATION_NAME_PREFIX}Stream OAuth2`)).toContain('OAuth2 client-credentials')
  })
})
