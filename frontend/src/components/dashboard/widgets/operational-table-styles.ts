/** Shared Tailwind class strings for observability-style tables. */

export const opTable = 'w-full border-collapse text-[12px] leading-tight'

export const opThRow =
  'border-b border-slate-200/80 bg-slate-50 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:border-gdc-divider dark:bg-gdc-tableHeader dark:text-gdc-mutedStrong'

export const opTh = 'px-2.5 py-1.5'

/** Default body text: avoids UA black on dark rows when cells omit explicit `text-*`. */
export const opTd = 'px-2.5 py-1.5 align-middle text-slate-700 dark:text-gdc-mutedStrong'

export const opTr =
  'border-b border-slate-100/90 transition-colors last:border-b-0 hover:bg-slate-50/80 dark:border-gdc-divider dark:hover:bg-gdc-rowHover'

/** Loading / empty rows — same navy family, not a bright inset */
export const opStateRow =
  'border-b border-slate-100/90 bg-slate-50/50 text-slate-600 transition-colors last:border-b-0 dark:border-gdc-border dark:bg-gdc-section dark:text-gdc-muted'
