/** Prefix for additive development validation lab entities (backend seeder). */

export const DEV_VALIDATION_NAME_PREFIX = '[DEV VALIDATION] '

/** Prefix for UI-visible E2E fixtures (`app/dev_validation_lab/visible_e2e_seed.py`). */

export const DEV_E2E_VISIBLE_NAME_PREFIX = '[DEV E2E] '

/** True for names seeded by the dev validation lab or the visible E2E fixture seed (UI badge + filters). */

export function isDevValidationLabEntityName(name: string | null | undefined): boolean {
  const n = name ?? ''
  return Boolean(n.startsWith(DEV_VALIDATION_NAME_PREFIX) || n.startsWith(DEV_E2E_VISIBLE_NAME_PREFIX))
}
