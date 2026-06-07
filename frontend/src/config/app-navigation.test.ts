import { describe, expect, it } from 'vitest'
import { SIDEBAR_TOP_ITEMS, sidebarItemsForPersona } from './app-navigation'

describe('sidebarItemsForPersona M17.4', () => {
  it('hides Governance for connector persona', () => {
    const items = sidebarItemsForPersona(false)
    expect(items.map((i) => i.key)).toEqual(['streams', 'monitoring', 'logs', 'administration'])
    expect(items).toHaveLength(4)
  })

  it('shows all five items for governance persona', () => {
    const items = sidebarItemsForPersona(true)
    expect(items).toEqual(SIDEBAR_TOP_ITEMS)
    expect(items).toHaveLength(5)
  })
})
