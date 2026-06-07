import type { LucideIcon } from 'lucide-react'
import { Activity, ScrollText, Settings, Shield, Workflow } from 'lucide-react'

/** Primary sidebar keys (M17.1 — five top-level menus). */
export type SidebarNavKey = 'streams' | 'monitoring' | 'logs' | 'governance' | 'administration'

/** All routable workspace keys (includes legacy + in-page governance/admin sections). */
export type AppNavKey =
  | SidebarNavKey
  | 'dashboard'
  | 'connectors'
  | 'mappings'
  | 'destinations'
  | 'routes'
  | 'runtime'
  | 'topology'
  | 'analytics'
  | 'aiGateway'
  | 'validation'
  | 'templates'
  | 'connectorCatalog'
  | 'backup'
  | 'settings'
  | 'governanceDataProtection'
  | 'governanceOperations'
  | 'governanceViolations'
  | 'governanceQuarantine'
  | 'governanceAudit'
  | 'governanceApprovals'
  | 'governanceReplay'
  | 'governanceNotifications'

export type SidebarTopItem = {
  key: SidebarNavKey
  label: string
  path: string
  icon: LucideIcon
}

/** Flat top-level navigation (M17.1). */
export const SIDEBAR_TOP_ITEMS: readonly SidebarTopItem[] = [
  { key: 'streams', label: 'Streams', path: '/streams', icon: Workflow },
  { key: 'monitoring', label: 'Monitoring', path: '/monitoring', icon: Activity },
  { key: 'logs', label: 'Logs', path: '/logs', icon: ScrollText },
  { key: 'governance', label: 'Governance', path: '/governance', icon: Shield },
  { key: 'administration', label: 'Administration', path: '/admin', icon: Settings },
] as const

/** M20 — hide Governance sidebar item when the signed-in role lacks governance_read. */
export function sidebarItemsForRole(canViewGovernance: boolean): readonly SidebarTopItem[] {
  if (canViewGovernance) return SIDEBAR_TOP_ITEMS
  return SIDEBAR_TOP_ITEMS.filter((item) => item.key !== 'governance')
}

/** @deprecated M17.4 persona split — use {@link sidebarItemsForRole} (M20 RBAC). */
export function sidebarItemsForPersona(isGovernance: boolean): readonly SidebarTopItem[] {
  return sidebarItemsForRole(isGovernance)
}

/** @deprecated M17.1 — use SIDEBAR_TOP_ITEMS. Kept for gradual migration in tests. */
export type SidebarLeafItem = {
  key: AppNavKey
  label: string
  path: string
}

/** @deprecated M17.1 — use SIDEBAR_TOP_ITEMS. */
export type SidebarGroupItem = {
  id: string
  title: string
  icon: LucideIcon
  items: readonly SidebarLeafItem[]
}

/** @deprecated M17.1 — use SIDEBAR_TOP_ITEMS. */
export const SIDEBAR_STRUCTURE: readonly SidebarGroupItem[] = SIDEBAR_TOP_ITEMS.map((item) => ({
  id: item.key,
  title: item.label,
  icon: item.icon,
  items: [{ key: item.key, label: item.label, path: item.path }],
}))

export const PAGE_TITLE: Record<AppNavKey, string> = {
  streams: 'Streams',
  monitoring: 'Monitoring',
  logs: 'Logs',
  governance: 'Governance',
  administration: 'Administration',
  dashboard: 'Operations Center',
  connectors: 'Connectors',
  mappings: 'Mappings',
  destinations: 'Destinations',
  routes: 'Routes',
  runtime: 'Runtime overview',
  topology: 'Topology',
  analytics: 'Delivery Analytics',
  aiGateway: 'AI Governance',
  governanceDataProtection: 'Data Protection',
  governanceOperations: 'Governance Operations',
  governanceViolations: 'Violation Center',
  governanceQuarantine: 'Quarantine',
  governanceAudit: 'Audit',
  governanceApprovals: 'Approvals',
  governanceReplay: 'Replay',
  governanceNotifications: 'Notifications',
  validation: 'Runtime health checks',
  templates: 'Templates',
  connectorCatalog: 'Connector Catalog',
  backup: 'Backup & Import',
  settings: 'Settings',
}
