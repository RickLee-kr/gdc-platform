import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '../../lib/utils'

const TABS: readonly { to: string; end?: boolean; label: string }[] = [
  { to: '/validation', end: true, label: 'Overview' },
  { to: '/validation/alerts', label: 'Alerts' },
  { to: '/validation/runs', label: 'Runs' },
  { to: '/validation/failing', label: 'Failing' },
  { to: '/validation/auth', label: 'Auth' },
  { to: '/validation/delivery', label: 'Delivery' },
  { to: '/validation/checkpoints', label: 'Checkpoints' },
] as const

export function ValidationShell() {
  return (
    <section className="space-y-4 px-4 py-5 lg:px-8" aria-label="Runtime health checks workspace">
      <header className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
          Runtime verification
        </p>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-50">Runtime health checks</h2>
        <p className="max-w-3xl text-sm text-slate-600 dark:text-gdc-mutedStrong">
          Automated checks on live configuration. Use this area for advanced troubleshooting; day-to-day posture lives on
          the Operations Center.
        </p>
      </header>
      <nav className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-2 dark:border-gdc-border" aria-label="Health check views">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
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
    </section>
  )
}
