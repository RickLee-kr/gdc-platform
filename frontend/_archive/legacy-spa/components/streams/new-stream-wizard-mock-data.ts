import type { LucideIcon } from 'lucide-react'
import { Cable, Cloud, Database, Radio, Webhook } from 'lucide-react'

/** Connector catalog types shown in Step 1 (UI mock). */
export type WizardConnectorType = 'HTTP API' | 'DATABASE' | 'WEBHOOK'

export type WizardConnectorCard = {
  id: string
  name: string
  description: string
  type: WizardConnectorType
  /** Tailwind-friendly accent for icon container */
  iconTone: string
  Icon: LucideIcon
}

export const WIZARD_CONNECTOR_TYPE_FILTERS: ReadonlyArray<WizardConnectorType | 'all'> = [
  'all',
  'HTTP API',
  'DATABASE',
  'WEBHOOK',
]

export const MOCK_WIZARD_CONNECTORS: readonly WizardConnectorCard[] = [
  {
    id: 'cybereason',
    name: 'Cybereason EDR Platform',
    description: 'Threat and detection events from Cybereason EDR APIs.',
    type: 'HTTP API',
    iconTone: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
    Icon: Cable,
  },
  {
    id: 'crowdstrike',
    name: 'CrowdStrike',
    description: 'Falcon platform detections and incidents via HTTP API.',
    type: 'HTTP API',
    iconTone: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
    Icon: Cloud,
  },
  {
    id: 'custom-api',
    name: 'Custom API',
    description: 'Generic HTTP polling against any REST or JSON API.',
    type: 'HTTP API',
    iconTone: 'border-slate-400/40 bg-slate-500/10 text-slate-700 dark:text-gdc-mutedStrong',
    Icon: Radio,
  },
  {
    id: 'oracle',
    name: 'Oracle Database',
    description: 'Query Oracle DB tables or views on a schedule.',
    type: 'DATABASE',
    iconTone: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
    Icon: Database,
  },
  {
    id: 'mysql',
    name: 'MySQL Database',
    description: 'Scheduled SQL queries against MySQL.',
    type: 'DATABASE',
    iconTone: 'border-sky-500/35 bg-sky-500/10 text-sky-800 dark:text-sky-300',
    Icon: Database,
  },
  {
    id: 'postgres',
    name: 'PostgreSQL Database',
    description: 'Scheduled SQL queries against PostgreSQL.',
    type: 'DATABASE',
    iconTone: 'border-blue-500/35 bg-blue-500/10 text-blue-800 dark:text-blue-300',
    Icon: Database,
  },
  {
    id: 'webhook',
    name: 'Webhook Receiver',
    description: 'Accept inbound HTTP callbacks as the stream source.',
    type: 'WEBHOOK',
    iconTone: 'border-fuchsia-500/35 bg-fuchsia-500/10 text-fuchsia-800 dark:text-fuchsia-300',
    Icon: Webhook,
  },
]

export function typeTagClass(type: WizardConnectorType): string {
  switch (type) {
    case 'HTTP API':
      return 'border-sky-200/80 bg-sky-500/[0.08] text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200'
    case 'DATABASE':
      return 'border-emerald-200/80 bg-emerald-500/[0.08] text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200'
    case 'WEBHOOK':
      return 'border-violet-200/80 bg-violet-500/[0.08] text-violet-800 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200'
    default: {
      const _e: never = type
      return _e
    }
  }
}
