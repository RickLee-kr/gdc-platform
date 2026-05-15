import { ChevronDown, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { ComponentType } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { postAuthLogout } from '../../api/gdcAdmin'
import { clearSession, readSession } from '../../auth/session'
import type { SidebarGroupItem } from '../../config/app-navigation'
import { getDatarelayInstanceLabel } from '../../config/datarelay-instance-label'

export type { AppNavKey } from '../../config/app-navigation'

type SidebarProps = {
  groups: readonly SidebarGroupItem[]
  collapsed: boolean
  pathname: string
  onToggleCollapsed: () => void
  onNavigate: (path: string) => void
}

async function performSignOut(): Promise<void> {
  try {
    await postAuthLogout({ revoke_all: false })
  } catch {
    /* logout is best-effort; client cleanup must happen regardless */
  }
  clearSession()
  try {
    window.location.assign('/')
  } catch {
    /* ignore */
  }
}

function userInitials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '—'
  const parts = trimmed.split(/[._\-\s]+/).filter(Boolean)
  if (parts.length === 0) return trimmed.slice(0, 2).toUpperCase()
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function roleLabel(role: string): string {
  if (role === 'ADMINISTRATOR') return 'Administrator'
  if (role === 'OPERATOR') return 'Operator'
  if (role === 'VIEWER') return 'Viewer'
  return role
}

function isLeafActive(pathname: string, path: string): boolean {
  const p = pathname || '/'
  if (path === '/') return p === '/' || p === ''
  if (path === '/routes') return p === '/routes'
  // `/runtime/analytics` is a separate nav leaf; do not treat it as under `/runtime` via prefix match.
  if (path === '/runtime') return p === '/runtime'
  return p === path || p.startsWith(`${path}/`)
}

export function Sidebar({ groups, collapsed, pathname, onToggleCollapsed, onNavigate }: SidebarProps) {
  return (
    <aside
      aria-label="Primary navigation"
      className={cn(
        'sticky top-0 flex h-screen shrink-0 flex-col border-r border-slate-200/90 bg-white shadow-[4px_0_24px_-8px_rgba(15,23,42,0.08)] transition-[width] duration-200 dark:border-gdc-border dark:bg-gdc-panel dark:shadow-[6px_0_32px_-10px_rgba(0,0,0,0.55)]',
        collapsed ? 'w-14' : 'w-[220px]',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 px-2 py-2',
          collapsed ? 'flex-col gap-1.5' : 'justify-between',
        )}
      >
        <Link
          to="/"
          className={cn(
            'flex min-w-0 items-center gap-2 rounded-md outline-none ring-violet-500/0 transition hover:bg-slate-100/90 focus-visible:ring-2 focus-visible:ring-violet-500/55 dark:hover:bg-gdc-rowHover dark:focus-visible:ring-violet-400/45',
            collapsed && 'flex-col items-center',
          )}
          aria-label="DataRelay — Operations Center home"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center">
            <img
              src="/logo/datarelay-logo.svg"
              alt=""
              width={28}
              height={28}
              className="h-7 w-7"
              draggable={false}
            />
          </div>
          {!collapsed ? (
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[13px] font-semibold tracking-tight">
                <span className="text-slate-900 dark:text-white">Data</span>
                <span className="text-[#00D084]">Relay</span>
              </p>
              <p className="truncate text-[11px] font-medium text-slate-500 dark:text-[#9CA3AF]">
                {getDatarelayInstanceLabel()}
              </p>
            </div>
          ) : null}
        </Link>
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-gdc-muted dark:hover:bg-gdc-rowHover"
          aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
        >
          {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
        </button>
      </div>

      <nav className="flex-1 space-y-3 overflow-y-auto px-1.5 py-2" role="navigation">
        {groups.map((group) => {
          const GroupIcon = group.icon as ComponentType<{ className?: string }>
          return (
            <div key={group.id} className="space-y-0.5">
              {!collapsed ? (
                <div className="flex items-center gap-1.5 px-2 pb-1 pt-1">
                  <GroupIcon className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-gdc-muted" aria-hidden />
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">{group.title}</p>
                </div>
              ) : (
                <div className="flex justify-center py-0.5" title={group.title}>
                  <GroupIcon className="h-3.5 w-3.5 text-slate-400 dark:text-gdc-muted" aria-hidden />
                </div>
              )}
              {group.items.map((item) => {
                const active = isLeafActive(pathname, item.path)
                return (
                  <button
                    key={`${group.id}-${item.path}`}
                    type="button"
                    onClick={() => onNavigate(item.path)}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md py-1.5 text-left text-[13px] transition-colors',
                      active
                        ? 'bg-slate-100 font-medium text-violet-800 ring-1 ring-inset ring-violet-200/60 dark:bg-violet-950/45 dark:text-gdc-foreground dark:ring-1 dark:ring-inset dark:ring-violet-500/30'
                        : 'text-slate-600 hover:bg-slate-50 dark:text-gdc-muted dark:hover:bg-gdc-rowHover',
                      collapsed ? 'justify-center px-0' : 'pl-4 pr-2',
                    )}
                  >
                    {!collapsed ? <span className="truncate">{item.label}</span> : <span className="sr-only">{item.label}</span>}
                  </button>
                )
              })}
            </div>
          )
        })}
      </nav>

      <div className={cn('mt-auto space-y-1.5 border-t border-slate-200/80 p-1.5 dark:border-gdc-border', collapsed && 'px-1')}>
        {!collapsed ? (
          <p className="px-2 pb-1 text-[10px] font-medium text-slate-400 dark:text-gdc-muted">v0.0.0</p>
        ) : null}
        {!collapsed ? (
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-200/80 bg-slate-50/80 px-2 py-1.5 text-left text-[11px] transition hover:bg-slate-100/90 dark:border-gdc-border dark:bg-gdc-section dark:hover:bg-gdc-rowHover"
          >
            <span className="min-w-0">
              <span className="block text-[9px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Environment</span>
              <span className="mt-0.5 flex items-center gap-1 font-semibold text-slate-800 dark:text-gdc-foreground">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                Production
              </span>
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-gdc-muted" aria-hidden />
          </button>
        ) : (
          <div className="flex justify-center py-0.5" title="Environment: Production">
            <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
          </div>
        )}

        {!collapsed ? (
          <SidebarUserPanel />
        ) : (
          <SidebarUserPanelCollapsed />
        )}
      </div>
    </aside>
  )
}

function SidebarUserPanel() {
  const session = readSession()
  const username = session?.user.username ?? 'Anonymous'
  const role = session?.user.role ?? 'VIEWER'
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 rounded-md border border-slate-200/80 bg-white px-2 py-1.5 dark:border-gdc-border dark:bg-gdc-section">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200/90 text-[10px] font-semibold text-slate-700 dark:bg-gdc-rowHover dark:text-gdc-foreground">
          {userInitials(username)}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[12px] font-medium text-slate-900 dark:text-gdc-foreground">{username}</p>
          <p className="truncate text-[10px] text-slate-500 dark:text-gdc-muted">{roleLabel(role)}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => void performSignOut()}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-200/80 px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:border-red-300 hover:bg-red-50 hover:text-red-700 dark:border-gdc-border dark:text-gdc-muted dark:hover:border-red-500/45 dark:hover:bg-red-500/10 dark:hover:text-red-200"
        aria-label="Sign out"
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden />
        Sign out
      </button>
    </div>
  )
}

function SidebarUserPanelCollapsed() {
  const session = readSession()
  const username = session?.user.username ?? 'Anonymous'
  const role = session?.user.role ?? 'VIEWER'
  return (
    <div className="space-y-1">
      <div className="flex justify-center py-0.5" title={`${username} (${roleLabel(role)})`}>
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200/90 text-[9px] font-semibold text-slate-700 dark:bg-gdc-rowHover dark:text-gdc-foreground">
          {userInitials(username)}
        </div>
      </div>
      <button
        type="button"
        onClick={() => void performSignOut()}
        className="flex w-full items-center justify-center rounded-md border border-slate-200/80 px-1.5 py-1 text-slate-500 transition hover:border-red-300 hover:bg-red-50 hover:text-red-700 dark:border-gdc-border dark:text-gdc-muted dark:hover:border-red-500/45 dark:hover:bg-red-500/10 dark:hover:text-red-200"
        title="Sign out"
        aria-label="Sign out"
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  )
}
