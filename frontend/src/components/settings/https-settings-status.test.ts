import { describe, expect, it } from 'vitest'
import {
  buildHttpsSavePreview,
  formatCertificateDaysRemaining,
  httpsStatusLabel,
} from './https-settings-status'

describe('https-settings-status', () => {
  it('maps status codes to labels', () => {
    expect(httpsStatusLabel('enabled')).toBe('HTTPS enabled')
    expect(httpsStatusLabel('certificate_expiring')).toBe('Certificate expiring')
    expect(httpsStatusLabel(undefined)).toBe('Status unknown')
  })

  it('formats days remaining', () => {
    expect(formatCertificateDaysRemaining(12.4)).toBe('12d remaining')
    expect(formatCertificateDaysRemaining(-2)).toContain('Expired')
    expect(formatCertificateDaysRemaining(null)).toBe('—')
  })

  it('builds danger preview when disabling HTTPS', () => {
    const preview = buildHttpsSavePreview({
      current: {
        enabled: true,
        certificate_ip_addresses: ['10.0.0.1'],
        certificate_dns_names: [],
        redirect_http_to_https: true,
        certificate_valid_days: 365,
        current_access_url: 'https://x',
        https_active: true,
        certificate_not_after: null,
        restart_required_after_save: false,
        http_listener_active: true,
        https_listener_active: true,
        redirect_http_to_https_effective: true,
        proxy_status: 'ok',
        proxy_health_ok: true,
        proxy_last_reload_at: null,
        proxy_last_reload_ok: true,
        proxy_last_reload_detail: null,
        proxy_fallback_to_http_last: false,
        browser_http_url: 'http://x',
        browser_https_url: 'https://x',
      },
      draft: {
        enabled: false,
        certificate_ip_addresses: '10.0.0.1',
        certificate_dns_names: '',
        redirect_http_to_https: false,
        certificate_valid_days: 365,
        regenerate_certificate: false,
      },
    })
    expect(preview.disabling).toBe(true)
    expect(preview.requiresDangerConfirm).toBe(true)
    expect(preview.typedConfirmPhrase).toBe('DISABLE HTTPS')
  })
})
