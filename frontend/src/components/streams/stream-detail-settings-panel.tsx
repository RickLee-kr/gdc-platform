import { Link } from 'react-router-dom'
import {
  streamApiTestPath,
  streamEditPath,
  streamEnrichmentPath,
  streamMappingPath,
} from '../../config/nav-paths'

const SETTINGS_LINKS = [
  { label: 'Stream configuration', to: (id: string) => streamEditPath(id), testId: 'settings-edit' },
  { label: 'Mapping workspace', to: (id: string) => streamMappingPath(id), testId: 'settings-mapping' },
  { label: 'Enrichment & transform', to: (id: string) => streamEnrichmentPath(id), testId: 'settings-enrichment' },
  { label: 'API test & sample', to: (id: string) => streamApiTestPath(id), testId: 'settings-api-test' },
] as const

export function StreamDetailSettingsPanel({ streamId }: { streamId: string }) {
  return (
    <section data-testid="stream-detail-settings-panel" className="space-y-4">
      <p className="text-[13px] text-slate-600 dark:text-gdc-muted">
        Advanced configuration, delivery path operations, sync position trace, and platform health extensions. Day-to-day monitoring stays on Overview and Issues.
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {SETTINGS_LINKS.map((item) => (
          <li key={item.testId}>
            <Link
              to={item.to(streamId)}
              data-testid={item.testId}
              className="flex h-full items-center rounded-lg border border-slate-200/80 bg-white px-3 py-2.5 text-[12px] font-semibold text-slate-800 shadow-sm hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:hover:bg-gdc-rowHover"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-slate-500 dark:text-gdc-muted">
        Pipeline debugger and governance drawers load in this tab when your role permits.
      </p>
    </section>
  )
}
