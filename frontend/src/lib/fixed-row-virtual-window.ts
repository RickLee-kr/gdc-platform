/** Shared fixed-row-height virtual scroll window (Runtime stream grid + Streams console table). */

export type FixedRowVirtualRange = {
  startIndex: number
  endIndex: number
  offsetTop: number
  totalSize: number
}

export function computeFixedRowVirtualRange(
  rowCount: number,
  rowHeight: number,
  scrollTop: number,
  viewportHeight: number,
  overscan = 1,
): FixedRowVirtualRange {
  if (rowCount <= 0 || rowHeight <= 0) {
    return { startIndex: 0, endIndex: -1, offsetTop: 0, totalSize: 0 }
  }

  const totalSize = rowCount * rowHeight
  let startIndex = 0
  for (let i = 0; i < rowCount; i++) {
    if ((i + 1) * rowHeight > scrollTop) {
      startIndex = Math.max(0, i - overscan)
      break
    }
  }

  let endIndex = startIndex
  let visible = 0
  for (let i = startIndex; i < rowCount; i++) {
    endIndex = i
    visible += rowHeight
    if (visible >= viewportHeight + rowHeight * overscan * 2) break
  }
  endIndex = Math.min(rowCount - 1, endIndex + overscan)

  return {
    startIndex,
    endIndex,
    offsetTop: startIndex * rowHeight,
    totalSize,
  }
}
