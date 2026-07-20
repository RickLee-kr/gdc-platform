/** Shared types for E2E Suite Trust Validation gates. */

export type GateStatus =
  | 'PASS'
  | 'FAIL'
  | 'INCOMPLETE'
  | 'DIRTY_WORKTREE'
  | 'ORACLE_NOT_INDEPENDENT'
  | 'MUTATION_SURVIVED'
  | 'FALSE_PASS_DETECTED'

export type FinalVerdict =
  | 'E2E_SUITE_TRUSTED'
  | 'E2E_SUITE_UNTRUSTED'
  | 'E2E_SUITE_INCOMPLETE'
  | 'BLOCKED'

export type ResumeReadiness = 'READY_FOR_FULL_RESUME' | 'HOLD'

export type ScenarioStatus = 'PASS' | 'FAIL' | 'ERROR' | 'SKIP'

export type MutationOutcome =
  | 'KILLED'
  | 'SURVIVED'
  | 'INVALID_MUTATION'
  | 'TIMEOUT'
  | 'ENVIRONMENT_FAILURE'

export type GoldenScenario = {
  golden_id: string
  purpose: string
  category: string
  source_type: string
  source_auth: string
  input_fixture: string
  stream_config: Record<string, unknown>
  global_transform: Record<string, unknown>
  route_transform: Record<string, unknown>
  governance_policy: Record<string, unknown>
  destination_type: string
  route_mode: 'route-on' | 'route-off'
  expected_runtime_config: string
  expected_delivery_log: string
  expected_collector_payload: string
  expected_no_delivery: boolean
  verification_fields: string[]
  capability_ids: string[]
  rationale: string
  manual_review_status: 'reviewed' | 'draft'
  routes?: RouteSpec[]
}

export type RouteSpec = {
  route_key: string
  destination_type?: string
  transform_override?: Record<string, unknown>
  protection_override?: string
  policy?: 'continue' | 'block'
}

export type GoldenCatalog = {
  version: string
  ownership: string
  scenarios: GoldenScenario[]
}

export type NegativeControl = {
  control_id: string
  description: string
  defect_kind: string
  target_golden_id: string
  inject: Record<string, unknown>
  expected_failing_assertions: string[]
  must_not_fail_unrelated: boolean
}

export type MutationEntry = {
  mutation_id: string
  target_file: string
  target_symbol: string
  mutation_description: string
  expected_killing_scenarios: string[]
  criticality: 'critical' | 'non_critical'
  apply_method: string
  restore_method: string
  timeout_sec: number
  expected_assertion: string
  patch_id?: string
  category: 'product' | 'generator'
}

export type ScenarioRunResult = {
  id: string
  status: ScenarioStatus
  failed_assertions: string[]
  details?: string
}

export type MutationRunResult = {
  mutation_id: string
  outcome: MutationOutcome
  killed_by: string[]
  failed_assertions: string[]
  unrelated_failures: string[]
  restore_clean: boolean
  duration_ms: number
  notes?: string
}
