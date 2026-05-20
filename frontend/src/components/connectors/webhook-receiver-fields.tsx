import type { ConnectorWritePayload } from '../../api/gdcConnectors'
import { gdcUi } from '../../lib/gdc-ui-tokens'
import { cn } from '../../lib/utils'

type Props = {
  form: ConnectorWritePayload
  set: <K extends keyof ConnectorWritePayload>(key: K, value: ConnectorWritePayload[K]) => void
  receiverPath?: string | null
  sharedSecretConfigured?: boolean
  bearerTokenConfigured?: boolean
}

export function WebhookReceiverFields({
  form,
  set,
  receiverPath,
  sharedSecretConfigured,
  bearerTokenConfigured,
}: Props) {
  const authMode = String(form.webhook_auth_mode ?? 'no_auth')
  const path = receiverPath || (form.receiver_key ? `/api/v1/ingest/webhook/${form.receiver_key}` : '')
  const copyUrl = () => {
    if (!path) return
    const absolute = `${window.location.origin}${path}`
    void navigator.clipboard?.writeText(absolute)
  }

  return (
    <section className={cn('w-full min-w-0 max-w-full rounded-lg border p-4', gdcUi.cardShell)}>
      <h3 className={cn('mb-2 text-sm font-semibold', gdcUi.textTitle)}>Webhook Receiver</h3>
      <p className={cn('mb-3 text-[12px]', gdcUi.textMuted)}>
        External systems POST JSON or NDJSON to this receiver. Events reuse mapping, enrichment, routes, and delivery logs.
      </p>
      <div className="grid w-full min-w-0 gap-3 md:grid-cols-2">
        <label className="space-y-1">
          <span className={cn('text-[11px] font-semibold', gdcUi.textMuted)}>Receiver URL</span>
          <div className="flex gap-2">
            <input
              readOnly
              value={path ? `${window.location.origin}${path}` : 'Generated after save'}
              className={cn('h-9 min-w-0 flex-1 font-mono text-[11px]', gdcUi.input)}
            />
            <button
              type="button"
              disabled={!path}
              onClick={copyUrl}
              className="h-9 rounded-md border border-slate-200 px-3 text-[11px] font-semibold text-slate-700 disabled:opacity-50 dark:border-gdc-border dark:text-slate-200"
            >
              Copy URL
            </button>
          </div>
        </label>
        <label className="space-y-1">
          <span className={cn('text-[11px] font-semibold', gdcUi.textMuted)}>Auth mode</span>
          <select
            value={authMode}
            onChange={(e) => set('webhook_auth_mode', e.target.value)}
            className={cn('h-9 w-full', gdcUi.input)}
          >
            <option value="no_auth">No auth</option>
            <option value="shared_secret_header">Shared secret header</option>
            <option value="bearer_token">Bearer token</option>
          </select>
        </label>
        {authMode === 'shared_secret_header' ? (
          <>
            <input
              aria-label="Shared secret header name"
              placeholder="Shared secret header name"
              value={form.webhook_auth_header_name ?? 'X-GDC-Webhook-Secret'}
              onChange={(e) => set('webhook_auth_header_name', e.target.value)}
              className={cn('h-9 w-full', gdcUi.input)}
            />
            <input
              aria-label="Shared secret"
              placeholder={sharedSecretConfigured ? 'Shared secret configured' : 'Shared secret *'}
              type="password"
              value={form.webhook_shared_secret ?? ''}
              onChange={(e) => set('webhook_shared_secret', e.target.value)}
              className={cn('h-9 w-full', gdcUi.input)}
            />
          </>
        ) : null}
        {authMode === 'bearer_token' ? (
          <input
            aria-label="Bearer token"
            placeholder={bearerTokenConfigured ? 'Bearer token configured' : 'Bearer token *'}
            type="password"
            value={form.webhook_bearer_token ?? ''}
            onChange={(e) => set('webhook_bearer_token', e.target.value)}
            className={cn('h-9 w-full', gdcUi.input)}
          />
        ) : null}
        <input
          aria-label="Max request bytes"
          type="number"
          min={1024}
          max={10 * 1024 * 1024}
          value={form.max_request_bytes ?? 1048576}
          onChange={(e) => set('max_request_bytes', Math.max(1024, Number(e.target.value || 1048576)))}
          className={cn('h-9 w-full', gdcUi.input)}
        />
        <textarea
          aria-label="Payload preview"
          placeholder='Payload preview, e.g. {"id":"evt-1","message":"hello"}'
          value={form.payload_preview ?? ''}
          onChange={(e) => set('payload_preview', e.target.value)}
          rows={6}
          className={cn('w-full font-mono text-[11px] md:col-span-2', gdcUi.input)}
        />
      </div>
    </section>
  )
}
