import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getAdminHttpsSettings, type HttpsSettingsDto } from '../../api/gdcAdmin'
import { SETTINGS_SECTION_PATH } from '../../config/nav-paths'
import { shouldShowInsecureConnectionWarning } from '../../lib/connection-security'
import { cn } from '../../lib/utils'

/**
 * Global banner when the operator reaches Data Relay over an unencrypted connection.
 * Uses backend access URL / request_scheme when available (reverse-proxy aware).
 */
export function InsecureConnectionBanner() {
  const [https, setHttps] = useState<HttpsSettingsDto | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const row = await getAdminHttpsSettings()
        if (active) setHttps(row)
      } catch {
        if (active) setHttps(null)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const pageProtocol = typeof window !== 'undefined' ? window.location.protocol : 'http:'
  const show = shouldShowInsecureConnectionWarning({
    pageProtocol,
    currentAccessUrl: https?.current_access_url,
    requestScheme: https?.request_scheme,
  })

  if (!show || dismissed) return null

  const httpsHint = https?.browser_https_url?.trim() || null

  return (
    <div
      role="alert"
      data-testid="insecure-connection-banner"
      className={cn(
        'mb-4 rounded-lg border border-amber-500/40 bg-amber-500/[0.09] px-3 py-2.5 text-[13px]',
        'text-amber-950 dark:border-amber-500/45 dark:bg-amber-500/12 dark:text-amber-50',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-semibold">This connection is not encrypted (HTTP).</p>
          <p className="text-[12px] leading-relaxed opacity-95">
            Login credentials and configuration data can be exposed on the network. Use HTTPS whenever
            possible.
            {httpsHint ? (
              <>
                {' '}
                Suggested URL:{' '}
                <a className="font-medium underline underline-offset-2" href={httpsHint}>
                  {httpsHint}
                </a>
              </>
            ) : null}
          </p>
          <p className="text-[12px]">
            <Link
              to={SETTINGS_SECTION_PATH.https}
              className="font-semibold underline underline-offset-2"
              data-testid="insecure-connection-https-settings-link"
            >
              Open Administration → HTTPS settings
            </Link>
          </p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded border border-amber-600/30 px-2 py-1 text-[11px] font-medium hover:bg-amber-500/15"
          onClick={() => setDismissed(true)}
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
