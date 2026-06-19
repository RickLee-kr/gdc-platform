import { ChevronDown, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { ComponentType } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { postAuthLogout } from '../../api/gdcAdmin'
import { clearSession, readSession } from '../../auth/session'
import type { SidebarNavEntry, SidebarNavKey, SidebarTopItem } from '../../config/app-navigation'
import { getDatarelayInstanceLabel } from '../../config/datarelay-instance-label'
import type { PlatformPersona } from '../../utils/persona-mode'
import { PersonaSwitcher } from './persona-switcher'
import { isInternalOperatorUiEnabled } from '../../lib/feature-flags'

export type { AppNavKey } from '../../config/app-navigation'

type SidebarProps = {
  structure: readonly SidebarNavEntry[]
  collapsed: boolean
  pathname: string
  persona: PlatformPersona
  onPersonaChange: (persona: PlatformPersona) => void
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
    window.location.assign('/streams')
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

function isDashboardPath(pathname: string): boolean {
  const p = pathname || '/'
  return (
    p === '/' ||
    p === '/monitoring' ||
    p.startsWith('/monitoring/') ||
    p === '/runtime' ||
    p.startsWith('/runtime/')
  )
}

function isAdministrationPath(pathname: string): boolean {
  const p = pathname || '/'
  return (
    p === '/admin' ||
    p.startsWith('/admin/') ||
    p.startsWith('/settings') ||
    p.startsWith('/operations/backup') ||
    p.startsWith('/validation')
  )
}

function isNavKeyActive(pathname: string, key: SidebarNavKey): boolean {
  const p = pathname || '/'
  switch (key) {
    case 'dashboard':
      return isDashboardPath(p)
    case 'connectors':
      return p.startsWith('/connectors')
    case 'streams':
      return p.startsWith('/streams') || p.startsWith('/templates')
    case 'destinations':
      return p.startsWith('/destinations')
    case 'routes':
      return p.startsWith('/routes')
    case 'governance':
      return p === '/governance' || (p.startsWith('/governance/') && !p.startsWith('/governance/workspace'))
    case 'governanceWorkspace':
      return p.startsWith('/governance/workspace')
    case 'administration':
      return isAdministrationPath(p)
    default:
      return false
  }
}

function isGroupActive(pathname: string, items: readonly SidebarTopItem[]): boolean {
  return items.some((item) => isNavKeyActive(pathname, item.key))
}

function NavButton({
  item,
  collapsed,
  pathname,
  onNavigate,
  nested = false,
}: {
  item: SidebarTopItem
  collapsed: boolean
  pathname: string
  onNavigate: (path: string) => void
  nested?: boolean
}) {
  const ItemIcon = item.icon as ComponentType<{ className?: string }>
  const active = isNavKeyActive(pathname, item.key)
  return (
    <button
      type="button"
      onClick={() => onNavigate(item.path)}
      title={collapsed ? item.label : undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-md py-2 text-left text-[13px] transition-colors',
        active
          ? 'bg-slate-100 font-medium text-violet-800 ring-1 ring-inset ring-violet-200/60 dark:bg-violet-950/45 dark:text-gdc-foreground dark:ring-1 dark:ring-inset dark:ring-violet-500/30'
          : 'text-slate-600 hover:bg-slate-50 dark:text-gdc-muted dark:hover:bg-gdc-rowHover',
        collapsed ? 'justify-center px-0' : nested ? 'pl-7 pr-2' : 'pl-2.5 pr-2',
      )}
    >
      {!nested || collapsed ? (
        <ItemIcon
          className={cn('h-4 w-4 shrink-0', active ? 'text-violet-700 dark:text-violet-300' : 'text-slate-400 dark:text-gdc-muted')}
          aria-hidden
        />
      ) : (
        <span className="h-4 w-4 shrink-0" aria-hidden />
      )}
      {!collapsed ? <span className="truncate">{item.label}</span> : <span className="sr-only">{item.label}</span>}
    </button>
  )
}

export function Sidebar({
  structure,
  collapsed,
  pathname,
  persona,
  onPersonaChange,
  onToggleCollapsed,
  onNavigate,
}: SidebarProps) {
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
          to="/monitoring"
          className={cn(
            'flex min-w-0 items-center gap-2 rounded-md outline-none ring-violet-500/0 transition hover:bg-slate-100/90 focus-visible:ring-2 focus-visible:ring-violet-500/55 dark:hover:bg-gdc-rowHover dark:focus-visible:ring-violet-400/45',
            collapsed && 'flex-col items-center',
          )}
          aria-label="DataRelay — Dashboard home"
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

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-1.5 py-2" role="navigation">
        {structure.map((entry) => {
          if (entry.type === 'item') {
            return (
              <NavButton
                key={entry.item.key}
                item={entry.item}
                collapsed={collapsed}
                pathname={pathname}
                onNavigate={onNavigate}
              />
            )
          }

          const GroupIcon = entry.group.icon as ComponentType<{ className?: string }>
          const groupActive = isGroupActive(pathname, entry.group.items)
          return (
            <div key={entry.group.id} className="space-y-0.5">
              <div
                className={cn(
                  'flex w-full items-center gap-2 rounded-md py-1.5 text-left text-[12px] font-semibold uppercase tracking-wide',
                  collapsed ? 'justify-center px-0' : 'pl-2.5 pr-2',
                  groupActive ? 'text-violet-800 dark:text-violet-200' : 'text-slate-500 dark:text-gdc-muted',
                )}
                aria-hidden={collapsed}
              >
                <GroupIcon className="h-3.5 w-3.5 shrink-0" />
                {!collapsed ? <span className="truncate">{entry.group.label}</span> : null}
              </div>
              {entry.group.items.map((item) => (
                <NavButton
                  key={item.key}
                  item={item}
                  collapsed={collapsed}
                  pathname={pathname}
                  onNavigate={onNavigate}
                  nested
                />
              ))}
            </div>
          )
        })}
      </nav>

      <div className={cn('mt-auto space-y-1.5 border-t border-slate-200/80 p-1.5 dark:border-gdc-border', collapsed && 'px-1')}>
        {isInternalOperatorUiEnabled() ? (
          <PersonaSwitcher persona={persona} collapsed={collapsed} onPersonaChange={onPersonaChange} />
        ) : null}
        {!collapsed ? (
          <p className="px-2 pb-1 text-[10px] font-medium text-slate-400 dark:text-gdc-muted">
            {isInternalOperatorUiEnabled() ? 'v0.0.0' : 'v1.0.0-rc'}
          </p>
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
