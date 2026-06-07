import { Loader2, RefreshCw, Shield } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  fetchStreamProtectionRules,
  fetchStreamProtectionSummary,
  patchProtectionRule,
  type ProtectionMode,
  type ProtectionRule,
  type StreamProtectionSummaryResponse,
} from '../../api/gdcProtection'
import { cn } from '../../lib/utils'
import { opTable, opTd, opTh, opThRow, opTr } from '../dashboard/widgets/operational-table-styles'

const MODES: ProtectionMode[] = ['full_mask', 'partial_mask', 'hash', 'tokenization']

function modeLabel(mode: string): string {
  switch (mode) {
    case 'full_mask':
      return 'Full mask'
    case 'partial_mask':
      return 'Partial mask'
    case 'hash':
      return 'Hash'
    case 'tokenization':
      return 'Tokenization'
    default:
      return mode
  }
}

export function ProtectionPanel({
  streamId,
  canOperate,
}: {
  streamId: number
  canOperate: boolean
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<StreamProtectionSummaryResponse | null>(null)
  const [rules, setRules] = useState<ProtectionRule[]>([])
  const [actionBusy, setActionBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, r] = await Promise.all([
        fetchStreamProtectionSummary(streamId),
        fetchStreamProtectionRules(streamId),
      ])
      setSummary(s)
      setRules(r?.rules ?? [])
      if (s == null && r == null) {
        setError('Protection APIs unavailable.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [streamId])

  useEffect(() => {
    void load()
  }, [load])

  async function onToggleEnabled(rule: ProtectionRule) {
    if (!canOperate) return
    setActionBusy(true)
    setMessage(null)
    try {
      await patchProtectionRule(streamId, rule.id, { enabled: !rule.enabled })
      setMessage('Rule updated.')
      await load()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setActionBusy(false)
    }
  }

  async function onModeChange(rule: ProtectionRule, mode: ProtectionMode) {
    if (!canOperate || rule.protection_mode === mode) return
    setActionBusy(true)
    setMessage(null)
    try {
      await patchProtectionRule(streamId, rule.id, { protection_mode: mode })
      setMessage('Mode updated.')
      await load()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setActionBusy(false)
    }
  }

  const protectionOn = summary?.protection_enabled ?? true

  return (
    <section
      className="rounded-xl border border-slate-200/90 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card"
      aria-label="Protection"
      data-testid="protection-summary"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-900 dark:text-slate-100">
          <Shield className="h-4 w-4 text-indigo-600 dark:text-indigo-400" aria-hidden />
          Protection
        </p>
        <button
          type="button"
          disabled={loading}
          onClick={() => void load()}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200/90 px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-gdc-border dark:text-slate-200 dark:hover:bg-gdc-rowHover"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RefreshCw className="h-3 w-3" aria-hidden />}
          Refresh
        </button>
      </div>

      {!protectionOn ? (
        <p className="mt-2 text-[11px] text-slate-500 dark:text-gdc-muted" role="status">
          Protection engine disabled (GDC_PROTECTION_ENABLED=false)
        </p>
      ) : null}

      {error ? (
        <p className="mt-2 text-[11px] text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mt-2 text-[11px] font-medium text-emerald-800 dark:text-emerald-200" role="status">
          {message}
        </p>
      ) : null}

      <p className="mt-3 text-[11px] font-semibold text-slate-700 dark:text-slate-200">Protection metrics</p>
      <dl className="mt-1 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4" data-testid="protection-metrics">
        <div>
          <dt className="text-slate-500 dark:text-gdc-muted">Protection rules</dt>
          <dd className="font-semibold text-slate-900 dark:text-slate-100">
            {summary?.protection_rules ?? summary?.total_rules ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-gdc-muted">Protected events</dt>
          <dd className="font-semibold text-slate-900 dark:text-slate-100">
            {summary?.protected_events ?? summary?.total_protected_events ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-gdc-muted">Protected fields</dt>
          <dd className="font-semibold text-slate-900 dark:text-slate-100">
            {summary?.protected_fields ?? summary?.total_protected_fields ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-gdc-muted">Last protected</dt>
          <dd className="font-semibold text-slate-900 dark:text-slate-100">
            {summary?.last_protected_at
              ? new Date(summary.last_protected_at).toLocaleString()
              : '—'}
          </dd>
        </div>
      </dl>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-5">
        <div>
          <dt className="text-slate-500 dark:text-gdc-muted">Enabled rules</dt>
          <dd className="font-semibold text-slate-900 dark:text-slate-100">{summary?.enabled_rule_count ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-gdc-muted">Full mask</dt>
          <dd className="font-semibold text-slate-900 dark:text-slate-100">{summary?.full_mask_count ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-gdc-muted">Partial mask</dt>
          <dd className="font-semibold text-slate-900 dark:text-slate-100">{summary?.partial_mask_count ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-gdc-muted">Hash</dt>
          <dd className="font-semibold text-slate-900 dark:text-slate-100">{summary?.hash_count ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-gdc-muted">Disabled</dt>
          <dd className="font-semibold text-slate-900 dark:text-slate-100">{summary?.disabled_rule_count ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-gdc-muted">Tokenization</dt>
          <dd className="font-semibold text-slate-900 dark:text-slate-100">{summary?.tokenization_count ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-gdc-muted">Vault entries</dt>
          <dd className="font-semibold text-slate-900 dark:text-slate-100" data-testid="protection-vault-entries">
            {summary?.vault_entry_count ?? '—'}
          </dd>
        </div>
      </dl>

      <div className="mt-3 overflow-x-auto" data-testid="protection-rules-table">
        <table className={opTable}>
          <thead>
            <tr className={opThRow}>
              <th className={opTh}>Path</th>
              <th className={opTh}>Class</th>
              <th className={opTh}>Mode</th>
              <th className={opTh}>Enabled</th>
              {canOperate ? <th className={opTh}>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr className={opTr}>
                <td
                  className={cn(opTd, 'text-slate-500 dark:text-gdc-muted')}
                  colSpan={canOperate ? 5 : 4}
                >
                  {loading ? 'Loading…' : 'No protection rules.'}
                </td>
              </tr>
            ) : (
              rules.map((rule) => (
                <tr key={rule.id} className={opTr} data-testid={`protection-rule-row-${rule.id}`}>
                  <td className={cn(opTd, 'font-mono text-[10px]')}>{rule.field_path}</td>
                  <td className={opTd}>{rule.sensitivity_class}</td>
                  <td className={opTd}>
                    {canOperate ? (
                      <select
                        className="rounded border border-slate-200/90 bg-white px-1 py-0.5 text-[10px] dark:border-gdc-border dark:bg-gdc-card"
                        value={rule.protection_mode}
                        disabled={actionBusy}
                        onChange={(e) => void onModeChange(rule, e.target.value as ProtectionMode)}
                      >
                        {MODES.map((m) => (
                          <option key={m} value={m}>
                            {modeLabel(m)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      modeLabel(rule.protection_mode)
                    )}
                  </td>
                  <td className={opTd}>{rule.enabled ? 'Yes' : 'No'}</td>
                  {canOperate ? (
                    <td className={opTd}>
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => void onToggleEnabled(rule)}
                        className="rounded border border-slate-200/90 px-2 py-0.5 text-[10px] font-semibold hover:bg-slate-50 disabled:opacity-50 dark:border-gdc-border dark:hover:bg-gdc-rowHover"
                      >
                        {rule.enabled ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
