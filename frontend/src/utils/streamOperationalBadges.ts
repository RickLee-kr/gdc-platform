/**
 * Labels streams by **dataset provenance** (bundled seed vs dev lab) and **runtime adapter tier**
 * (HTTP primary vs S3/DB/remote extended). See docs/runtime/runtime-capability-matrix.md.
 */
import { isDevValidationLabEntityName } from './devValidationLab'
import { normalizeGdcStreamSourceType } from './sourceTypePresentation'

/** Matches `app/db/seed.py` create-only demo stream name. */
export const GDC_BUNDLED_DEMO_STREAM_NAME = 'Sample Alerts Stream' as const

export type StreamDatasetKind = 'operator_defined' | 'dev_validation_fixture' | 'bundled_demo_seed'

export function classifyStreamDataset(streamName: string | null | undefined): StreamDatasetKind {
  const n = (streamName ?? '').trim()
  if (isDevValidationLabEntityName(n)) return 'dev_validation_fixture'
  if (n === GDC_BUNDLED_DEMO_STREAM_NAME) return 'bundled_demo_seed'
  return 'operator_defined'
}

export type OperationalStreamBadgeVariant = 'emerald' | 'violet' | 'amber'

export type OperationalStreamBadge = {
  key: string
  label: string
  title: string
  variant: OperationalStreamBadgeVariant
}

export function buildOperationalStreamBadges(
  streamName: string | null | undefined,
  sourceOrStreamType: string | null | undefined,
): OperationalStreamBadge[] {
  const out: OperationalStreamBadge[] = []
  const dataset = classifyStreamDataset(streamName)
  if (dataset === 'dev_validation_fixture') {
    out.push({
      key: 'dataset-lab',
      label: 'Lab fixture',
      title:
        'Development validation or visible E2E fixture dataset (name prefix [DEV VALIDATION] or [DEV E2E]). Often targets WireMock, lab webhooks, or synthetic services; same runtime adapters apply.',
      variant: 'amber',
    })
  } else if (dataset === 'bundled_demo_seed') {
    out.push({
      key: 'dataset-demo',
      label: 'Demo seed',
      title:
        'Bundled create-only demo row from app/db/seed.py (Sample Alerts Stream). HTTP runtime path is real; replace URLs/connectors for production.',
      variant: 'amber',
    })
  }

  const st = normalizeGdcStreamSourceType(sourceOrStreamType)
  if (st === 'HTTP_API_POLLING') {
    out.push({
      key: 'runtime-primary',
      label: 'Runtime supported',
      title:
        'HTTP API polling: primary path (SourceAdapterRegistry → HttpApiSourceAdapter). Executes in the standard StreamRunner pipeline.',
      variant: 'emerald',
    })
  } else {
    const kind =
      st === 'S3_OBJECT_POLLING'
        ? 'S3 object polling'
        : st === 'DATABASE_QUERY'
          ? 'Database query'
          : 'Remote file polling'
    out.push({
      key: 'runtime-extended',
      label: 'Runtime supported · extended',
      title: `${kind}: registered adapter in SourceAdapterRegistry — same pipeline as HTTP, with extra credentials/upstream requirements. See docs/runtime/runtime-capability-matrix.md.`,
      variant: 'violet',
    })
  }

  return out
}

/** Extra tooltip copy for Run Now / Start Stream on seeded or lab streams (informational only). */
export function operationalRunControlTooltipSupplement(streamName: string | null | undefined): string | null {
  switch (classifyStreamDataset(streamName)) {
    case 'bundled_demo_seed':
      return 'Demo seed stream: confirm the sample upstream and webhook still match your environment before relying on metrics.'
    case 'dev_validation_fixture':
      return 'Lab fixture: requires validation lab networks/services (e.g. WireMock, lab receivers, optional MinIO/SSH) when applicable.'
    default:
      return null
  }
}
