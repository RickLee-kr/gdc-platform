import type { ConnectorWritePayload } from '../../api/gdcConnectors'
import { cn } from '../../lib/utils'
import { gdcUi } from '../../lib/gdc-ui-tokens'

type SetFn = <K extends keyof ConnectorWritePayload>(key: K, value: ConnectorWritePayload[K]) => void

export function DatabaseConnectorFields({ form, set }: { form: ConnectorWritePayload; set: SetFn }) {
  const inputCls = cn('h-9 w-full', gdcUi.input)
  return (
    <section className={cn('rounded-lg border p-4', gdcUi.cardShell)}>
      <h3 className={cn('mb-2 text-sm font-semibold', gdcUi.textTitle)}>Database connection</h3>
      <p className={cn('mb-3 text-[11px]', gdcUi.textMuted)}>
        Use a read-only database user when possible. Passwords are never returned on GET; store a new password to rotate.
      </p>
      <div className="grid gap-2 md:grid-cols-2">
        <label className="text-[12px] font-medium text-slate-700 dark:text-slate-200">
          DB type *
          <select
            value={form.db_type ?? 'POSTGRESQL'}
            onChange={(e) => set('db_type', e.target.value as ConnectorWritePayload['db_type'])}
            className={cn('mt-1', inputCls)}
          >
            <option value="POSTGRESQL">PostgreSQL</option>
            <option value="MYSQL">MySQL</option>
            <option value="MARIADB">MariaDB</option>
          </select>
        </label>
        <label className="text-[12px] font-medium text-slate-700 dark:text-slate-200">
          Host *
          <input
            aria-label="Database host"
            placeholder="e.g. 127.0.0.1"
            value={form.host ?? ''}
            onChange={(e) => set('host', e.target.value)}
            className={cn('mt-1', inputCls)}
          />
        </label>
        <label className="text-[12px] font-medium text-slate-700 dark:text-slate-200">
          Port
          <input
            aria-label="Database port"
            type="number"
            value={form.port ?? ''}
            onChange={(e) => set('port', e.target.value === '' ? undefined : Number.parseInt(e.target.value, 10))}
            className={cn('mt-1', inputCls)}
          />
        </label>
        <label className="text-[12px] font-medium text-slate-700 dark:text-slate-200">
          Database name *
          <input
            aria-label="Database name"
            value={form.database ?? ''}
            onChange={(e) => set('database', e.target.value)}
            className={cn('mt-1', inputCls)}
          />
        </label>
        <label className="text-[12px] font-medium text-slate-700 dark:text-slate-200">
          Username *
          <input
            aria-label="Database username"
            value={form.db_username ?? ''}
            onChange={(e) => set('db_username', e.target.value)}
            className={cn('mt-1', inputCls)}
          />
        </label>
        <label className="text-[12px] font-medium text-slate-700 dark:text-slate-200">
          Password *
          <input
            type="password"
            autoComplete="off"
            value={form.db_password ?? ''}
            onChange={(e) => set('db_password', e.target.value)}
            className={cn('mt-1', inputCls)}
          />
        </label>
        <label className="text-[12px] font-medium text-slate-700 dark:text-slate-200">
          SSL mode
          <select
            value={form.ssl_mode ?? 'PREFER'}
            onChange={(e) => set('ssl_mode', e.target.value)}
            className={cn('mt-1', inputCls)}
          >
            {['DISABLE', 'PREFER', 'REQUIRE', 'VERIFY_CA', 'VERIFY_FULL'].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[12px] font-medium text-slate-700 dark:text-slate-200">
          Connect timeout (seconds)
          <input
            type="number"
            min={1}
            max={600}
            value={form.connection_timeout_seconds ?? 15}
            onChange={(e) =>
              set('connection_timeout_seconds', e.target.value === '' ? undefined : Number.parseInt(e.target.value, 10))
            }
            className={cn('mt-1', inputCls)}
          />
        </label>
      </div>
    </section>
  )
}
