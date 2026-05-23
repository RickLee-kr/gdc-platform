export type WindowedVirtualRange = {
  startIndex: number
  endIndex: number
  offsetTop: number
  totalSize: number
}

/**
 * Fixed-size windowed range for virtual lists/grids (no external virtualization library).
 */
export function computeWindowedRange(
  scrollTop: number,
  viewportHeight: number,
  itemCount: number,
  itemSize: number,
  overscan = 2,
): WindowedVirtualRange {
  if (itemCount <= 0) {
    return { startIndex: 0, endIndex: -1, offsetTop: 0, totalSize: 0 }
  }
  const startIndex = Math.max(0, Math.floor(scrollTop / itemSize) - overscan)
  const visibleCount = Math.ceil(viewportHeight / itemSize) + overscan * 2
  const endIndex = Math.min(itemCount - 1, startIndex + visibleCount)
  return {
    startIndex,
    endIndex,
    offsetTop: startIndex * itemSize,
    totalSize: itemCount * itemSize,
  }
}
