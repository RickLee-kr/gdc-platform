import { Loader2, Plus, RefreshCw, Trash2, Wifi } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  createRegistry,
  deleteRegistry,
  disableRegistry,
  fetchRegistries,
  testRegistryConnection,
  updateRegistry,
  type MarketplaceRegistryCreate,
  type MarketplaceRegistryRead,
} from '../../api/gdcMarketplaceRegistries'
import { cn } from '../../lib/utils'

type Draft = {
  name: string
  registry_type: 'private' | 'remote_public'
  base_url: string
  enabled: boolean
  authentication_reference: string
  bearer_token: string
  allowed_hosts: string
  allow_private_networks: boolean
}

const emptyDraft = (): Draft => ({
  name: '',
  registry_type: 'private',
  base_url: '',
  enabled: true,
  authentication_reference: '',
  bearer_token: '',
  allowed_hosts: '',
  allow_private_networks: false,
})

export function MarketplaceRegistriesPage() {
  const [rows, setRows] = useState<MarketplaceRegistryRead[]>([])
  const [remoteDefaultOff, setRemoteDefaultOff] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [showForm, setShowForm] = useState(false)
  const [testMessage, setTestMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchRegistries()
      setRows(res.registries)
      setRemoteDefaultOff(!res.remote_public_default_enabled)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function onCreate() {
    setBusyId('create')
    setError(null)
    try {
      const hosts = draft.allowed_hosts
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean)
      const payload: MarketplaceRegistryCreate = {
        name: draft.name.trim(),
        registry_type: draft.registry_type,
        base_url: draft.base_url.trim(),
        enabled: draft.registry_type === 'remote_public' ? draft.enabled : draft.enabled,
        authentication_reference: draft.authentication_reference.trim() || null,
        bearer_token: draft.bearer_token.trim() || null,
        network_policy: {
          allowed_hosts: hosts,
          allow_private_networks: draft.allow_private_networks,
        },
      }
      await createRegistry(payload)
      setDraft(emptyDraft())
      setShowForm(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  async function onDisable(id: string) {
    setBusyId(id)
    try {
      await disableRegistry(id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  async function onEnable(id: string) {
    setBusyId(id)
    try {
      await updateRegistry(id, { enabled: true })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  async function onDelete(id: string) {
    const ok = window.confirm(
      'Delete this registry configuration? Installed packages will NOT be uninstalled.',
    )
    if (!ok) return
    setBusyId(id)
    try {
      await deleteRegistry(id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  async function onTest(id: string) {
    setBusyId(id)
    setTestMessage(null)
    try {
      const res = await testRegistryConnection(id)
      setTestMessage(`${res.status}: ${res.message}`)
    } catch (e) {
      setTestMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="w-full min-w-0 space-y-5" data-testid="marketplace-registries-page">
      <div className="border-b border-slate-200/80 pb-4 dark:border-gdc-divider">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          Marketplace Registries
        </h2>
        <p className="mt-1 max-w-2xl text-[13px] text-slate-600 dark:text-gdc-muted">
          Configure private and remote package registries. Remote public registry defaults to OFF.
          Credentials are stored encrypted; plaintext tokens are never returned.
        </p>
        {remoteDefaultOff ? (
          <p
            className="mt-2 text-[12px] font-medium text-amber-800 dark:text-amber-200"
            data-testid="remote-registry-default-off"
          >
            Remote public registry default enabled = NO (no automatic fetch / background sync).
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="registry-refresh"
          onClick={() => void load()}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-700 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Refresh
        </button>
        <button
          type="button"
          data-testid="registry-add"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900 px-3 text-[12px] font-semibold text-white dark:border-slate-200 dark:bg-slate-100 dark:text-slate-900"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add registry
        </button>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 p-2 text-[12px] text-red-700" data-testid="registry-error">
          {error}
        </p>
      ) : null}
      {testMessage ? (
        <p className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[12px]" data-testid="registry-test-message">
          {testMessage}
        </p>
      ) : null}

      {showForm ? (
        <div
          className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-gdc-border dark:bg-gdc-card"
          data-testid="registry-create-form"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-[12px]">
              Name
              <input
                data-testid="registry-name-input"
                className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 dark:border-gdc-border dark:bg-gdc-elevated"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </label>
            <label className="text-[12px]">
              Type
              <select
                data-testid="registry-type-input"
                className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 dark:border-gdc-border dark:bg-gdc-elevated"
                value={draft.registry_type}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    registry_type: e.target.value as 'private' | 'remote_public',
                    enabled: e.target.value === 'private',
                  }))
                }
              >
                <option value="private">Private</option>
                <option value="remote_public">Remote public</option>
              </select>
            </label>
            <label className="text-[12px] sm:col-span-2">
              Base URL
              <input
                data-testid="registry-base-url-input"
                className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 dark:border-gdc-border dark:bg-gdc-elevated"
                value={draft.base_url}
                onChange={(e) => setDraft((d) => ({ ...d, base_url: e.target.value }))}
                placeholder="https://registry.example.com"
              />
            </label>
            <label className="text-[12px]">
              Auth reference (opaque)
              <input
                data-testid="registry-auth-ref-input"
                className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 dark:border-gdc-border dark:bg-gdc-elevated"
                value={draft.authentication_reference}
                onChange={(e) => setDraft((d) => ({ ...d, authentication_reference: e.target.value }))}
                placeholder="credential:env:REGISTRY_TOKEN"
              />
            </label>
            <label className="text-[12px]">
              Bearer token (write-only, encrypted)
              <input
                data-testid="registry-bearer-input"
                type="password"
                className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 dark:border-gdc-border dark:bg-gdc-elevated"
                value={draft.bearer_token}
                onChange={(e) => setDraft((d) => ({ ...d, bearer_token: e.target.value }))}
                autoComplete="off"
              />
            </label>
            <label className="text-[12px] sm:col-span-2">
              Host allowlist (comma-separated)
              <input
                data-testid="registry-allowlist-input"
                className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 dark:border-gdc-border dark:bg-gdc-elevated"
                value={draft.allowed_hosts}
                onChange={(e) => setDraft((d) => ({ ...d, allowed_hosts: e.target.value }))}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-[12px]">
            <input
              type="checkbox"
              data-testid="registry-allow-private"
              checked={draft.allow_private_networks}
              onChange={(e) => setDraft((d) => ({ ...d, allow_private_networks: e.target.checked }))}
            />
            Allow private networks for allowlisted hosts (private registries)
          </label>
          {draft.registry_type === 'remote_public' ? (
            <label className="flex items-center gap-2 text-[12px]">
              <input
                type="checkbox"
                data-testid="registry-enabled-input"
                checked={draft.enabled}
                onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
              />
              Explicitly enable remote public registry (default OFF)
            </label>
          ) : null}
          <button
            type="button"
            data-testid="registry-create-submit"
            disabled={busyId === 'create' || !draft.name.trim() || !draft.base_url.trim()}
            onClick={() => void onCreate()}
            className="inline-flex h-8 items-center rounded-md bg-slate-900 px-3 text-[12px] font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            {busyId === 'create' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            Create
          </button>
        </div>
      ) : null}

      {loading ? (
        <p data-testid="registry-loading" className="text-[12px] text-slate-500">
          Loading registries…
        </p>
      ) : rows.length === 0 ? (
        <p data-testid="registry-empty" className="text-[12px] text-slate-500">
          No registries configured.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="registry-list">
          {rows.map((row) => (
            <li
              key={row.id}
              data-testid={`registry-row-${row.id}`}
              className="rounded-lg border border-slate-200 bg-white p-3 dark:border-gdc-border dark:bg-gdc-card"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-50">{row.name}</p>
                  <p className="text-[11px] text-slate-500">
                    {row.registry_type} · {row.base_url}
                  </p>
                  <p className="mt-1 text-[11px]">
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 font-medium',
                        row.enabled
                          ? 'bg-emerald-500/10 text-emerald-700'
                          : 'bg-slate-200 text-slate-600',
                      )}
                      data-testid={`registry-enabled-${row.id}`}
                    >
                      {row.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    {row.has_auth_secret ? (
                      <span className="ml-2 text-slate-500" data-testid={`registry-has-secret-${row.id}`}>
                        auth secret present
                      </span>
                    ) : null}
                    {row.authentication_reference ? (
                      <span className="ml-2 text-slate-500">ref: {row.authentication_reference}</span>
                    ) : null}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    data-testid={`registry-test-${row.id}`}
                    disabled={busyId === row.id}
                    onClick={() => void onTest(row.id)}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 px-2 text-[11px] font-semibold"
                  >
                    <Wifi className="h-3 w-3" aria-hidden />
                    Test
                  </button>
                  {row.enabled ? (
                    <button
                      type="button"
                      data-testid={`registry-disable-${row.id}`}
                      disabled={busyId === row.id}
                      onClick={() => void onDisable(row.id)}
                      className="inline-flex h-7 items-center rounded-md border border-slate-200 px-2 text-[11px] font-semibold"
                    >
                      Disable
                    </button>
                  ) : (
                    <button
                      type="button"
                      data-testid={`registry-enable-${row.id}`}
                      disabled={busyId === row.id}
                      onClick={() => void onEnable(row.id)}
                      className="inline-flex h-7 items-center rounded-md border border-slate-200 px-2 text-[11px] font-semibold"
                    >
                      Enable
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid={`registry-delete-${row.id}`}
                    disabled={busyId === row.id}
                    onClick={() => void onDelete(row.id)}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-red-200 px-2 text-[11px] font-semibold text-red-700"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden />
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
