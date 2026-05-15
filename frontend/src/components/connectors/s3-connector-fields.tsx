import { cn } from '../../lib/utils'
import { gdcUi } from '../../lib/gdc-ui-tokens'
import type { ConnectorWritePayload } from '../../api/gdcConnectors'

const inputCls = cn('h-9 w-full', gdcUi.input)

type SetFn = <K extends keyof ConnectorWritePayload>(key: K, value: ConnectorWritePayload[K]) => void

export type S3ConnectorFieldsProps = {
  form: ConnectorWritePayload
  set: SetFn
  secretConfigured?: boolean
}

export function S3ConnectorFields({ form, set, secretConfigured }: S3ConnectorFieldsProps) {
  return (
    <div className="space-y-4">
      <section className={cn('rounded-lg border p-4', gdcUi.cardShell)}>
        <h3 className={cn('mb-2 text-sm font-semibold', gdcUi.textTitle)}>S3 endpoint & bucket</h3>
        <p className={cn('mb-3 text-[11px] leading-relaxed', gdcUi.textMuted)}>
          <span className="font-semibold">MinIO (local):</span> path-style addressing is usually enabled and SSL is usually disabled. Example
          endpoint <code className="rounded bg-slate-100 px-1 dark:bg-gdc-elevated">http://127.0.0.1:9000</code>.{' '}
          <span className="font-semibold">AWS S3:</span> use <code className="rounded bg-slate-100 px-1 dark:bg-gdc-elevated">https://s3.amazonaws.com</code> (or a
          regional endpoint) and virtual-hosted style unless your setup requires path-style.
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          <label className={cn('block text-[12px] font-medium', gdcUi.textTitle)}>
            Endpoint URL *
            <input
              aria-label="S3 Endpoint URL"
              placeholder="http://127.0.0.1:9000"
              value={form.endpoint_url ?? ''}
              onChange={(e) => set('endpoint_url', e.target.value)}
              className={cn('mt-1', inputCls)}
            />
          </label>
          <label className={cn('block text-[12px] font-medium', gdcUi.textTitle)}>
            Bucket *
            <input
              aria-label="S3 Bucket"
              placeholder="gdc-test-logs"
              value={form.bucket ?? ''}
              onChange={(e) => set('bucket', e.target.value)}
              className={cn('mt-1', inputCls)}
            />
          </label>
          <label className={cn('block text-[12px] font-medium', gdcUi.textTitle)}>
            Region
            <input
              aria-label="S3 Region"
              placeholder="us-east-1"
              value={form.region ?? 'us-east-1'}
              onChange={(e) => set('region', e.target.value)}
              className={cn('mt-1', inputCls)}
            />
          </label>
          <label className={cn('block text-[12px] font-medium', gdcUi.textTitle)}>
            Prefix (optional)
            <input
              aria-label="S3 Prefix"
              placeholder="security/ or waf/"
              title="Examples: security/, waf/"
              value={form.prefix ?? ''}
              onChange={(e) => set('prefix', e.target.value)}
              className={cn('mt-1', inputCls)}
            />
          </label>
        </div>
      </section>

      <section className={cn('rounded-lg border p-4', gdcUi.cardShell)}>
        <h3 className={cn('mb-2 text-sm font-semibold', gdcUi.textTitle)}>Credentials</h3>
        <div className="grid gap-2 md:grid-cols-2">
          <label className={cn('block text-[12px] font-medium', gdcUi.textTitle)}>
            Access key *
            <input
              aria-label="S3 Access key"
              value={form.access_key ?? ''}
              onChange={(e) => set('access_key', e.target.value)}
              className={cn('mt-1', inputCls)}
            />
          </label>
          <label className={cn('block text-[12px] font-medium', gdcUi.textTitle)}>
            Secret key * {secretConfigured ? <span className="text-[10px] font-normal text-slate-500">(saved)</span> : null}
            <input
              aria-label="S3 Secret key"
              type="password"
              autoComplete="off"
              placeholder={secretConfigured ? '******** (unchanged if left as-is)' : 'Required'}
              value={form.secret_key ?? ''}
              onChange={(e) => set('secret_key', e.target.value)}
              className={cn('mt-1', inputCls)}
            />
          </label>
        </div>
      </section>

      <section className={cn('rounded-lg border p-4', gdcUi.cardShell)}>
        <h3 className={cn('mb-2 text-sm font-semibold', gdcUi.textTitle)}>Client behavior</h3>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <label className={cn('inline-flex items-center gap-2 text-sm', gdcUi.textTitle)}>
            <input
              type="checkbox"
              checked={form.path_style_access !== false}
              onChange={(e) => set('path_style_access', e.target.checked)}
            />
            Path-style addressing (recommended for MinIO)
          </label>
          <label className={cn('inline-flex items-center gap-2 text-sm', gdcUi.textTitle)}>
            <input type="checkbox" checked={form.use_ssl === true} onChange={(e) => set('use_ssl', e.target.checked)} />
            Use SSL (HTTPS)
          </label>
        </div>
      </section>
    </div>
  )
}
