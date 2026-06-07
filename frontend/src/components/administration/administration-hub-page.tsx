import { BookOpen, Cable, Database, Route, Settings, Shield } from 'lucide-react'
import { Link } from 'react-router-dom'
import { NAV_PATH } from '../../config/nav-paths'
import { isOssReleaseMode } from '../../lib/feature-flags'
import { cn } from '../../lib/utils'

type HubCard = {
  title: string
  description: string
  path: string
  icon: typeof Cable
  testId: string
}

const HUB_CARDS: readonly HubCard[] = [
  {
    title: 'Connectors',
    description: 'Product connectors, authentication, and shared source settings.',
    path: NAV_PATH.connectors,
    icon: Cable,
    testId: 'admin-hub-connectors',
  },
  {
    title: 'Connector Catalog',
    description: 'Declarative connector modules from the platform registry (read-only).',
    path: NAV_PATH.connectorCatalog,
    icon: BookOpen,
    testId: 'admin-hub-connector-catalog',
  },
  {
    title: 'Destinations',
    description: 'Reusable delivery endpoints — Syslog, Webhook, and more.',
    path: NAV_PATH.destinations,
    icon: Database,
    testId: 'admin-hub-destinations',
  },
  {
    title: 'Routes',
    description: 'Links between streams and destinations with delivery policies.',
    path: NAV_PATH.routes,
    icon: Route,
    testId: 'admin-hub-routes',
  },
  {
    title: 'Settings',
    description: 'Users, HTTPS, network, retention, audit log, and system health.',
    path: NAV_PATH.settings,
    icon: Settings,
    testId: 'admin-hub-settings',
  },
  {
    title: 'Backup',
    description: 'Export and import portable workspace configuration snapshots.',
    path: NAV_PATH.backup,
    icon: Shield,
    testId: 'admin-hub-backup',
  },
] as const

/** OSS release exposes operator essentials only; catalog is internal registry. */
function visibleHubCards(): readonly HubCard[] {
  if (!isOssReleaseMode()) return HUB_CARDS
  return HUB_CARDS.filter((card) => card.testId !== 'admin-hub-connector-catalog')
}

export function AdministrationHubPage() {
  const cards = visibleHubCards()
  return (
    <div className="w-full min-w-0 space-y-5" data-testid="administration-hub-page">
      <div className="border-b border-slate-200/80 pb-4 dark:border-gdc-divider">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">Administration</h2>
        <p className="mt-1 max-w-2xl text-[13px] text-slate-600 dark:text-gdc-muted">
          Infrastructure, connectors, delivery targets, routes, and platform settings. Day-to-day stream work lives under
          Streams and Monitoring.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Administration areas">
        {cards.map((card) => {
          const Icon = card.icon
          return (
            <Link
              key={card.testId}
              to={card.path}
              data-testid={card.testId}
              className={cn(
                'group flex flex-col rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm transition',
                'hover:border-violet-300/80 hover:shadow-md dark:border-gdc-border dark:bg-gdc-card dark:hover:border-violet-500/40',
              )}
            >
              <div className="flex items-start gap-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-slate-900 group-hover:text-violet-800 dark:text-slate-100 dark:group-hover:text-violet-200">
                    {card.title}
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-slate-600 dark:text-gdc-muted">{card.description}</p>
                </div>
              </div>
              <span className="mt-3 text-[11px] font-semibold text-violet-700 dark:text-violet-300">Open →</span>
            </Link>
          )
        })}
      </section>
    </div>
  )
}
