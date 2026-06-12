import { Link } from 'react-router-dom'
import { streamEditPath, streamEnrichmentPath, streamMappingPath } from '../../config/nav-paths'
import { resolveSourceProductLabel } from '../../lib/source-product-group'

type DeliverySection = {
  key: string
  title: string
  body: string
  editLabel: string
  href: (streamId: string) => string
}

const DELIVERY_SECTIONS: DeliverySection[] = [
  {
    key: 'source',
    title: 'Source',
    body: 'Connection, ingest method, and polling schedule for this stream.',
    editLabel: 'Edit source connection',
    href: (id) => `${streamEditPath(id)}?section=source`,
  },
  {
    key: 'mapping',
    title: 'Mapping',
    body: 'Field mapping and record selection rules applied before delivery.',
    editLabel: 'Open mapping workspace',
    href: (id) => streamMappingPath(id),
  },
  {
    key: 'protection',
    title: 'Protection',
    body: 'Sensitive data handling, classification, and policy enforcement.',
    editLabel: 'Open protection settings',
    href: (id) => streamEnrichmentPath(id),
  },
  {
    key: 'destination',
    title: 'Destination',
    body: 'Delivery paths, targets, and failure handling for outbound events.',
    editLabel: 'Edit delivery paths',
    href: (id) => `${streamEditPath(id)}?section=delivery`,
  },
]

export function StreamDetailDeliveryPanel({
  streamId,
  connectorName,
  connectorProductGroup,
  sourceLabel,
}: {
  streamId: string
  connectorName: string | null
  connectorProductGroup?: string | null
  sourceLabel: string
}) {
  const product = resolveSourceProductLabel(connectorName, { product_group: connectorProductGroup })

  return (
    <section data-testid="stream-detail-delivery-panel" className="space-y-3">
      <p className="text-[13px] text-slate-600 dark:text-gdc-muted">
        End-to-end delivery path for <span className="font-semibold text-slate-800 dark:text-slate-100">{product}</span>
        {' · '}
        {sourceLabel}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {DELIVERY_SECTIONS.map((sec) => (
            <article
              key={sec.key}
              className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card"
            >
              <h3 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{sec.title}</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-slate-600 dark:text-gdc-muted">{sec.body}</p>
              <Link
                to={sec.href(streamId)}
                className="mt-3 inline-flex text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
              >
                {sec.editLabel} →
              </Link>
            </article>
        ))}
      </div>
      <p className="text-[11px] text-slate-500 dark:text-gdc-muted">
        Delivery path operational metrics, sync position trace, and retry details are in the Settings tab (Advanced view).
      </p>
    </section>
  )
}
