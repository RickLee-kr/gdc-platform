let userTimezone: string | null = null
let platformDefaultTimezone: string | null = null

export function setDisplayTimezoneCache(input: {
  userTimezone?: string | null
  platformDefaultTimezone?: string | null
}): void {
  if (input.userTimezone !== undefined) {
    userTimezone = input.userTimezone?.trim() ? input.userTimezone.trim() : null
  }
  if (input.platformDefaultTimezone !== undefined) {
    platformDefaultTimezone = input.platformDefaultTimezone?.trim()
      ? input.platformDefaultTimezone.trim()
      : null
  }
}

export function getDisplayTimezoneCache(): {
  userTimezone: string | null
  platformDefaultTimezone: string | null
} {
  return { userTimezone, platformDefaultTimezone }
}
