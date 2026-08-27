import { AlertTriangle, CheckCircle2, Download, Loader2, ShieldAlert, Upload } from 'lucide-react'
import { useCallback, useState } from 'react'
import {
  applyPromotion,
  exportPromotionBundle,
  previewPromotion,
  type EnvironmentName,
  type PromotionMode,
  type PromotionPreviewResponse,
} from '../../api/gdcEnvironmentPromotion'
import { cn } from '../../lib/utils'
import { useSessionCapabilities } from '../../lib/rbac'

const ENV_OPTIONS: EnvironmentName[] = ['development', 'staging', 'production']

export type EnvironmentPromotionPanelProps = {
  className?: string
}

export function EnvironmentPromotionPanel({ className }: EnvironmentPromotionPanelProps) {
  const caps = useSessionCapabilities()
  const canPreview = caps.environment_promotion_preview === true || caps.backup_import_preview === true
  const canApply = caps.environment_promotion_apply === true || caps.backup_import_apply === true

  const [sourceEnv, setSourceEnv] = useState<EnvironmentName>('development')
  const [targetEnv, setTargetEnv] = useState<EnvironmentName>('staging')
  const [mode, setMode] = useState<PromotionMode>('additive')
  const [jsonText, setJsonText] = useState('')
  const [preview, setPreview] = useState<PromotionPreviewResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [applyBusy, setApplyBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [confirmApply, setConfirmApply] = useState(false)
  const [confirmDestructive, setConfirmDestructive] = useState(false)

  const onExport = useCallback(async () => {
    if (!canPreview) return
    setError(null)
    setInfo(null)
    setBusy(true)
    try {
      const res = await exportPromotionBundle({
        source_environment: sourceEnv,
        include_destinations: true,
      })
      const text = JSON.stringify(res.bundle, null, 2)
      setJsonText(text)
      setPreview(null)
      const blob = new Blob([text], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `gdc-promotion-${sourceEnv}.json`
      a.click()
      URL.revokeObjectURL(url)
      setInfo(
        `Promotion bundle exported for ${sourceEnv} (secrets and checkpoints excluded). Fingerprint ${res.target_fingerprint.slice(0, 12)}…`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [canPreview, sourceEnv])

  const onPickFile = useCallback((file: File | null) => {
    if (!file) return
    void file.text().then((t) => {
      setJsonText(t)
      setPreview(null)
      setConfirmApply(false)
      setConfirmDestructive(false)
      setError(null)
    })
  }, [])

  const onPreview = useCallback(async () => {
    if (!canPreview) return
    setError(null)
    setInfo(null)
    setBusy(true)
    try {
      const bundle = JSON.parse(jsonText || '{}') as unknown
      const res = await previewPromotion({
        source_environment: sourceEnv,
        target_environment: targetEnv,
        bundle,
        mode,
      })
      setPreview(res)
      setConfirmApply(false)
      setConfirmDestructive(false)
    } catch (e) {
      setPreview(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [canPreview, jsonText, mode, sourceEnv, targetEnv])

  const onApply = useCallback(async () => {
    if (!canApply || !preview) return
    if (!confirmApply) {
      setError('Enable confirmation before applying promotion.')
      return
    }
    if (mode === 'full_restore' && !confirmDestructive) {
      setError('Acknowledge destructive full-restore promotion before applying.')
      return
    }
    setError(null)
    setApplyBusy(true)
    try {
      const bundle = JSON.parse(jsonText || '{}') as unknown
      const res = await applyPromotion({
        source_environment: sourceEnv,
        target_environment: targetEnv,
        bundle,
        mode,
        promotion_token: preview.promotion_token,
        target_fingerprint: preview.target_fingerprint,
        confirm: true,
        confirm_destructive: mode === 'full_restore' ? confirmDestructive : false,
      })
      if (res.no_op) {
        setInfo('No configuration differences to promote.')
      } else {
        setInfo(
          `Promotion applied (${sourceEnv} → ${targetEnv}). Created ${res.created_stream_ids.length} stream(s), ${res.created_connector_ids.length} connector(s).`,
        )
      }
      setPreview(res.preview)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setApplyBusy(false)
    }
  }, [canApply, confirmApply, confirmDestructive, jsonText, mode, preview, sourceEnv, targetEnv])

  return (
    <section
      aria-label="Environment promotion"
      data-testid="environment-promotion-panel"
      className={cn(
        'rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card',
        className,
      )}
    >
      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
          GitOps
        </p>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Environment promotion</h3>
        <p className="max-w-3xl text-[12px] text-slate-600 dark:text-gdc-muted">
          Promote non-secret configuration Development → Staging → Production. Preview shows diff, impact, and
          blocking issues. Apply reuses the existing import path. Credentials and checkpoints are never promoted.
        </p>
      </div>

      {error ? (
        <p
          className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          role="alert"
          data-testid="environment-promotion-error"
        >
          {error}
        </p>
      ) : null}
      {info ? (
        <p
          className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
          data-testid="environment-promotion-info"
        >
          {info}
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-[12px] text-slate-700 dark:text-gdc-mutedStrong">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Source</span>
          <select
            value={sourceEnv}
            onChange={(e) => setSourceEnv(e.target.value as EnvironmentName)}
            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-[12px] dark:border-gdc-border dark:bg-gdc-section"
            data-testid="environment-promotion-source"
          >
            {ENV_OPTIONS.map((env) => (
              <option key={env} value={env}>
                {env}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[12px] text-slate-700 dark:text-gdc-mutedStrong">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Target</span>
          <select
            value={targetEnv}
            onChange={(e) => setTargetEnv(e.target.value as EnvironmentName)}
            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-[12px] dark:border-gdc-border dark:bg-gdc-section"
            data-testid="environment-promotion-target"
          >
            {ENV_OPTIONS.map((env) => (
              <option key={env} value={env}>
                {env}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[12px] text-slate-700 dark:text-gdc-mutedStrong">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Mode</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as PromotionMode)}
            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-[12px] dark:border-gdc-border dark:bg-gdc-section"
            data-testid="environment-promotion-mode"
          >
            <option value="additive">Additive (merge)</option>
            <option value="full_restore">Full restore (replace)</option>
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !canPreview}
          onClick={() => void onExport()}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-200"
          data-testid="environment-promotion-export"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
          Export GitOps bundle
        </button>
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-200">
          <Upload className="h-4 w-4" aria-hidden />
          Load bundle
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            data-testid="environment-promotion-file"
          />
        </label>
        <button
          type="button"
          disabled={busy || !canPreview || !jsonText.trim()}
          onClick={() => void onPreview()}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white shadow-sm hover:bg-violet-700 disabled:opacity-60"
          data-testid="environment-promotion-preview"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Preview promotion
        </button>
      </div>

      <textarea
        value={jsonText}
        onChange={(e) => {
          setJsonText(e.target.value)
          setPreview(null)
        }}
        rows={6}
        placeholder="Paste a promotion / GitOps JSON bundle here, or export/load one above."
        className="mt-3 w-full rounded-md border border-slate-200 bg-slate-50/80 p-2 font-mono text-[11px] text-slate-800 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-200"
        data-testid="environment-promotion-json"
      />

      {preview ? (
        <div className="mt-4 space-y-3" data-testid="environment-promotion-preview-body">
          <div
            className={cn(
              'flex items-start gap-2 rounded-md border px-2.5 py-2 text-[11px]',
              preview.can_promote
                ? 'border-emerald-200/80 bg-emerald-50/70 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100'
                : 'border-red-200/80 bg-red-50/70 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100',
            )}
            data-testid="environment-promotion-status"
          >
            {preview.can_promote ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : (
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
            <div>
              <p className="font-semibold">
                {preview.can_promote
                  ? preview.has_changes
                    ? 'Eligible to promote'
                    : 'No changes (no-op)'
                  : 'Promotion blocked'}
              </p>
              <p className="mt-0.5 opacity-90">
                {preview.source_environment} → {preview.target_environment} · fingerprint{' '}
                {preview.target_fingerprint.slice(0, 12)}…
                {preview.stale_target ? ' · stale target' : ''}
              </p>
            </div>
          </div>

          {preview.changed_fields.length > 0 ? (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                What differs
              </p>
              <ul className="mt-1 space-y-1" data-testid="environment-promotion-diff">
                {preview.changed_fields.slice(0, 12).map((change) => (
                  <li
                    key={`${change.entity_type}:${change.entity_name}:${change.path}:${change.change}`}
                    className="text-[11px] text-slate-700 dark:text-slate-200"
                  >
                    <span className="font-medium">
                      {change.entity_type}/{change.entity_name}
                    </span>{' '}
                    · {change.path} ({change.change})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="text-[11px] text-slate-700 dark:text-slate-200" data-testid="environment-promotion-affected">
            Affected: {preview.affected.connectors} connector(s), {preview.affected.streams} stream(s),{' '}
            {preview.affected.routes} route(s), {preview.affected.destinations} destination(s)
          </p>

          {preview.blocking_issues.length > 0 ? (
            <div data-testid="environment-promotion-blocking">
              <p className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                Blocking
              </p>
              <ul className="mt-1 space-y-1">
                {preview.blocking_issues.map((issue) => (
                  <li key={`${issue.code}:${issue.message}`} className="text-[11px] text-red-800 dark:text-red-200">
                    {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.warnings.length > 0 ? (
            <div data-testid="environment-promotion-warnings">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                Warnings
              </p>
              <ul className="mt-1 space-y-1">
                {preview.warnings.map((issue) => (
                  <li key={`${issue.code}:${issue.message}`} className="text-[11px] text-amber-900 dark:text-amber-100">
                    {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {canApply ? (
            <div className="space-y-2 border-t border-slate-200/80 pt-3 dark:border-gdc-border">
              <label className="flex items-center gap-2 text-[12px] text-slate-700 dark:text-gdc-mutedStrong">
                <input
                  type="checkbox"
                  checked={confirmApply}
                  onChange={(e) => setConfirmApply(e.target.checked)}
                  data-testid="environment-promotion-confirm"
                />
                I reviewed the promotion preview and want to apply via the existing import path.
              </label>
              {mode === 'full_restore' ? (
                <label className="flex items-center gap-2 text-[12px] text-red-800 dark:text-red-200">
                  <input
                    type="checkbox"
                    checked={confirmDestructive}
                    onChange={(e) => setConfirmDestructive(e.target.checked)}
                    data-testid="environment-promotion-confirm-destructive"
                  />
                  I understand full restore replaces operational configuration on the target.
                </label>
              ) : null}
              <button
                type="button"
                disabled={applyBusy || !preview.can_promote || !confirmApply}
                onClick={() => void onApply()}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-700 px-3 text-[12px] font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                data-testid="environment-promotion-apply"
              >
                {applyBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                Apply promotion
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 dark:text-gdc-muted">
              Promotion apply requires the Administrator role.
            </p>
          )}
        </div>
      ) : null}
    </section>
  )
}
