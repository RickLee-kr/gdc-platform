import { HelpCircle } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { cn } from '../../lib/utils'

export type HelpTooltipProps = {
  /** Short, plain-English explanation. Keep under 2 short lines. */
  content: ReactNode
  /** Optional short example shown on its own line in monospace. */
  example?: string
  /** Optional visible label rendered before the icon (e.g. inline with a heading). */
  label?: string
  /** Accessible label for the trigger. Falls back to `${label} help` or "More info". */
  ariaLabel?: string
  /** Side relative to the trigger. Default: 'top'. */
  side?: 'top' | 'bottom'
  /** Trigger icon size, default 12 (h-3 w-3). Use 14 (h-3.5) for slightly larger contexts. */
  iconSize?: 12 | 14
  /** Extra classes for the trigger wrapper. */
  className?: string
}

/**
 * Minimal hover/focus help tooltip.
 *
 * - Pure CSS visibility via group-hover / group-focus-within (no extra deps).
 * - Renders a small info icon (or label + icon) that is keyboard-focusable.
 * - Always provides a native `title` attribute as a fallback for browsers/agents
 *   that don't paint the styled tooltip (e.g. screen readers also read aria-label).
 */
export function HelpTooltip({
  content,
  example,
  label,
  ariaLabel,
  side = 'top',
  iconSize = 12,
  className,
}: HelpTooltipProps) {
  const tooltipId = useId()
  const titleText = [stringifyContent(content), example].filter(Boolean).join(' — ')
  const trigger = ariaLabel ?? (label ? `${label} help` : 'More info')

  const iconCls = iconSize === 14 ? 'h-3.5 w-3.5' : 'h-3 w-3'

  return (
    <span
      className={cn(
        'group relative inline-flex items-center gap-1 align-middle',
        className,
      )}
    >
      {label ? (
        <span className="text-[11px] font-medium text-slate-600 dark:text-gdc-mutedStrong">{label}</span>
      ) : null}
      <button
        type="button"
        aria-label={trigger}
        aria-describedby={tooltipId}
        title={titleText}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-full text-slate-400 outline-none transition-colors',
          'hover:text-violet-600 focus-visible:text-violet-700 focus-visible:ring-2 focus-visible:ring-violet-500/40',
          'dark:text-gdc-muted dark:hover:text-violet-300 dark:focus-visible:text-violet-200',
        )}
      >
        <HelpCircle className={iconCls} aria-hidden />
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-1/2 z-50 hidden w-max max-w-[260px] -translate-x-1/2 rounded-md border border-slate-200/80 bg-white px-2 py-1.5 text-[11px] font-normal leading-snug text-slate-800 shadow-md',
          'group-hover:block group-focus-within:block',
          'dark:border-gdc-border dark:bg-gdc-elevated dark:text-slate-100',
          side === 'top' ? 'bottom-full mb-1' : 'top-full mt-1',
        )}
      >
        <span className="block text-slate-700 dark:text-slate-100">{content}</span>
        {example ? (
          <span className="mt-0.5 block break-all font-mono text-[10px] text-slate-500 dark:text-gdc-mutedStrong">
            {example}
          </span>
        ) : null}
      </span>
    </span>
  )
}

function stringifyContent(node: ReactNode): string {
  if (node == null || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(stringifyContent).join(' ')
  return ''
}
