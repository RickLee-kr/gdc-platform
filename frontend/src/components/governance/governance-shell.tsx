import { NavLink, Outlet } from 'react-router-dom'
import { NAV_PATH } from '../../config/nav-paths'
import { isOssReleaseMode } from '../../lib/feature-flags'
import {
  canViewAudit,
  canViewGovernance,
  canViewGovernanceOperations,
  canViewGovernanceWorkspace,
  governanceReadOnlyReason,
} from '../../lib/governance-rbac'
import { cn } from '../../lib/utils'
import { PersonaReadOnlyBanner } from './persona-read-only-banner'

const TABS: readonly { to: string; end?: boolean; label: string; testId: string; visible?: () => boolean }[] = [
  { to: NAV_PATH.governance, end: true, label: 'Dashboard', testId: 'governance-nav-dashboard' },
  { to: NAV_PATH.governanceOperations, label: 'Operations', testId: 'governance-nav-operations', visible: canViewGovernanceOperations },
  { to: NAV_PATH.governanceDataProtection, label: 'Data Protection', testId: 'governance-nav-data-protection', visible: canViewGovernanceWorkspace },
  { to: NAV_PATH.governanceViolations, label: 'Violations', testId: 'governance-nav-violations', visible: canViewGovernanceWorkspace },
  { to: NAV_PATH.governanceQuarantine, label: 'Quarantine', testId: 'governance-nav-quarantine', visible: canViewGovernanceWorkspace },
  { to: NAV_PATH.governanceAudit, label: 'Audit', testId: 'governance-nav-audit', visible: canViewAudit },
  { to: NAV_PATH.governanceReplay, label: 'Replay', testId: 'governance-nav-replay', visible: canViewGovernanceWorkspace },
  { to: NAV_PATH.governanceApprovals, label: 'Approvals', testId: 'governance-nav-approvals', visible: canViewGovernanceWorkspace },
  { to: NAV_PATH.governanceNotifications, label: 'Notifications', testId: 'governance-nav-notifications', visible: canViewGovernanceWorkspace },
] as const

export function GovernanceShell() {
  if (!canViewGovernance()) {
    const reason = governanceReadOnlyReason() ?? 'Governance access requires an authorized role.'
    return (
      <section
        className="rounded-xl border border-amber-300/70 bg-amber-500/[0.06] p-6 text-sm text-amber-950 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-100"
        data-testid="governance-unauthorized"
        role="alert"
      >
        <h2 className="text-base font-semibold">Governance access unavailable</h2>
        <p className="mt-2">{reason}</p>
      </section>
    )
  }

  const visibleTabs = TABS.filter((t) => {
    if (isOssReleaseMode()) {
      if (t.to === NAV_PATH.governanceDataProtection) return false
    }
    return t.visible ? t.visible() : true
  })

  return (
    <div className="w-full min-w-0 space-y-4" data-testid="governance-shell">
      <PersonaReadOnlyBanner />
      <nav
        className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-2 dark:border-gdc-border"
        aria-label="Governance sections"
      >
        {visibleTabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            data-testid={t.testId}
            className={({ isActive }) =>
              cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                isActive
                  ? 'bg-violet-600 text-white shadow-sm dark:bg-violet-500'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-gdc-mutedStrong dark:hover:bg-gdc-rowHover',
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  )
}
