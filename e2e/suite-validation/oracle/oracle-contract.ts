/** Contract types for the independent reference oracle. */

export type OracleTransformConfig = {
  field_mapping?: { from: string; to: string } | null
  jsonata?: { expr: string; output: string } | null
  regex?: { field: string; pattern: string; replace: string } | null
  timestamp?: { field: string; mode: 'utc' | 'offset' | 'invalid_check' } | null
}

export type OracleGovernance = {
  schema_fields: string[]
  schema_drift: 'allow' | 'warn' | 'block'
  unknown_field: 'pass_through' | 'drop' | 'block'
  confidential_detection: boolean
  sensitive_fields?: string[]
  protection?: 'none' | 'mask_partial' | 'mask_full' | 'tokenize' | 'hash' | 'remove' | 'quarantine' | 'block'
}

export type OracleRoute = {
  route_key: string
  destination_type: string
  transform_override?: OracleTransformConfig | null
  protection_override?: OracleGovernance['protection']
  policy?: 'continue' | 'block'
}

export type OracleExpectation = {
  auth_ok: boolean
  delivery_statuses: string[]
  collector_count: number
  expected_no_delivery: boolean
  payloads_by_route: Record<string, Record<string, unknown>[]>
  checkpoint_advanced?: boolean
  duplicate_skipped?: number
  verification_fields: string[]
}
