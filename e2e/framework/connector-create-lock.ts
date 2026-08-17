/**
 * Cross-worker Lab API throttle for parallel XP workers.
 *
 * When GDC_XP_WORKER_ID is set, connector creates share an exclusive lock file
 * so parallel shard workers do not stampede POST /connectors.
 */
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_LOCK =
  process.env.GDC_XP_CONNECTOR_CREATE_LOCK || path.join('/tmp', 'gdc-xp-connector-create.lock')

function lockEnabled(): boolean {
  if (process.env.GDC_XP_CONNECTOR_CREATE_LOCK_DISABLE === '1') return false
  return Boolean(process.env.GDC_XP_WORKER_ID || process.env.GDC_XP_CONNECTOR_CREATE_LOCK)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Acquire exclusive lock via O_EXCL lockfile; returns release callback. */
async function acquireLockFile(lockPath: string, timeoutMs: number): Promise<() => void> {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true })
  const start = Date.now()
  while (true) {
    try {
      const fd = fs.openSync(lockPath, 'wx')
      fs.writeFileSync(fd, `${process.pid}\n${new Date().toISOString()}\n`)
      return () => {
        try {
          fs.closeSync(fd)
        } catch {
          /* ignore */
        }
        try {
          fs.unlinkSync(lockPath)
        } catch {
          /* ignore */
        }
      }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code !== 'EEXIST') throw err
      try {
        const body = fs.readFileSync(lockPath, 'utf-8')
        const holder = Number((body.split('\n')[0] || '').trim())
        if (holder && !isPidAlive(holder)) {
          fs.unlinkSync(lockPath)
          continue
        }
      } catch {
        /* ignore */
      }
      if (Date.now() - start > timeoutMs) {
        throw Object.assign(new Error('CONNECTOR_CREATE_LOCK_TIMEOUT'), {
          classification: 'TEST_INFRA',
        })
      }
      await sleep(40 + Math.floor(Math.random() * 80))
    }
  }
}

export async function withConnectorCreateLock<T>(fn: () => Promise<T>): Promise<T> {
  if (!lockEnabled()) return fn()
  const timeoutMs = Number(process.env.GDC_XP_CONNECTOR_CREATE_LOCK_TIMEOUT_MS || 180_000)
  const release = await acquireLockFile(DEFAULT_LOCK, timeoutMs)
  try {
    return await fn()
  } finally {
    release()
  }
}
