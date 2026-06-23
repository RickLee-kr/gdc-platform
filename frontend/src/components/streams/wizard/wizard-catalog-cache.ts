import type { CatalogSnapshot } from '../../../api/gdcCatalog'

let lastSnapshot: CatalogSnapshot | null = null

export function readWizardCatalogSnapshot(): CatalogSnapshot | null {
  return lastSnapshot
}

export function writeWizardCatalogSnapshot(snapshot: CatalogSnapshot): void {
  lastSnapshot = snapshot
}

export function clearWizardCatalogSnapshot(): void {
  lastSnapshot = null
}
