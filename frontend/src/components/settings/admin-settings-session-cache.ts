import type { HttpsSettingsDto, PlatformUserDto, SystemInfoDto } from '../../api/gdcAdmin'

export type AdminHttpsDraft = {
  enabled: boolean
  certificate_ip_addresses: string
  certificate_dns_names: string
  redirect_http_to_https: boolean
  certificate_valid_days: number
  regenerate_certificate: boolean
}

export type AdminSettingsSessionSnapshot = {
  https: HttpsSettingsDto | null
  httpsDraft: AdminHttpsDraft | null
  users: PlatformUserDto[]
  systemFooter: SystemInfoDto | null
}

let lastSnapshot: AdminSettingsSessionSnapshot | null = null

export function httpsDraftFromSettings(h: HttpsSettingsDto): AdminHttpsDraft {
  return {
    enabled: h.enabled,
    certificate_ip_addresses: h.certificate_ip_addresses.join(', '),
    certificate_dns_names: h.certificate_dns_names.join(', '),
    redirect_http_to_https: h.redirect_http_to_https,
    certificate_valid_days: h.certificate_valid_days,
    regenerate_certificate: true,
  }
}

export function readAdminSettingsSnapshot(): AdminSettingsSessionSnapshot | null {
  return lastSnapshot
}

export function writeAdminSettingsSnapshot(snapshot: AdminSettingsSessionSnapshot): void {
  lastSnapshot = snapshot
}

export function clearAdminSettingsSnapshot(): void {
  lastSnapshot = null
}
