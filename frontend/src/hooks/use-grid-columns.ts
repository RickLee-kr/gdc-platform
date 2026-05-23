import { useEffect, useState, type RefObject } from 'react'

/** Match Runtime stream grid breakpoints: 1 / sm:2 / lg:3 / xl:4 columns. */
export function gridColumnsForWidth(width: number): number {
  if (width >= 1280) return 4
  if (width >= 1024) return 3
  if (width >= 640) return 2
  return 1
}

export function useGridColumns(containerRef: RefObject<HTMLElement | null>): number {
  const [columns, setColumns] = useState(1)

  useEffect(() => {
    const node = containerRef.current
    if (node == null) return
    const update = () => setColumns(gridColumnsForWidth(node.clientWidth))
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const ro = new ResizeObserver(update)
    ro.observe(node)
    return () => ro.disconnect()
  }, [containerRef])

  return columns
}
