export type RealPathTraceEvidence = {
  mutation_id: string
  target_file: string
  target_symbol: string
  process: string
  target_scenario: string
  symbol_entered: boolean
  invocation_count: number
  correlation_id?: string
  stream_id?: string | number
  route_id?: string | number
  destination_id?: string | number
  assertion_failure: string[]
  unrelated_failure_count: number
  path_class: 'REAL_PRODUCT_PATH' | 'REAL_HARNESS_PATH'
}

export type MutationKillOutcome =
  | 'KILLED_REAL_PATH'
  | 'SURVIVED'
  | 'TARGET_NOT_EXECUTED'
  | 'INVALID_MUTATION'
  | 'ENVIRONMENT_FAILURE'
  | 'MASS_FAILURE'
  | 'RESTORE_FAILED'
