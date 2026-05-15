/** Mirrors backend `DEFAULT_MESSAGE_PREFIX_TEMPLATE`. */
export const DEFAULT_MESSAGE_PREFIX_TEMPLATE = '<134> gdc generic-connector event:'

/** Default: enabled for SYSLOG*, disabled for WEBHOOK and others. */
export function defaultMessagePrefixEnabled(destinationType: string | null | undefined): boolean {
  const dt = String(destinationType ?? '')
    .trim()
    .toUpperCase()
  return dt.startsWith('SYSLOG')
}
