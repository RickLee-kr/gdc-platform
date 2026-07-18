import { describe, expect, it } from 'vitest'
import { routeEditPath, streamRuntimePath, destinationDetailPath } from '../../config/nav-paths'

/** Mirrors dashboard OperationalProblemsList navigation priority. */
function problemNavPath(problem: {
  routeId?: number | null
  streamId?: number | null
  destinationId?: number | null
}): string {
  if (problem.routeId != null) return routeEditPath(String(problem.routeId))
  if (problem.streamId != null) return streamRuntimePath(String(problem.streamId))
  if (problem.destinationId != null) return destinationDetailPath(String(problem.destinationId))
  return '/streams'
}

describe('dashboard problem drilldown', () => {
  it('prefers route edit, then stream runtime, then destination', () => {
    expect(problemNavPath({ routeId: 37, streamId: 23, destinationId: 1 })).toBe(routeEditPath('37'))
    expect(problemNavPath({ streamId: 23, destinationId: 1 })).toBe(streamRuntimePath('23'))
    expect(problemNavPath({ destinationId: 1 })).toBe(destinationDetailPath('1'))
  })
})
