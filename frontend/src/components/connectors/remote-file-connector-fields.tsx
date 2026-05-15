import type { ConnectorWritePayload } from '../../api/gdcConnectors'
import { gdcUi } from '../../lib/gdc-ui-tokens'
import { cn } from '../../lib/utils'

type SetFn = <K extends keyof ConnectorWritePayload>(key: K, value: ConnectorWritePayload[K]) => void

const policies = ['strict', 'accept_new_for_dev_only', 'insecure_skip_verify'] as const

export function RemoteFileConnectorFields({
  form,
  set,
  passwordConfigured,
  privateKeyConfigured,
  passphraseConfigured,
}: {
  form: ConnectorWritePayload
  set: SetFn
  passwordConfigured: boolean
  privateKeyConfigured: boolean
  passphraseConfigured: boolean
}) {
  const inputCls = cn('h-9 w-full max-w-xl rounded-md border px-2.5 text-sm', gdcUi.input)
  const pol = String(form.known_hosts_policy ?? 'strict').toLowerCase()
  const insecure = pol === 'insecure_skip_verify'
  const acceptNew = pol === 'accept_new_for_dev_only'
  const proto = String(form.remote_file_protocol ?? 'sftp').toLowerCase()
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <p className={cn('text-[12px]', gdcUi.textMuted)}>
        <span className="font-semibold">SFTP</span> lists and reads files on the remote host.{' '}
        <span className="font-semibold">SFTP-compatible SCP mode</span> still uses SFTP for directory listing and metadata; file
        bytes are transferred with SCPClient (paramiko). This is not standalone RFC SCP directory polling.
      </p>
      <label className={cn('text-[12px] font-medium', gdcUi.textTitle)} htmlFor="remote-file-protocol">
        Protocol
        <select
          id="remote-file-protocol"
          className={cn('mt-1 block h-9 w-full max-w-xl', inputCls)}
          value={proto === 'scp' ? 'sftp_compatible_scp' : proto === 'sftp_compatible_scp' ? 'sftp_compatible_scp' : 'sftp'}
          onChange={(e) =>
            set('remote_file_protocol', e.target.value as ConnectorWritePayload['remote_file_protocol'])
          }
        >
          <option value="sftp">sftp</option>
          <option value="sftp_compatible_scp">sftp_compatible_scp (SFTP-compatible SCP mode)</option>
        </select>
      </label>
      <label className={cn('text-[12px] font-medium', gdcUi.textTitle)} htmlFor="remote-file-host">
        Host *
        <input
          id="remote-file-host"
          className={cn('mt-1', inputCls)}
          value={form.host ?? ''}
          onChange={(e) => set('host', e.target.value)}
        />
      </label>
      <label className={cn('text-[12px] font-medium', gdcUi.textTitle)} htmlFor="remote-file-port">
        Port
        <input
          id="remote-file-port"
          className={cn('mt-1 max-w-[120px]', inputCls)}
          type="number"
          min={1}
          max={65535}
          value={form.port ?? 22}
          onChange={(e) => set('port', Number.parseInt(e.target.value, 10) || 22)}
        />
      </label>
      <label className={cn('text-[12px] font-medium', gdcUi.textTitle)} htmlFor="remote-file-username">
        Username *
        <input
          id="remote-file-username"
          className={cn('mt-1', inputCls)}
          value={form.remote_username ?? ''}
          onChange={(e) => set('remote_username', e.target.value)}
        />
      </label>
      <label className={cn('text-[12px] font-medium', gdcUi.textTitle)} htmlFor="remote-file-password">
        Password {passwordConfigured ? <span className="text-gdc-muted">(leave mask to keep)</span> : null}
        <input
          id="remote-file-password"
          type="password"
          className={cn('mt-1', inputCls)}
          autoComplete="new-password"
          value={form.remote_password ?? ''}
          onChange={(e) => set('remote_password', e.target.value)}
          placeholder={passwordConfigured ? '********' : ''}
        />
      </label>
      <p className={cn('text-[11px]', gdcUi.textMuted)}>Provide password or private key (PEM), not both empty.</p>
      <label className={cn('text-[12px] font-medium', gdcUi.textTitle)} htmlFor="remote-file-private-key">
        Private key (PEM) {privateKeyConfigured ? <span className="text-gdc-muted">(masked when saved)</span> : null}
        <textarea
          id="remote-file-private-key"
          className={cn('mt-1 min-h-[120px] w-full font-mono text-[11px]', inputCls)}
          spellCheck={false}
          value={form.remote_private_key ?? ''}
          onChange={(e) => set('remote_private_key', e.target.value)}
          placeholder={privateKeyConfigured ? '********' : '-----BEGIN OPENSSH PRIVATE KEY-----'}
        />
      </label>
      <label className={cn('text-[12px] font-medium', gdcUi.textTitle)} htmlFor="remote-file-passphrase">
        Private key passphrase {passphraseConfigured ? <span className="text-gdc-muted">(optional)</span> : null}
        <input
          id="remote-file-passphrase"
          type="password"
          className={cn('mt-1', inputCls)}
          autoComplete="new-password"
          value={form.remote_private_key_passphrase ?? ''}
          onChange={(e) => set('remote_private_key_passphrase', e.target.value)}
          placeholder={passphraseConfigured ? '********' : ''}
        />
      </label>
      <label className={cn('text-[12px] font-medium', gdcUi.textTitle)} htmlFor="remote-known-hosts-policy">
        Known hosts policy
        <select
          id="remote-known-hosts-policy"
          className={cn('mt-1 block h-9 w-full max-w-md', inputCls)}
          value={policies.includes(pol as (typeof policies)[number]) ? pol : 'strict'}
          onChange={(e) => set('known_hosts_policy', e.target.value)}
        >
          <option value="strict">strict (recommended)</option>
          <option value="accept_new_for_dev_only">accept_new_for_dev_only</option>
          <option value="insecure_skip_verify">insecure_skip_verify (lab only)</option>
        </select>
      </label>
      {pol === 'strict' ? (
        <div className="rounded border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-800 dark:border-gdc-border dark:bg-gdc-section dark:text-slate-200">
          <p className="font-semibold">Strict mode</p>
          <p className="mt-1">
            The server host key must be present in <span className="font-mono">known_hosts_text</span> below and/or the
            system OpenSSH <span className="font-mono">known_hosts</span> file. To capture a key safely out-of-band, run on a
            trusted admin workstation (replace host/port/key type as needed):
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-slate-900 p-2 font-mono text-[10px] text-emerald-100">
            ssh-keyscan -p 22 example.host | sort -u
          </pre>
          <p className="mt-1 text-slate-600 dark:text-gdc-muted">Paste the resulting line(s) into Known hosts text.</p>
        </div>
      ) : null}
      {acceptNew ? (
        <p className="rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-100">
          accept_new_for_dev_only adds unseen host keys automatically. Use only in development; prefer strict + ssh-keyscan
          in shared or production-like environments.
        </p>
      ) : null}
      {insecure ? (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-[11px] text-red-900 dark:border-red-700/50 dark:bg-red-950/40 dark:text-red-100">
          insecure_skip_verify disables host key verification and is vulnerable to MITM. Use only in isolated lab
          environments. Never enable on production-facing connectors.
        </p>
      ) : null}
      <label className={cn('text-[12px] font-medium', gdcUi.textTitle)} htmlFor="remote-known-hosts-text">
        Known hosts text (optional)
        <textarea
          id="remote-known-hosts-text"
          className={cn('mt-1 min-h-[80px] w-full font-mono text-[11px]', inputCls)}
          spellCheck={false}
          value={form.known_hosts_text ?? ''}
          onChange={(e) => set('known_hosts_text', e.target.value)}
          placeholder="hostname ssh-ed25519 AAAA..."
        />
      </label>
      <label className={cn('text-[12px] font-medium', gdcUi.textTitle)} htmlFor="remote-connection-timeout">
        Connection timeout (seconds)
        <input
          id="remote-connection-timeout"
          className={cn('mt-1 max-w-[120px]', inputCls)}
          type="number"
          min={1}
          max={600}
          value={form.connection_timeout_seconds ?? 20}
          onChange={(e) => set('connection_timeout_seconds', Number.parseInt(e.target.value, 10) || 20)}
        />
      </label>
    </div>
  )
}
