/** Phase 4 Release Gate types */

export type ReleaseGateStatus = 'PASS' | 'FAIL' | 'STALE' | 'INCOMPLETE'

export type ReleaseGateIssue = {
  code: string
  severity: 'error' | 'warning'
  detail: string
  scenario_ids?: string[]
  artifact_path?: string
}

export type RunMetadata = {
  git_commit: string
  git_branch?: string
  workflow_run_id?: string
  generated_at: string
  manifest_hash: string
  scenario_hash: string
  route_flag?: string
  execution_mode?: string
  shard?: string
  run_id: string
  smoke_pass?: boolean
  coverage_validation_pass?: boolean
  execution_validation_pass?: boolean
  consecutive_pass_index?: number
  rc_attempt?: number
}

export type MatrixCounts = {
  total: number
  executed: number
  missing: number
  pass: number
  fail: number
  blocked: number
  gap: number
  not_implemented: number
  not_applicable: number
  browser_executed: number
  browser_generated: number
  route_off_executed: number
  route_on_executed: number
}

export type ReleaseGateEvaluation = {
  status: ReleaseGateStatus
  run_id: string
  commit: string
  expected_commit?: string
  result_age_hours: number | null
  generated_at?: string
  counts: MatrixCounts
  flaky_count: number
  smoke_pass: boolean
  coverage_validation_pass: boolean
  execution_validation_pass: boolean
  not_implemented_ok: boolean
  baseline_ok: boolean
  evidence_ok: boolean
  issues: ReleaseGateIssue[]
  warnings: ReleaseGateIssue[]
  failed_scenarios: string[]
  artifact_paths: string[]
  weekly_fault_status?: 'PASS' | 'FAIL' | 'MISSING' | 'STALE'
  evaluated_at: string
}

export type CapabilityBaseline = {
  commit: string
  generated_at: string
  capability_count: number
  supported_count: number
  partial_count: number
  ui_only_count: number
  runtime_only_count: number
  by_status: Record<string, number>
  capability_ids: string[]
  supported_ids: string[]
}

export type ScenarioBaseline = {
  commit: string
  generated_at: string
  scenario_count: number
  browser_count: number
  api_seeded_count: number
  route_off_count: number
  route_on_count: number
  by_suite: Record<string, number>
  by_expected_status: Record<string, number>
  scenario_ids: string[]
  browser_ids: string[]
}

export type ResultBaseline = {
  commit: string
  generated_at: string
  run_id: string
  scenario_count: number
  browser_count: number
  route_off_count: number
  route_on_count: number
  pass: number
  fail: number
  blocked: number
  gap: number
  not_implemented: number
  missing: number
  suites: Record<string, number>
}

export type NotImplementedBaseline = {
  commit: string
  generated_at: string
  count: number
  scenario_ids: string[]
  capability_ids: string[]
  require_manifest_status: Array<'PARTIAL' | 'UI_ONLY' | 'RUNTIME_ONLY'>
}

export type BaselineComparison = {
  ok: boolean
  status: ReleaseGateStatus
  issues: ReleaseGateIssue[]
  warnings: ReleaseGateIssue[]
  deltas: Record<string, { baseline: number; current: number; delta: number }>
}

export type AffectedShardsResult = {
  shards: string[]
  route_modes: Array<'off' | 'on'>
  include_smoke: boolean
  include_fault: boolean
  reason: Record<string, string[]>
  fallback_wide: boolean
}

export type FlakeScenarioRecord = {
  scenario_id: string
  attempt_count: number
  first_result: string
  final_result: string
  retry_reason?: string
  historical_failures: number
  is_flaky: boolean
}

export type FlakeReport = {
  run_id: string
  generated_at: string
  flaky_count: number
  flaky_threshold: number
  exceeds_threshold: boolean
  scenarios: FlakeScenarioRecord[]
}

export type ArtifactChecksumManifest = {
  run_id: string
  shard?: string
  route_flag?: string
  generated_at: string
  files: Array<{ path: string; sha256: string; bytes: number }>
}

export type RcGateEvaluation = {
  status: ReleaseGateStatus
  commit: string
  attempts: Array<{
    run_id: string
    status: ReleaseGateStatus
    generated_at?: string
  }>
  consecutive_required: number
  consecutive_pass: number
  issues: ReleaseGateIssue[]
  evaluated_at: string
}

export type ReleaseGateConfig = {
  required: {
    smoke: boolean
    capability_validation: boolean
    scenario_validation: boolean
    execution_validation: boolean
  }
  full_matrix: {
    expected_scenarios: number
    fail_allowed: number
    blocked_allowed: number
    gap_allowed: number
    missing_allowed: number
  }
  browser: {
    expected_scenarios: number
    missing_allowed: number
  }
  route_processing: {
    require_off: boolean
    require_on: boolean
  }
  not_implemented: {
    expected: number
    require_manifest_evidence: boolean
    fail_on_increase: boolean
  }
  release_candidate: {
    consecutive_passes: number
    max_result_age_hours: number
  }
  release: {
    max_result_age_hours: number
    require_same_commit: boolean
  }
  flake: {
    window: number
    min_retry_pass_events: number
    max_flaky_scenarios: number
    fail_gate_on_exceed: boolean
  }
  shards: string[]
}
