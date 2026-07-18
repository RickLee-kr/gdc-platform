import type { APIRequestContext } from '@playwright/test'
import type { LabEnv } from './scenario-types'

const SENSITIVE_KEYS = new Set([
  'password',
  'secret',
  'token',
  'api_key',
  'apikey',
  'authorization',
  'cookie',
  'private_key',
  'secret_key',
  'access_key',
  'bearer_token',
  'db_password',
  'remote_password',
  'remote_private_key',
])

export function loadLabEnv(): LabEnv {
  const routeRaw = (process.env.GDC_ROUTE_PROCESSING_ENABLED ?? 'false').trim().toLowerCase()
  const routeProcessingEnabled = routeRaw === 'true' || routeRaw === '1' || routeRaw === 'on'
  return {
    apiBaseUrl: (process.env.PLAYWRIGHT_API_BASE_URL || process.env.GDC_E2E_API_BASE_URL || 'http://127.0.0.1:18000').replace(
      /\/$/,
      '',
    ),
    uiBaseUrl: (process.env.PLAYWRIGHT_BASE_URL || process.env.GDC_E2E_UI_BASE_URL || 'http://127.0.0.1:4173').replace(
      /\/$/,
      '',
    ),
    wiremockBaseUrl: (process.env.WIREMOCK_BASE_URL || 'http://127.0.0.1:28080').replace(/\/$/, ''),
    webhookCollectorUrl: (process.env.GDC_E2E_WEBHOOK_COLLECTOR_URL || 'http://127.0.0.1:18192').replace(/\/$/, ''),
    syslogCollectorApiUrl: (process.env.GDC_E2E_SYSLOG_COLLECTOR_API_URL || 'http://127.0.0.1:18193').replace(/\/$/, ''),
    syslogHost: process.env.GDC_E2E_SYSLOG_COLLECTOR_HOST || '127.0.0.1',
    syslogPort: Number(process.env.GDC_E2E_SYSLOG_COLLECTOR_PORT || 15614),
    syslogTlsPort: Number(process.env.GDC_E2E_SYSLOG_TLS_PORT || 16614),
    namePrefix: process.env.GDC_E2E_NAME_PREFIX || '[FULL E2E]',
    routeProcessingEnabled,
    requireAuth: (process.env.REQUIRE_AUTH || 'false').toLowerCase() === 'true',
    minioEndpoint: process.env.SOURCE_E2E_MINIO_ENDPOINT || 'http://127.0.0.1:59000',
    minioAccessKey: process.env.SOURCE_E2E_MINIO_ACCESS_KEY || 'gdcminioaccess',
    minioSecretKey: process.env.SOURCE_E2E_MINIO_SECRET_KEY || 'gdcminioaccesssecret12',
    minioBucket: process.env.SOURCE_E2E_MINIO_BUCKET || 'gdc-full-e2e',
    pgFixtureUrl:
      process.env.SOURCE_E2E_PG_FIXTURE_URL ||
      'postgresql://gdc_fixture:gdc_fixture_pw@127.0.0.1:55433/gdc_query_fixture',
    sftpHost: process.env.SOURCE_E2E_SFTP_HOST || '127.0.0.1',
    sftpPort: Number(process.env.SOURCE_E2E_SFTP_PORT || 22222),
    sftpUser: process.env.SOURCE_E2E_SFTP_USER || 'gdc',
    sftpPassword: process.env.SOURCE_E2E_SFTP_PASSWORD || 'devlab123',
  }
}

export function maskSecrets<T>(value: T): T {
  return maskValue(value) as T
}

function maskValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskValue)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase()) || /password|secret|token|api[_-]?key|authorization|cookie|private[_-]?key/i.test(k)) {
        out[k] = typeof v === 'string' && v.length === 0 ? '' : '********'
      } else {
        out[k] = maskValue(v)
      }
    }
    return out
  }
  return value
}

export class FixtureClient {
  private _disposed = false

  constructor(
    readonly env: LabEnv,
    private request: APIRequestContext,
  ) {}

  bindRequest(request: APIRequestContext): void {
    this.request = request
    this._disposed = false
  }

  markDisposed(): void {
    this._disposed = true
  }

  private assertRequestAlive(): void {
    if (this._disposed) {
      throw Object.assign(new Error('Request context disposed'), { classification: 'TEST_INFRA' })
    }
  }

  async ensureSyslogTlsReady(timeoutMs = 30_000): Promise<void> {
    this.assertRequestAlive()
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const ready = await this.request.get(`${this.env.syslogCollectorApiUrl}/ready/tls`)
        if (ready.ok()) {
          const body = (await ready.json().catch(() => ({}))) as { tls_ready?: boolean; ok?: boolean }
          if (body.tls_ready === true || body.ok === true) return
        }
        const health = await this.request.get(`${this.env.syslogCollectorApiUrl}/health`)
        if (health.ok()) {
          const body = (await health.json().catch(() => ({}))) as { tls_ready?: boolean }
          if (body.tls_ready === true) return
        }
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 400))
    }
    throw Object.assign(new Error('syslog TLS collector not ready'), { classification: 'DESTINATION_FIXTURE' })
  }

  async resetCollectors(): Promise<void> {
    this.assertRequestAlive()
    const wh = await this.request.post(`${this.env.webhookCollectorUrl}/reset`)
    if (!wh.ok()) throw new Error(`webhook collector reset failed: ${wh.status()}`)
    const sy = await this.request.post(`${this.env.syslogCollectorApiUrl}/reset`)
    if (!sy.ok()) throw new Error(`syslog collector reset failed: ${sy.status()}`)
  }

  async listWebhookMessages(limit = 200): Promise<unknown[]> {
    const res = await this.request.get(`${this.env.webhookCollectorUrl}/messages?limit=${limit}`)
    if (!res.ok()) throw new Error(`webhook list failed: ${res.status()}`)
    const body = (await res.json()) as { messages?: unknown[] }
    return body.messages ?? []
  }

  async getWebhookByCorrelation(correlationId: string): Promise<unknown[]> {
    const res = await this.request.get(
      `${this.env.webhookCollectorUrl}/messages/by-correlation/${encodeURIComponent(correlationId)}`,
    )
    if (!res.ok()) throw new Error(`webhook by-correlation failed: ${res.status()}`)
    const body = (await res.json()) as { messages?: unknown[] }
    return body.messages ?? []
  }

  async countWebhook(): Promise<number> {
    const res = await this.request.get(`${this.env.webhookCollectorUrl}/count`)
    if (!res.ok()) throw new Error(`webhook count failed: ${res.status()}`)
    const body = (await res.json()) as { count?: number }
    return Number(body.count ?? 0)
  }

  async listSyslogMessages(opts?: { protocol?: string; limit?: number }): Promise<unknown[]> {
    const q = new URLSearchParams()
    if (opts?.protocol) q.set('protocol', opts.protocol)
    q.set('limit', String(opts?.limit ?? 200))
    const res = await this.request.get(`${this.env.syslogCollectorApiUrl}/messages?${q.toString()}`)
    if (!res.ok()) throw new Error(`syslog list failed: ${res.status()}`)
    const body = (await res.json()) as { messages?: unknown[] }
    return body.messages ?? []
  }

  async getSyslogByCorrelation(correlationId: string, opts?: { protocol?: string }): Promise<unknown[]> {
    this.assertRequestAlive()
    const q = opts?.protocol ? `?protocol=${encodeURIComponent(opts.protocol)}` : ''
    const res = await this.request.get(
      `${this.env.syslogCollectorApiUrl}/messages/by-correlation/${encodeURIComponent(correlationId)}${q}`,
    )
    if (!res.ok()) throw new Error(`syslog by-correlation failed: ${res.status()}`)
    const body = (await res.json()) as { messages?: unknown[] }
    return body.messages ?? []
  }

  async countSyslog(): Promise<number> {
    const res = await this.request.get(`${this.env.syslogCollectorApiUrl}/count`)
    if (!res.ok()) throw new Error(`syslog count failed: ${res.status()}`)
    const body = (await res.json()) as { count?: number }
    return Number(body.count ?? 0)
  }

  async waitForWebhookCorrelation(correlationId: string, timeoutMs = 30_000): Promise<unknown[]> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const msgs = await this.getWebhookByCorrelation(correlationId)
      if (msgs.length > 0) return msgs
      await new Promise((r) => setTimeout(r, 500))
    }
    throw new Error(`timeout waiting for webhook correlation_id=${correlationId}`)
  }

  async waitForSyslogCorrelation(
    correlationId: string | string[],
    opts?: { protocol?: string; timeoutMs?: number },
  ): Promise<unknown[]> {
    this.assertRequestAlive()
    const ids = Array.isArray(correlationId) ? correlationId : [correlationId]
    const timeoutMs = opts?.timeoutMs ?? 30_000
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      for (const id of ids) {
        const msgs = await this.getSyslogByCorrelation(id, { protocol: opts?.protocol })
        if (msgs.length > 0) return msgs
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    throw new Error(
      `timeout waiting for syslog correlation_id=${ids.join('|')}` +
        (opts?.protocol ? ` protocol=${opts.protocol}` : ''),
    )
  }

  async probeHttpAuth(path: string, init?: { headers?: Record<string, string> }): Promise<{ status: number; body: unknown }> {
    const res = await this.request.get(`${this.env.wiremockBaseUrl}${path}`, {
      headers: init?.headers,
    })
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      body = await res.text()
    }
    return { status: res.status(), body }
  }
}
