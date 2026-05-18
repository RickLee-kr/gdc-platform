import { AlertTriangle, CheckCircle2, Globe2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getAdminNetworkSettings,
  getAuthWhoAmI,
  postAdminNetworkSettingsApply,
  putAdminNetworkSettings,
  type NetworkSettingsApplyDto,
  type NetworkSettingsDto,
  type NetworkSettingsSaveDto,
} from '../../api/gdcAdmin'
import { gdcUi, isAdminUiReadOnly, readAdminUiRole } from '../../lib/gdc-ui-tokens'
import { cn } from '../../lib/utils'

type Draft = {
  http_port: string
  https_port: string
}

type FieldErrors = Partial<Record<keyof Draft, string>>

function validatePortField(label: string, value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return `${label} is required.`
  if (!/^\d+$/.test(trimmed)) return `${label} must contain numbers only.`
  const port = Number(trimmed)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return `${label} must be a valid TCP port between 1 and 65535.`
  }
  return null
}

export function validateNetworkPortDraft(draft: Draft): { errors: FieldErrors; formError: string | null } {
  const errors: FieldErrors = {}
  const httpError = validatePortField('HTTP Port', draft.http_port)
  const httpsError = validatePortField('HTTPS Port', draft.https_port)
  if (httpError) errors.http_port = httpError
  if (httpsError) errors.https_port = httpsError

  const formError =
    !httpError && !httpsError && Number(draft.http_port.trim()) === Number(draft.https_port.trim())
      ? 'HTTP Port and HTTPS Port cannot match.'
      : null
  return { errors, formError }
}

function cleanApiError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  return raw.replace(/^\d+:\s+(?:\[[^\]]+\]\s*)?/, '')
}

function envLine(settings: NetworkSettingsDto | NetworkSettingsSaveDto | null, key: string): string {
  if (!settings) return `${key}=—`
  return `${key}=${settings.env_example[key] ?? '—'}`
}

export function AdminNetworkSettingsPage() {
  const [settings, setSettings] = useState<NetworkSettingsDto | null>(null)
  const [draft, setDraft] = useState<Draft>({ http_port: '', https_port: '' })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [saveResult, setSaveResult] = useState<NetworkSettingsSaveDto | null>(null)
  const [applyResult, setApplyResult] = useState<NetworkSettingsApplyDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [applying, setApplying] = useState(false)
  const [backendRole, setBackendRole] = useState<'ADMINISTRATOR' | 'OPERATOR' | 'VIEWER' | null>(readAdminUiRole())

  const readOnly = isAdminUiReadOnly() || backendRole !== 'ADMINISTRATOR'

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [network, who] = await Promise.all([getAdminNetworkSettings(), getAuthWhoAmI().catch(() => null)])
      setSettings(network)
      setDraft({ http_port: String(network.http_port), https_port: String(network.https_port) })
      setSaveResult(null)
      setApplyResult(null)
      if (who && (who.role === 'ADMINISTRATOR' || who.role === 'OPERATOR' || who.role === 'VIEWER')) {
        setBackendRole(who.role)
      }
    } catch (e) {
      setLoadError(cleanApiError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = useMemo(() => {
    if (!settings) return false
    return draft.http_port.trim() !== String(settings.http_port) || draft.https_port.trim() !== String(settings.https_port)
  }, [draft, settings])

  const onSave = async () => {
    setSubmitError(null)
    setFieldErrors({})
    setSaveResult(null)
    setApplyResult(null)
    const validation = validateNetworkPortDraft(draft)
    setFieldErrors(validation.errors)
    if (validation.formError) {
      setSubmitError(validation.formError)
      return
    }
    if (Object.keys(validation.errors).length > 0) return
    if (readOnly) return

    setSaving(true)
    try {
      const result = await putAdminNetworkSettings({
        http_port: Number(draft.http_port.trim()),
        https_port: Number(draft.https_port.trim()),
      })
      setSettings(result)
      setDraft({ http_port: String(result.http_port), https_port: String(result.https_port) })
      setSaveResult(result)
    } catch (e) {
      setSubmitError(cleanApiError(e))
    } finally {
      setSaving(false)
    }
  }

  const onApply = async () => {
    setSubmitError(null)
    setApplyResult(null)
    if (readOnly) return

    setApplying(true)
    try {
      const result = await postAdminNetworkSettingsApply()
      setApplyResult(result)
    } catch (e) {
      setSubmitError(cleanApiError(e))
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
            Platform operations
          </p>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Network / Reverse Proxy Settings
          </h2>
          <p className="max-w-3xl text-[13px] leading-relaxed text-slate-600 dark:text-gdc-muted">
            Configure the published browser ports for the existing nginx reverse proxy. Saving updates the database and
            platform .env; applying recreates only the reverse-proxy service.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || saving || applying}
          className={cn(gdcUi.secondaryBtn, (loading || saving || applying) && 'cursor-not-allowed opacity-60')}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Refresh
        </button>
      </div>

      {readOnly ? (
        <div
          role="status"
          className="rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 text-[13px] text-amber-950 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-100"
        >
          Administrator role is required to save reverse-proxy network settings.
        </div>
      ) : null}

      {loadError ? (
        <div role="alert" className="rounded-lg border border-red-500/25 bg-red-500/[0.07] px-3 py-2 text-[13px] text-red-900 dark:text-red-100/90">
          Could not load network settings: {loadError}
        </div>
      ) : null}

      {submitError ? (
        <div role="alert" className="rounded-lg border border-red-500/25 bg-red-500/[0.07] px-3 py-2 text-[13px] text-red-900 dark:text-red-100/90">
          {submitError}
        </div>
      ) : null}

      <section className={cn(gdcUi.cardShell, 'overflow-hidden')} aria-labelledby="network-settings-heading">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 dark:border-gdc-border md:px-6">
          <div className="flex gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-500/20 bg-violet-500/[0.07] text-violet-700 dark:border-gdc-primary/35 dark:bg-gdc-primary/15 dark:text-violet-100">
              <Globe2 className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h3 id="network-settings-heading" className="text-[15px] font-semibold text-slate-900 dark:text-slate-50">
                Published reverse-proxy ports
              </h3>
              <p className="mt-0.5 text-[12px] text-slate-600 dark:text-gdc-muted">
                Defaults are HTTP 18080 and HTTPS 18443. The backend validates duplicate, reserved, and out-of-range ports.
              </p>
            </div>
          </div>
          <span className="rounded border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:border-gdc-border dark:text-gdc-muted">
            Browser apply supported
          </span>
        </div>

        <div className="grid gap-6 px-4 py-5 md:grid-cols-12 md:px-6 md:py-6">
          <div className="space-y-4 md:col-span-5">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted" htmlFor="network-http-port">
                HTTP Port
              </label>
              <input
                id="network-http-port"
                inputMode="numeric"
                className={cn('mt-1 w-full', gdcUi.input, fieldErrors.http_port && 'border-red-400 focus:border-red-500')}
                disabled={loading || applying || readOnly}
                value={draft.http_port}
                onChange={(e) => setDraft((d) => ({ ...d, http_port: e.target.value }))}
              />
              {fieldErrors.http_port ? <p className="mt-1 text-[12px] text-red-700 dark:text-red-200">{fieldErrors.http_port}</p> : null}
            </div>

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted" htmlFor="network-https-port">
                HTTPS Port
              </label>
              <input
                id="network-https-port"
                inputMode="numeric"
                className={cn('mt-1 w-full', gdcUi.input, fieldErrors.https_port && 'border-red-400 focus:border-red-500')}
                disabled={loading || applying || readOnly}
                value={draft.https_port}
                onChange={(e) => setDraft((d) => ({ ...d, https_port: e.target.value }))}
              />
              {fieldErrors.https_port ? <p className="mt-1 text-[12px] text-red-700 dark:text-red-200">{fieldErrors.https_port}</p> : null}
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={loading || saving || applying || readOnly || !dirty}
                onClick={() => void onSave()}
                className={cn(gdcUi.primaryBtn, (loading || saving || applying || readOnly || !dirty) && 'cursor-not-allowed opacity-55')}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              <button
                type="button"
                disabled={loading || saving || applying || readOnly}
                onClick={() => void onApply()}
                className={cn(gdcUi.secondaryBtn, (loading || saving || applying || readOnly) && 'cursor-not-allowed opacity-55')}
              >
                {applying ? 'Applying…' : 'Apply reverse-proxy change'}
              </button>
            </div>
          </div>

          <div className="space-y-4 md:col-span-7">
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-4 text-[12px] leading-relaxed text-amber-950 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-100">
              <p className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                Restart required after saving
              </p>
              <p className="mt-2">
                The platform will keep serving on the currently active published ports until the reverse-proxy container is
                recreated. After applying, this browser may need to reconnect using the newly configured HTTP or HTTPS port.
              </p>
            </div>

            <div className={cn('rounded-xl border p-4 text-[12px]', gdcUi.innerWell)}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Environment values</p>
              <pre
                data-testid="network-env-example"
                className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white p-3 font-mono text-[11px] text-slate-800 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
              >
                {envLine(saveResult ?? settings, 'GDC_HTTP_PORT')}
                {'\n'}
                {envLine(saveResult ?? settings, 'GDC_HTTPS_PORT')}
              </pre>
            </div>
          </div>
        </div>
      </section>

      {saveResult ? (
        <section
          className={cn(gdcUi.cardShell, 'border-emerald-500/25 p-4 dark:border-emerald-500/30 md:p-6')}
          aria-labelledby="network-save-result-heading"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 id="network-save-result-heading" className="flex items-center gap-2 text-[15px] font-semibold text-emerald-900 dark:text-emerald-100">
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                Network settings saved
              </h3>
              <p className="mt-1 text-[12px] text-slate-600 dark:text-gdc-muted">{saveResult.message}</p>
            </div>
            {saveResult.restart_required ? (
              <span className="rounded border border-amber-500/35 bg-amber-500/12 px-2 py-0.5 text-[11px] font-semibold text-amber-900 dark:text-amber-100">
                Restart required
              </span>
            ) : null}
          </div>

          <p className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-3 text-[12px] leading-relaxed text-amber-950 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-100">
            Click Apply reverse-proxy change to recreate the reverse-proxy container. The UI connection can move to the new
            port during apply, so reconnect using HTTP {saveResult.http_port} or HTTPS {saveResult.https_port} if needed.
          </p>
        </section>
      ) : null}

      {applyResult ? (
        <section
          className={cn(
            gdcUi.cardShell,
            applyResult.success
              ? 'border-emerald-500/25 p-4 dark:border-emerald-500/30 md:p-6'
              : 'border-red-500/25 p-4 dark:border-red-500/30 md:p-6',
          )}
          aria-labelledby="network-apply-result-heading"
        >
          <h3
            id="network-apply-result-heading"
            className={cn(
              'flex items-center gap-2 text-[15px] font-semibold',
              applyResult.success ? 'text-emerald-900 dark:text-emerald-100' : 'text-red-900 dark:text-red-100',
            )}
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            {applyResult.success ? 'Reverse proxy applied' : 'Reverse proxy apply failed'}
          </h3>
          <p className="mt-1 text-[12px] text-slate-600 dark:text-gdc-muted">{applyResult.message}</p>
          <div className={cn('mt-4 rounded-xl border p-4 text-[12px]', gdcUi.innerWell)}>
            <p className="font-mono text-[11px] text-slate-600 dark:text-gdc-muted">
              {applyResult.command} exited with {applyResult.exit_code}
            </p>
            {applyResult.stdout || applyResult.stderr ? (
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-3 font-mono text-[11px] text-slate-800 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100">
                {applyResult.stdout}
                {applyResult.stderr ? `\n${applyResult.stderr}` : ''}
              </pre>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}
