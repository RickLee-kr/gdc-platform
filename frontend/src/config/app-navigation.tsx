import type { LucideIcon } from 'lucide-react'
import { Cable, Cpu, LayoutDashboard, Route, Settings, Workflow } from 'lucide-react'

export type AppNavKey =
  | 'dashboard'
  | 'connectors'
  | 'streams'
  | 'mappings'
  | 'destinations'
  | 'routes'
  | 'runtime'
  | 'analytics'
  | 'logs'
  | 'validation'
  | 'templates'
  | 'backup'
  | 'settings'

export type SidebarLeafItem = {
  key: AppNavKey
  label: string
  path: string
}

export type SidebarGroupItem = {
  id: string
  title: string
  icon: LucideIcon
  items: readonly SidebarLeafItem[]
}

/** Grouped navigation aligned with operator dashboard mockup. */
export const SIDEBAR_STRUCTURE: readonly SidebarGroupItem[] = [
  {
    id: 'dashboard',
    title: 'Dashboard',
    icon: LayoutDashboard,
    items: [{ key: 'dashboard', label: 'Operations Center', path: '/' }],
  },
  {
    id: 'connectors',
    title: 'Connectors',
    icon: Cable,
    items: [{ key: 'connectors', label: 'Connectors', path: '/connectors' }],
  },
  {
    id: 'streams',
    title: 'Streams',
    icon: Workflow,
    items: [
      { key: 'streams', label: 'Streams', path: '/streams' },
      { key: 'templates', label: 'Templates', path: '/templates' },
    ],
  },
  {
    id: 'delivery',
    title: 'Delivery',
    icon: Route,
    items: [
      { key: 'destinations', label: 'Destinations', path: '/destinations' },
      { key: 'routes', label: 'Routes', path: '/routes' },
    ],
  },
  {
    id: 'operations',
    title: 'Operations',
    icon: Cpu,
    items: [
      { key: 'runtime', label: 'Runtime', path: '/runtime' },
      { key: 'analytics', label: 'Analytics', path: '/runtime/analytics' },
      { key: 'logs', label: 'Logs', path: '/logs' },
    ],
  },
  {
    id: 'settings',
    title: 'Settings',
    icon: Settings,
    items: [{ key: 'settings', label: 'Admin Settings', path: '/settings' }],
  },
] as const

export const PAGE_TITLE: Record<AppNavKey, string> = {
  dashboard: 'Operations Center',
  connectors: 'Connectors',
  streams: 'Streams',
  mappings: 'Mappings',
  destinations: 'Destinations',
  routes: 'Routes',
  runtime: 'Runtime',
  analytics: 'Analytics',
  logs: 'Logs',
  validation: 'Runtime health checks',
  templates: 'Templates',
  backup: 'Backup & Import',
  settings: 'Settings',
}
