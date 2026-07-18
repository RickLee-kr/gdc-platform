import type { HttpsSettingsDto } from '../../api/gdcAdmin'

export type HttpsStatusCode = NonNullable<HttpsSettingsDto['https_status']>

export const HTTPS_STATUS_LABELS: Record<HttpsStatusCode, string> = {
  enabled: 'HTTPS enabled',
  disabled: 'HTTPS disabled',
  certificate_missing: 'Certificate missing',
  certificate_invalid: 'Certificate invalid',
  certificate_expiring: 'Certificate expiring',
  configuration_error: 'Configuration error',
  unknown: 'Status unknown',
}

export function httpsStatusLabel(status: HttpsStatusCode | null | undefined): string {
  if (!status) return HTTPS_STATUS_LABELS.unknown
  return HTTPS_STATUS_LABELS[status] ?? HTTPS_STATUS_LABELS.unknown
}

export function formatCertificateDaysRemaining(days: number | null | undefined): string {
  if (days == null || Number.isNaN(days)) return '—'
  if (days < 0) return `Expired (${Math.abs(Math.round(days))}d ago)`
  if (days < 1) return `${Math.round(days * 24)}h remaining`
  return `${Math.round(days)}d remaining`
}

export type HttpsSavePreview = {
  enabling: boolean
  disabling: boolean
  regenerating: boolean
  redirectChanging: boolean
  impactItems: string[]
  requiresDangerConfirm: boolean
  typedConfirmPhrase?: string
}

export function buildHttpsSavePreview(args: {
  current: HttpsSettingsDto | null
  draft: {
    enabled: boolean
    certificate_ip_addresses: string
    certificate_dns_names: string
    redirect_http_to_https: boolean
    certificate_valid_days: number
    regenerate_certificate: boolean
  }
}): HttpsSavePreview {
  const { current, draft } = args
  const wasEnabled = Boolean(current?.enabled)
  const enabling = draft.enabled && !wasEnabled
  const disabling = !draft.enabled && wasEnabled
  const regenerating = draft.enabled && draft.regenerate_certificate
  const redirectChanging =
    Boolean(current) && draft.redirect_http_to_https !== Boolean(current?.redirect_http_to_https)

  const impactItems: string[] = []
  if (enabling) impactItems.push('HTTPS will be enabled on the reverse proxy.')
  if (disabling) {
    impactItems.push('HTTPS will be disabled; browsers may fall back to HTTP.')
    impactItems.push('Existing TLS listeners may stop accepting HTTPS traffic.')
  }
  if (regenerating) {
    impactItems.push('A new self-signed certificate and private key will be generated.')
    impactItems.push('Previous PEM files are copied under the TLS backups folder (not shown in UI).')
  }
  if (redirectChanging) {
    impactItems.push(
      draft.redirect_http_to_https
        ? 'HTTP→HTTPS redirect will be enabled when the HTTPS listener is active.'
        : 'HTTP→HTTPS redirect will be disabled.',
    )
  }
  impactItems.push(
    `Certificate SANs: IPs [${draft.certificate_ip_addresses || 'none'}], DNS [${draft.certificate_dns_names || 'none'}].`,
  )
  if (draft.enabled) {
    impactItems.push(`Certificate validity: ${draft.certificate_valid_days} days (generation lifetime).`)
  }
  impactItems.push('Private key and certificate PEM are never returned by the API or shown in this UI.')

  const requiresDangerConfirm = disabling || regenerating
  return {
    enabling,
    disabling,
    regenerating,
    redirectChanging,
    impactItems,
    requiresDangerConfirm,
    typedConfirmPhrase: disabling ? 'DISABLE HTTPS' : regenerating ? 'REGENERATE CERT' : undefined,
  }
}
