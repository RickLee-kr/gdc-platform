import type { HTMLAttributes, ReactNode } from 'react'
import { RUNTIME_MESSAGES } from '../../utils/runtimeMessages'

export type RuntimeMessageTone =
  | 'success'
  | 'error'
  | 'loading'
  | 'muted'
  | 'warning-banner'
  | 'toolbar-feedback'
  | 'toolbar-persistence-note'
  | 'unsaved-indicator'
  | 'result-summary'
  | 'obs-hint'
  | 'obs-empty'
  | 'config-tab-hint'

const TONE_CLASSES: Record<RuntimeMessageTone, string> = {
  success: 'success',
  error: 'error',
  loading: 'loading',
  muted: 'muted',
  'warning-banner': 'warning-banner',
  'toolbar-feedback': 'toolbar-feedback',
  'toolbar-persistence-note': 'toolbar-persistence-note',
  'unsaved-indicator': 'unsaved-indicator',
  'result-summary': 'muted result-summary',
  'obs-hint': 'muted obs-hint',
  'obs-empty': 'muted obs-empty',
  'config-tab-hint': 'muted config-tab-hint',
}

function defaultElementForTone(tone: RuntimeMessageTone): 'p' | 'span' | 'pre' {
  if (tone === 'success' || tone === 'loading') {
    return 'span'
  }
  if (tone === 'error') {
    return 'pre'
  }
  return 'p'
}

export type RuntimeMessageProps = {
  tone: RuntimeMessageTone
  /** Overrides auto tag selection from tone (success/loading → span, error → pre, else → p). */
  as?: 'p' | 'span' | 'pre' | 'div'
  children: ReactNode
  className?: string
} & Omit<HTMLAttributes<HTMLElement>, 'className'>

export function RuntimeMessage({ tone, as, children, className = '', ...rest }: RuntimeMessageProps) {
  const Component = as ?? defaultElementForTone(tone)
  const cls = [TONE_CLASSES[tone], className].filter(Boolean).join(' ')
  return (
    <Component className={cls} {...rest}>
      {children}
    </Component>
  )
}

export type RuntimeRequestStatusProps = {
  loading: boolean
  success: string
  error: string
  loadingText?: string
}

export function RuntimeRequestStatus({
  loading,
  success,
  error,
  loadingText = RUNTIME_MESSAGES.loading,
}: RuntimeRequestStatusProps) {
  return (
    <div className="status">
      {loading && <RuntimeMessage tone="loading">{loadingText}</RuntimeMessage>}
      {success ? <RuntimeMessage tone="success">{success}</RuntimeMessage> : null}
      {error ? <RuntimeMessage tone="error">{error}</RuntimeMessage> : null}
    </div>
  )
}
