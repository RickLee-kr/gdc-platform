import { describe, expect, it } from 'vitest'
import {
  clearWizardCatalogSnapshot,
  readWizardCatalogSnapshot,
  writeWizardCatalogSnapshot,
} from './wizard-catalog-cache'

describe('wizard catalog session cache', () => {
  it('stores and clears catalog snapshots', () => {
    clearWizardCatalogSnapshot()
    expect(readWizardCatalogSnapshot()).toBeNull()

    writeWizardCatalogSnapshot({
      connectors: [{ id: 1, name: 'A', description: null, status: 'RUNNING', source_count: 0, stream_count: 0 }],
      sources: [],
      apiBacked: true,
    })
    expect(readWizardCatalogSnapshot()?.connectors).toHaveLength(1)
    clearWizardCatalogSnapshot()
    expect(readWizardCatalogSnapshot()).toBeNull()
  })
})
