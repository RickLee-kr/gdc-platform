import type { ReactNode } from 'react'
import { Bell, Moon, RefreshCw, Search, Settings, Sun } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { NAV_PATH } from '../../config/nav-paths'
import { cn } from '../../lib/utils'
import { GDC_HEADER_REFRESH_EVENT } from './header-refresh-event'

type TopHeaderProps = {
  title: string
  /** Optional breadcrumb row above the title (e.g. Streams / … / Runtime). */
  breadcrumb?: ReactNode
  runtimeSummary?: string
  runtimeHealthy?: boolean
  isDark: boolean
  onToggleTheme: () => void
  onRefresh?: () => void
}

export function TopHeader({
  title,
  breadcrumb,
  runtimeSummary = '24 streams active · delivery path nominal',
  runtimeHealthy = true,
  isDark,
  onToggleTheme,
  onRefresh,
}: TopHeaderProps) {
  const navigate = useNavigate()

  function handleHeaderRefresh() {
    onRefresh?.()
    if (typeof globalThis.window !== 'undefined') {
      globalThis.window.dispatchEvent(new CustomEvent(GDC_HEADER_REFRESH_EVENT))
    }
  }

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/95 px-3 py-2.5 shadow-sm backdrop-blur-md dark:border-gdc-border dark:bg-gdc-panel/95 dark:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.55)] md:px-5">
      <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-2.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-x-4 sm:gap-y-0">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {breadcrumb ? (
              <div className="min-w-0 text-[11px] leading-snug text-slate-500 dark:text-gdc-muted">{breadcrumb}</div>
            ) : null}
            <h1 className="shrink-0 text-base font-semibold tracking-tight text-slate-900 dark:text-gdc-foreground md:text-lg">{title}</h1>
          </div>
          <div className="hidden h-4 w-px shrink-0 bg-slate-200 dark:bg-gdc-border sm:block" aria-hidden />
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                runtimeHealthy
                  ? 'border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/[0.12] dark:text-emerald-100/90'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-950 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-100/90',
              )}
              aria-label="Runtime status"
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', runtimeHealthy ? 'bg-emerald-500' : 'bg-amber-500')} aria-hidden />
              RUN
            </span>
            <span className="min-w-0 text-[11px] leading-snug text-slate-600 dark:text-gdc-muted">{runtimeSummary}</span>
          </div>
        </div>

        <div className="flex w-full min-w-0 shrink-0 flex-wrap items-center justify-end gap-1.5 sm:w-auto sm:max-w-[min(420px,92vw)] lg:max-w-[min(440px,46vw)]">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-gdc-placeholder" aria-hidden />
            <input
              type="search"
              placeholder="Search streams, connectors, routes…"
              className="h-8 w-full rounded-md border border-slate-200/90 bg-slate-50/80 py-1 pl-8 pr-2 text-[13px] text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-300/50 dark:border-gdc-inputBorder dark:bg-gdc-input dark:text-gdc-foreground dark:shadow-gdc-control dark:placeholder:text-gdc-placeholder dark:focus:border-gdc-primary dark:focus:ring-gdc-primary/45"
              aria-label="Search streams, connectors, routes"
            />
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => navigate(NAV_PATH.runtime)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-gdc-muted dark:hover:bg-gdc-rowHover"
              aria-label="Open runtime overview for alerts and stream health"
              title="Runtime — alerts and health"
            >
              <Bell className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => navigate(NAV_PATH.settings)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-gdc-muted dark:hover:bg-gdc-rowHover"
              aria-label="Open settings"
              title="Settings"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleHeaderRefresh}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-gdc-muted dark:hover:bg-gdc-rowHover"
              aria-label="Refresh dashboard and runtime data"
              title="Refresh data"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onToggleTheme}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-gdc-muted dark:hover:bg-gdc-rowHover"
              aria-label="Toggle color theme"
            >
              {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
