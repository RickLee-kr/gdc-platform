import type { ConnectorWritePayload } from '../../api/gdcConnectors'
import { formatAuthHealthCheckStatus } from '../../lib/connector-operational-health'

const AUTH_HEALTH_OPTIONS = [
  { value: 'disabled', label: 'Disabled' },
  { value: '15m', label: 'Every 15 minutes' },
  { value: '1h', label: 'Every 1 hour' },
  { value: '6h', label: 'Every 6 hours' },
  { value: '24h', label: 'Every 24 hours' },
] as const

type AuthHealthCheckFieldsProps = {
  value: ConnectorWritePayload['auth_health_check_interval']
  onChange: (value: NonNullable<ConnectorWritePayload['auth_health_check_interval']>) => void
}

export function AuthHealthCheckFields({ value, onChange }: AuthHealthCheckFieldsProps) {
  const selected = value ?? 'disabled'
  const status = formatAuthHealthCheckStatus(selected)

  return (
    <fieldset className="space-y-3">
      <legend className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">Auth Health Check</legend>
      <p className="text-[11px] leading-relaxed text-slate-500 dark:text-gdc-muted">
        Interval preference is saved for future scheduler support. Checks run only when you use{' '}
        <span className="font-semibold">Test Auth</span> on the Connectors dashboard or connector detail page.
      </p>
      <div className="flex flex-col gap-1.5">
        {AUTH_HEALTH_OPTIONS.map((opt) => (
          <label key={opt.value} className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-slate-700 dark:text-slate-200">
            <input
              type="radio"
              name="auth-health-check-interval"
              checked={selected === opt.value}
              onChange={() => onChange(opt.value)}
            />
            {opt.label}
          </label>
        ))}
      </div>
      <div
        className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] dark:border-gdc-border dark:bg-gdc-elevated/40"
        data-testid="auth-health-check-status"
      >
        <p className="text-slate-700 dark:text-slate-200">
          <span className="font-semibold">Configured:</span> {status.configured}
        </p>
        <p className="mt-0.5 text-slate-600 dark:text-gdc-muted">
          <span className="font-semibold">Execution:</span> {status.execution}
        </p>
        <p className="mt-1 text-[10px] text-amber-800 dark:text-amber-200/90">Auth check scheduler: Not enabled</p>
      </div>
    </fieldset>
  )
}
