import type { PolicyStatus } from '../../api/gdcGovernancePolicies'

export function policyStatusLabel(status: PolicyStatus | string): string {
  switch (status) {
    case 'DRAFT':
      return 'Draft'
    case 'REVIEW':
      return 'Review'
    case 'ACTIVE':
      return 'Active'
    case 'RETIRED':
      return 'Retired'
    default:
      return status
  }
}

export function policyStatusBadgeClass(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200'
    case 'REVIEW':
      return 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200'
    case 'RETIRED':
      return 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300'
    default:
      return 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200'
  }
}

export type PolicyLifecycleAction = 'submit-review' | 'activate' | 'retire'

export function policyLifecycleAction(status: PolicyStatus | string): PolicyLifecycleAction | null {
  switch (status) {
    case 'DRAFT':
      return 'submit-review'
    case 'REVIEW':
      return 'activate'
    case 'ACTIVE':
      return 'retire'
    default:
      return null
  }
}

export function policyLifecycleActionLabel(action: PolicyLifecycleAction): string {
  switch (action) {
    case 'submit-review':
      return 'Submit for Review'
    case 'activate':
      return 'Activate'
    case 'retire':
      return 'Retire'
  }
}

export function policyCanDelete(status: PolicyStatus | string): boolean {
  return status === 'RETIRED'
}

export function policyCanEdit(status: PolicyStatus | string): boolean {
  return status === 'DRAFT' || status === 'REVIEW'
}
