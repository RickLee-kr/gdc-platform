import { describe, expect, it } from 'vitest'
import {
  isBackendDeliveryLogStageToken,
  SCHEMA_DRIFT_POLICY_LOG_DRILLDOWN_STAGES,
  deliveryLogStageDisplayLabel,
} from './delivery-log-stages'

describe('schema drift policy delivery log stages', () => {
  it('registers schema drift policy stages for URL filters', () => {
    expect(isBackendDeliveryLogStageToken(SCHEMA_DRIFT_POLICY_LOG_DRILLDOWN_STAGES.autoProtectApplied)).toBe(true)
    expect(isBackendDeliveryLogStageToken(SCHEMA_DRIFT_POLICY_LOG_DRILLDOWN_STAGES.reviewRequired)).toBe(true)
    expect(isBackendDeliveryLogStageToken(SCHEMA_DRIFT_POLICY_LOG_DRILLDOWN_STAGES.pathResolutionFailed)).toBe(true)
    expect(isBackendDeliveryLogStageToken(SCHEMA_DRIFT_POLICY_LOG_DRILLDOWN_STAGES.policy)).toBe(true)
  })

  it('provides operator-friendly stage labels', () => {
    expect(deliveryLogStageDisplayLabel(SCHEMA_DRIFT_POLICY_LOG_DRILLDOWN_STAGES.autoProtectApplied)).toBe(
      'Auto Protect Applied',
    )
    expect(deliveryLogStageDisplayLabel(SCHEMA_DRIFT_POLICY_LOG_DRILLDOWN_STAGES.pathResolutionFailed)).toBe(
      'Path Resolution Failed',
    )
  })
})
