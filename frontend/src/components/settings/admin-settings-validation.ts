/** Client-side password rules aligned with admin API. */

export function validateNewPassword(password: string): string | null {
  if (password.length < 8) {
    return 'Password must be at least 8 characters.'
  }
  return null
}

export function passwordsMatch(newPassword: string, confirm: string): boolean {
  return newPassword === confirm
}
