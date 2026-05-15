import { cn } from '../../lib/utils'

type DataRelayLogoMarkProps = {
  className?: string
  /** Accessible label; omit when decorative next to visible brand text. */
  'aria-label'?: string
}

/** Product mark: interlocking loops (blue + emerald) with a forward cue at the overlap. */
export function DataRelayLogoMark({ className, 'aria-label': ariaLabel }: DataRelayLogoMarkProps) {
  return (
    <svg
      className={cn('shrink-0', className)}
      viewBox="0 0 56 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={ariaLabel ? undefined : true}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
    >
      <circle cx="22" cy="20" r="11.5" stroke="#38bdf8" strokeWidth="4.5" />
      <circle cx="36" cy="20" r="11.5" stroke="#34d399" strokeWidth="4.5" />
      <path d="M28 17.5 32 20l-4 2.5v-5z" fill="#f8fafc" />
    </svg>
  )
}

export function DataRelayWordmark({ className }: { className?: string }) {
  return (
    <p className={cn('text-2xl font-bold tracking-tight text-white sm:text-3xl', className)}>
      <span className="text-white">Data</span>
      <span className="text-emerald-400">Relay</span>
    </p>
  )
}
