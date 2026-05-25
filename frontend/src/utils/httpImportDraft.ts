import type { NavigateFunction } from 'react-router-dom'
import type { CurlImportDraft } from '../api/gdcBackup'
import type { ConnectorWritePayload } from '../api/gdcConnectors'
import type { WizardConfigState, WizardState } from '../components/streams/wizard/wizard-state'

export type HttpImportWizardLocationState = {
  curlDraft?: Record<string, unknown>
  streamDraft?: CurlImportDraft['stream']
  connectorId?: number
}

function newRowId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`
}

export function navigateToConnectorWizardWithDraft(navigate: NavigateFunction, draft: CurlImportDraft): void {
  const payload = draft.connector as ConnectorWritePayload
  navigate('/connectors/new', { state: { curlDraft: payload, streamDraft: draft.stream } satisfies HttpImportWizardLocationState })
}

export function navigateToStreamWizardWithDraft(
  navigate: NavigateFunction,
  connectorId: number,
  streamDraft: CurlImportDraft['stream'],
): void {
  navigate('/streams/new', {
    state: { connectorId, streamDraft } satisfies HttpImportWizardLocationState,
  })
}

export function applyStreamDraftToWizardConfig(
  streamDraft: CurlImportDraft['stream'] | undefined,
): Partial<WizardConfigState> | null {
  if (!streamDraft) return null
  const cfg = streamDraft.config_json ?? {}
  const method = String((cfg as { method?: string }).method ?? 'GET').toUpperCase()
  const httpMethod = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
    ? (method as WizardConfigState['httpMethod'])
    : 'GET'
  const paramsRaw = (cfg as { params?: Record<string, string> }).params ?? {}
  const params = Object.entries(paramsRaw).map(([key, value]) => ({
    id: newRowId('param'),
    key,
    value: String(value),
  }))
  const body = (cfg as { body?: unknown }).body
  let requestBody = ''
  if (body !== undefined && body !== null) {
    requestBody = typeof body === 'string' ? body : JSON.stringify(body, null, 2)
  }
  return {
    name: streamDraft.name ?? 'Imported stream',
    httpMethod,
    endpoint: String((cfg as { endpoint?: string }).endpoint ?? '/'),
    params,
    requestBody,
    pollingIntervalSec: streamDraft.polling_interval ?? 60,
  }
}

export function applyHttpImportToWizardState(
  state: WizardState,
  opts: { connectorId: number; streamDraft?: CurlImportDraft['stream'] },
): WizardState {
  const streamPatch = applyStreamDraftToWizardConfig(opts.streamDraft)
  return {
    ...state,
    connector: { ...state.connector, connectorId: opts.connectorId },
    stream: streamPatch ? { ...state.stream, ...streamPatch } : state.stream,
  }
}
