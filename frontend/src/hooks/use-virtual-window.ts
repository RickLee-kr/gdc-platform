import { useMemo } from 'react'
import { computeWindowedRange } from '../lib/windowed-virtual-range'

export function useVirtualWindow(
  itemCount: number,
  scrollTop: number,
  viewportHeight: number,
  itemSize: number,
  overscan = 3,
) {
  return useMemo(
    () => computeWindowedRange(scrollTop, viewportHeight, itemCount, itemSize, overscan),
    [scrollTop, viewportHeight, itemCount, itemSize, overscan],
  )
}
