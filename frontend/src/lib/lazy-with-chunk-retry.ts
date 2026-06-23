export const CHUNK_RELOAD_SESSION_KEY = 'gdc.chunk-reload-once'

/** True when a lazy route chunk 404s after a new frontend bundle was deployed. */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return (
    msg.includes('failed to fetch dynamically imported module') ||
    msg.includes('importing a module script failed') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('dynamically imported module')
  )
}

/** Clear the one-shot reload guard after a successful app boot. */
export function clearChunkReloadGuard(): void {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_SESSION_KEY)
  } catch {
    /* private mode */
  }
}

function reloadOnceForStaleChunk(): boolean {
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_SESSION_KEY)) return false
    sessionStorage.setItem(CHUNK_RELOAD_SESSION_KEY, '1')
    window.location.reload()
    return true
  } catch {
    window.location.reload()
    return true
  }
}

/** Wrap a dynamic import so stale chunk references trigger one automatic hard reload. */
export function lazyWithChunkRetry<T>(factory: () => Promise<T>): () => Promise<T> {
  return () =>
    factory().catch((error) => {
      if (isChunkLoadError(error) && reloadOnceForStaleChunk()) {
        return new Promise<T>(() => {
          /* page is reloading */
        })
      }
      throw error
    })
}
