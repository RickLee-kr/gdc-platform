import { useState, type FormEvent } from 'react'
import { Lock, Eye, EyeOff } from 'lucide-react'
import { postAuthChangePassword } from '../../api/gdcAdmin'
import { clearSession } from '../../auth/session'
import { cn } from '../../lib/utils'
import { DataRelayLogoMark, DataRelayWordmark } from './datarelay-logo'

type ForceDefaultPasswordChangePageProps = {
  onCompleted: () => void
}

export function ForceDefaultPasswordChangePage({ onCompleted }: ForceDefaultPasswordChangePageProps) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.')
      return
    }
    if (newPassword.trim().toLowerCase() === 'admin') {
      setError('The new password cannot be "admin". Choose a stronger password.')
      return
    }
    setBusy(true)
    try {
      await postAuthChangePassword({
        current_password: currentPassword,
        new_password: newPassword,
        confirm_new_password: confirmPassword,
      })
      clearSession()
      onCompleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password change failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="relative flex min-h-screen flex-col bg-[#020617] text-slate-200"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 80% 60% at 50% 20%, rgba(30, 58, 138, 0.35), transparent 55%), radial-gradient(ellipse 70% 50% at 50% 100%, rgba(6, 78, 59, 0.12), transparent 50%)',
      }}
    >
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-md">
          <header className="mb-8 flex flex-col items-center text-center">
            <DataRelayLogoMark className="mb-4 h-10 w-14 sm:h-11 sm:w-[3.9rem]" aria-label="DataRelay logo" />
            <DataRelayWordmark />
          </header>

          <div
            className={cn(
              'rounded-2xl border border-white/10 bg-slate-950/55 p-6 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.75)] backdrop-blur-md sm:p-8',
            )}
          >
            <div className="mb-6 flex flex-col items-center text-center">
              <div
                className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-slate-900/80"
                style={{
                  background: 'linear-gradient(135deg, rgba(56,189,248,0.2), rgba(52,211,153,0.18))',
                }}
                aria-hidden
              >
                <Lock className="h-6 w-6 text-sky-300 drop-shadow-[0_0_10px_rgba(52,211,153,0.35)]" strokeWidth={2} />
              </div>
              <h1 className="text-xl font-semibold text-white sm:text-2xl">Change default password</h1>
              <p className="mt-3 text-sm leading-relaxed text-slate-400">
                You are using the default admin password. Please change it before continuing.
              </p>
            </div>

            <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
              <div>
                <label htmlFor="force-pw-current" className="mb-1.5 block text-xs font-medium text-slate-400">
                  Current password
                </label>
                <div className="relative">
                  <input
                    id="force-pw-current"
                    name="current_password"
                    type={showCurrent ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="h-11 w-full rounded-lg border border-white/12 bg-slate-950/60 py-2 pl-3 pr-11 text-sm text-white placeholder:text-slate-600 focus:border-sky-500/50 focus:outline-none focus:ring-2 focus:ring-sky-500/25"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-300"
                    aria-label={showCurrent ? 'Hide password' : 'Show password'}
                  >
                    {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="force-pw-new" className="mb-1.5 block text-xs font-medium text-slate-400">
                  New password
                </label>
                <div className="relative">
                  <input
                    id="force-pw-new"
                    name="new_password"
                    type={showNew ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="h-11 w-full rounded-lg border border-white/12 bg-slate-950/60 py-2 pl-3 pr-11 text-sm text-white placeholder:text-slate-600 focus:border-sky-500/50 focus:outline-none focus:ring-2 focus:ring-sky-500/25"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-300"
                    aria-label={showNew ? 'Hide password' : 'Show password'}
                  >
                    {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="force-pw-confirm" className="mb-1.5 block text-xs font-medium text-slate-400">
                  Confirm new password
                </label>
                <div className="relative">
                  <input
                    id="force-pw-confirm"
                    name="confirm_new_password"
                    type={showConfirm ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="h-11 w-full rounded-lg border border-white/12 bg-slate-950/60 py-2 pl-3 pr-11 text-sm text-white placeholder:text-slate-600 focus:border-sky-500/50 focus:outline-none focus:ring-2 focus:ring-sky-500/25"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-300"
                    aria-label={showConfirm ? 'Hide password' : 'Show password'}
                  >
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error ? (
                <p className="rounded-md border border-rose-500/30 bg-rose-950/40 px-3 py-2 text-xs text-rose-200" role="alert">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={busy}
                className="mt-2 flex h-12 w-full items-center justify-center rounded-xl bg-gradient-to-r from-sky-500 to-emerald-500 text-sm font-semibold text-white shadow-lg shadow-sky-900/30 transition-opacity hover:opacity-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? 'Updating…' : 'Update password and sign in again'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
