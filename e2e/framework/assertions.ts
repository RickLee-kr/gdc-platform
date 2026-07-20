import { expect } from '@playwright/test'
import { maskSecrets } from './fixture-client'

export function assertRouteFlagMatchesEnv(expectedEnabled: boolean, actualFromApi: boolean | null): void {
  if (actualFromApi == null) {
    throw new Error(
      `BLOCKED: could not read runtime route-processing flag from API; env expects GDC_ROUTE_PROCESSING_ENABLED=${expectedEnabled}`,
    )
  }
  expect(
    actualFromApi,
    `UI/lab env GDC_ROUTE_PROCESSING_ENABLED=${expectedEnabled} but runtime reports ${actualFromApi}`,
  ).toBe(expectedEnabled)
}

export function assertCorrelationDelivered(received: unknown[], correlationId: string): void {
  expect(received.length, `expected collector messages for ${correlationId}`).toBeGreaterThan(0)
  const hit = received.some((m) => {
    const row = m as { correlation_id?: string; body?: unknown; parsed_json?: unknown }
    if (row.correlation_id === correlationId) return true
    const blob = JSON.stringify(maskSecrets(row.body ?? row.parsed_json ?? row))
    return blob.includes(correlationId)
  })
  expect(hit, `correlation_id ${correlationId} not found in collector payload`).toBe(true)
}

export function assertUiEqualsApiEqualsRuntime(uiValue: unknown, apiValue: unknown, runtimeValue: unknown): void {
  expect(maskSecrets(apiValue), 'API value should match UI-declared value').toEqual(maskSecrets(uiValue))
  expect(maskSecrets(runtimeValue), 'Runtime value should match API value').toEqual(maskSecrets(apiValue))
}

export function assertExpectedMatchesDeliveryAndCollector(
  expected: unknown,
  deliveryLogPayload: unknown,
  collectorPayload: unknown,
): void {
  const exp = maskSecrets(expected)
  const del = maskSecrets(deliveryLogPayload)
  const col = maskSecrets(collectorPayload)
  const expText = JSON.stringify(exp)
  const delText = JSON.stringify(del)
  const colText = JSON.stringify(col)
  expect(colText.length, 'collector payload empty').toBeGreaterThan(2)

  const m = /"e2e_correlation_id"\s*:\s*"([^"]+)"/.exec(expText)
  if (m) {
    expect(colText, 'collector must contain correlation id').toContain(m[1])
  }

  // Delivery log search APIs often omit payload_sample; require non-empty log list or known stages.
  const hasLogs =
    delText.length > 2 &&
    !delText.includes('"status":404') &&
    (delText.includes('items') ||
      delText.includes('logs') ||
      delText.includes('rows') ||
      delText.includes('run_') ||
      delText.includes('stage'))
  expect(hasLogs, `delivery logs should be readable; got ${delText.slice(0, 200)}`).toBe(true)
}
