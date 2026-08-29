import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

beforeEach(() => {
  localStorage.clear()
  // Base UI's focus manager checks focus guards on Element-like related targets.
  // jsdom can report Window during cleanup; normalize that test-only target shape.
  if (typeof window !== 'undefined' && typeof (window as Window & { hasAttribute?: unknown }).hasAttribute !== 'function') {
    Object.defineProperty(window, 'hasAttribute', { configurable: true, value: () => false })
  }
  if (typeof FocusEvent !== 'undefined') {
    const relatedTargetDescriptor = Object.getOwnPropertyDescriptor(FocusEvent.prototype, 'relatedTarget')
    if (relatedTargetDescriptor?.get) {
      Object.defineProperty(FocusEvent.prototype, 'relatedTarget', {
        configurable: true,
        get(this: FocusEvent) {
          const target = relatedTargetDescriptor.get?.call(this)
          return target && typeof (target as { hasAttribute?: unknown }).hasAttribute === 'function' ? target : null
        },
      })
    }
  }
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
