type RequestCacheEntry<T> = {
  promise?: Promise<T>
  value?: T
  updatedAt?: number
}

const requestCaches = new Map<string, Map<string, RequestCacheEntry<unknown>>>()

function nowMs(): number {
  return Date.now()
}

function namespaceCache(namespace: string): Map<string, RequestCacheEntry<unknown>> {
  let cache = requestCaches.get(namespace)
  if (cache == null) {
    cache = new Map()
    requestCaches.set(namespace, cache)
  }
  return cache
}

export function clearSharedRequestCache(namespace?: string, key?: string): void {
  if (namespace == null) {
    requestCaches.clear()
    return
  }
  const cache = requestCaches.get(namespace)
  if (cache == null) return
  if (key == null) {
    cache.clear()
    return
  }
  cache.delete(key)
}

export async function cachedRequest<T>(
  namespace: string,
  key: string,
  loader: () => Promise<T>,
  options: { ttlMs?: number } = {},
): Promise<T> {
  const ttlMs = options.ttlMs ?? 15_000
  const cache = namespaceCache(namespace)
  const cached = cache.get(key) as RequestCacheEntry<T> | undefined
  if (cached?.promise != null) return cached.promise

  const cachedAge = cached?.updatedAt == null ? Number.POSITIVE_INFINITY : nowMs() - cached.updatedAt
  if (cached != null && cachedAge < ttlMs) return cached.value as T

  const promise = loader()
    .then((value) => {
      cache.set(key, { value, updatedAt: nowMs() })
      return value
    })
    .catch((err) => {
      cache.delete(key)
      throw err
    })
    .finally(() => {
      const entry = cache.get(key)
      if (entry?.promise === promise) {
        cache.set(key, { value: entry.value, updatedAt: entry.updatedAt })
      }
    })

  cache.set(key, { ...cached, promise })
  return promise
}
