/**
 * Lab-only fault injector wrapper.
 * Invokes e2e/lab/fault-inject.sh against test fixtures / host API.
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const script = path.resolve(__dirname, '..', 'lab', 'fault-inject.sh')

export type FaultTarget =
  | 'database'
  | 's3'
  | 'sftp'
  | 'api'
  | 'runtime'
  | 'webhook'
  | 'syslog'
  | 'syslog-tls'

const FAULT_TO_TARGET: Record<string, FaultTarget> = {
  db_disconnect: 'database',
  s3_unavailable: 's3',
  sftp_unavailable: 'sftp',
  api_restart: 'api',
  runtime_restart: 'runtime',
  webhook_destination_down: 'webhook',
  syslog_destination_down: 'syslog',
  tls_certificate_error: 'syslog-tls',
}

export function faultTargetForType(faultType: string): FaultTarget | null {
  return FAULT_TO_TARGET[faultType] ?? null
}

export function runFaultCommand(action: 'start' | 'stop' | 'reset' | 'status', target?: FaultTarget): string {
  const args = target ? [action, target] : [action]
  const out = execFileSync(script, args, {
    encoding: 'utf-8',
    env: process.env,
    timeout: 120_000,
  })
  return out
}

export async function withFaultInjection<T>(
  target: FaultTarget,
  during: () => Promise<T>,
): Promise<{ duringResult: T; injectionLog: string }> {
  const startLog = runFaultCommand('start', target)
  try {
    const duringResult = await during()
    return { duringResult, injectionLog: startLog }
  } finally {
    try {
      runFaultCommand('stop', target)
    } catch {
      runFaultCommand('reset')
    }
  }
}
