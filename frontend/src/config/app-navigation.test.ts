import { describe, expect, it } from 'vitest'
import { SIDEBAR_STRUCTURE, sidebarItemsForPersona, sidebarStructureForRole } from './app-navigation'

describe('sidebarStructureForRole (DATA-RELAY-UX-CHARTER)', () => {
  it('hides Governance for connector persona', () => {
    const structure = sidebarStructureForRole(false)
    const keys = structure.flatMap((entry) =>
      entry.type === 'item' ? [entry.item.key] : entry.group.items.map((i) => i.key),
    )
    expect(keys).toEqual(['dashboard', 'connectors', 'streams', 'destinations', 'routes', 'administration'])
  })

  it('shows Dashboard, Data Sources, Delivery, Governance, and Administration for governance persona', () => {
    const structure = sidebarStructureForRole(true)
    const keys = structure.flatMap((entry) =>
      entry.type === 'item' ? [entry.item.key] : entry.group.items.map((i) => i.key),
    )
    expect(keys).toEqual([
      'dashboard',
      'connectors',
      'streams',
      'destinations',
      'routes',
      'governance',
      'administration',
    ])
  })

  it('exposes grouped Data Sources and Delivery sections', () => {
    const groups = SIDEBAR_STRUCTURE.filter((entry) => entry.type === 'group').map((entry) => entry.group.id)
    expect(groups).toEqual(['dataSources', 'delivery'])
  })
})

describe('sidebarItemsForPersona M17.4', () => {
  it('hides Governance for connector persona', () => {
    const items = sidebarItemsForPersona(false)
    expect(items.map((i) => i.key)).toEqual(['dashboard', 'connectors', 'streams', 'destinations', 'routes', 'administration'])
    expect(items).toHaveLength(6)
  })

  it('shows full charter navigation for governance persona', () => {
    const items = sidebarItemsForPersona(true)
    expect(items.map((i) => i.key)).toEqual([
      'dashboard',
      'connectors',
      'streams',
      'destinations',
      'routes',
      'governance',
      'administration',
    ])
    expect(items).toHaveLength(7)
  })
})
