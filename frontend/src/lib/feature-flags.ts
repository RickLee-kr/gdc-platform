/** Build-time gates for incomplete or internal-only operator UI. */

export function isDevValidationLabUiEnabled(): boolean {
  if (import.meta.env.VITE_ENABLE_DEV_VALIDATION_LAB === 'true') return true
  return import.meta.env.MODE === 'development'
}

export function isPlatformAlertingUiEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_PLATFORM_ALERTING_UI === 'true'
}
