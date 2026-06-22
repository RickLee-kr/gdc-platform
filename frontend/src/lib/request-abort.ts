export function createAbortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError')
}

export function isRequestAborted(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true
  if (error instanceof Error) {
    if (error.name === 'AbortError') return true
    const msg = error.message.toLowerCase()
    if (msg.includes('aborted') || msg.includes('abort')) return true
  }
  return false
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError()
}
