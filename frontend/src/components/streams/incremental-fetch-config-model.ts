import type { WizardConfigState } from './wizard/wizard-state'
import { detectAdvancedOverride } from './incremental-fetch-basic'

export type IncrementalFetchStrategy =
  | ''
  | 'cursor'
  | 'timestamp_watermark'
  | 'closed_window_watermark'
  | 'custom'

export type IncrementalFetchConfigValues = {
  strategy: IncrementalFetchStrategy
  watermarkField: string
  cursorField: string
  tieBreakerField: string
  stabilityLagSeconds: number
  initialLookbackSeconds: number
  /** True when the operator manually changed Strategy in Advanced settings. */
  advancedOverride: boolean
}

export function incrementalFetchValuesFromWizardStream(
  stream: Pick<
    WizardConfigState,
    | 'incrementalFetchStrategy'
    | 'incrementalFetchWatermarkField'
    | 'incrementalFetchCursorField'
    | 'incrementalFetchTieBreakerField'
    | 'incrementalFetchStabilityLagSeconds'
    | 'incrementalFetchInitialLookbackSeconds'
    | 'incrementalFetchAdvancedOverride'
  >,
): IncrementalFetchConfigValues {
  return {
    strategy: stream.incrementalFetchStrategy,
    watermarkField: stream.incrementalFetchWatermarkField,
    cursorField: stream.incrementalFetchCursorField,
    tieBreakerField: stream.incrementalFetchTieBreakerField,
    stabilityLagSeconds: stream.incrementalFetchStabilityLagSeconds,
    initialLookbackSeconds: stream.incrementalFetchInitialLookbackSeconds,
    advancedOverride: stream.incrementalFetchAdvancedOverride,
  }
}

export function wizardStreamPatchFromIncrementalFetch(
  values: Partial<IncrementalFetchConfigValues>,
): Partial<WizardConfigState> {
  const patch: Partial<WizardConfigState> = {}
  if (values.strategy !== undefined) patch.incrementalFetchStrategy = values.strategy
  if (values.watermarkField !== undefined) patch.incrementalFetchWatermarkField = values.watermarkField
  if (values.cursorField !== undefined) patch.incrementalFetchCursorField = values.cursorField
  if (values.tieBreakerField !== undefined) patch.incrementalFetchTieBreakerField = values.tieBreakerField
  if (values.stabilityLagSeconds !== undefined) {
    patch.incrementalFetchStabilityLagSeconds = values.stabilityLagSeconds
  }
  if (values.initialLookbackSeconds !== undefined) {
    patch.incrementalFetchInitialLookbackSeconds = values.initialLookbackSeconds
  }
  if (values.advancedOverride !== undefined) {
    patch.incrementalFetchAdvancedOverride = values.advancedOverride
  }
  return patch
}

/** Persist snake_case blob for config_json.incremental_fetch (structure unchanged). */
export function buildIncrementalFetchConfigJsonPatch(
  stream: Pick<
    WizardConfigState,
    | 'incrementalFetchStrategy'
    | 'incrementalFetchWatermarkField'
    | 'incrementalFetchCursorField'
    | 'incrementalFetchTieBreakerField'
    | 'incrementalFetchStabilityLagSeconds'
    | 'incrementalFetchInitialLookbackSeconds'
  >,
): Record<string, unknown> | null {
  const strategy = stream.incrementalFetchStrategy || ''
  const watermark = (stream.incrementalFetchWatermarkField ?? '').trim()
  const cursor = (stream.incrementalFetchCursorField ?? '').trim()
  const tie = (stream.incrementalFetchTieBreakerField ?? '').trim()
  if (!strategy && !watermark && !cursor && !tie) {
    return null
  }
  const blob: Record<string, unknown> = {}
  if (strategy) blob.strategy = strategy
  if (watermark) blob.watermark_field = watermark
  if (cursor) blob.cursor_field = cursor
  if (tie) blob.tie_breaker_field = tie
  const lag = stream.incrementalFetchStabilityLagSeconds
  if (strategy === 'closed_window_watermark' || (typeof lag === 'number' && lag > 0)) {
    blob.stability_lag_seconds = Math.max(0, Math.floor(lag || 0))
  }
  const lookback = stream.incrementalFetchInitialLookbackSeconds
  if (typeof lookback === 'number' && lookback > 0) {
    blob.initial_lookback_seconds = Math.max(0, Math.floor(lookback || 0))
  }
  return { incremental_fetch: blob }
}

export function readIncrementalFetchFromPersisted(
  cfg: Record<string, unknown>,
): Partial<WizardConfigState> {
  const raw = cfg.incremental_fetch
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const blob = raw as Record<string, unknown>
  const strategyRaw = typeof blob.strategy === 'string' ? blob.strategy.trim() : ''
  const strategy = (
    strategyRaw === 'cursor' ||
    strategyRaw === 'timestamp_watermark' ||
    strategyRaw === 'closed_window_watermark' ||
    strategyRaw === 'custom'
      ? strategyRaw
      : ''
  ) as WizardConfigState['incrementalFetchStrategy']

  const watermarkField = typeof blob.watermark_field === 'string' ? blob.watermark_field.trim() : ''
  const cursorField = typeof blob.cursor_field === 'string' ? blob.cursor_field.trim() : ''
  const tieBreakerField = typeof blob.tie_breaker_field === 'string' ? blob.tie_breaker_field.trim() : ''
  const stabilityLagSeconds =
    typeof blob.stability_lag_seconds === 'number' && Number.isFinite(blob.stability_lag_seconds)
      ? Math.max(0, Math.floor(blob.stability_lag_seconds))
      : 120
  const initialLookbackSeconds =
    typeof blob.initial_lookback_seconds === 'number' && Number.isFinite(blob.initial_lookback_seconds)
      ? Math.max(0, Math.floor(blob.initial_lookback_seconds))
      : 86400

  const advancedOverride = detectAdvancedOverride({
    strategy,
    watermarkField,
    cursorField,
  })

  return {
    incrementalFetchStrategy: strategy,
    incrementalFetchWatermarkField: watermarkField,
    incrementalFetchCursorField: cursorField,
    incrementalFetchTieBreakerField: tieBreakerField,
    incrementalFetchStabilityLagSeconds: stabilityLagSeconds,
    incrementalFetchInitialLookbackSeconds: initialLookbackSeconds,
    incrementalFetchAdvancedOverride: advancedOverride,
  }
}

export const INCREMENTAL_FETCH_STRATEGY_OPTIONS: ReadonlyArray<{
  value: IncrementalFetchStrategy
  label: string
}> = [
  { value: '', label: 'Infer from checkpoint mode' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'timestamp_watermark', label: 'Timestamp Watermark' },
  { value: 'closed_window_watermark', label: 'Closed-window Watermark' },
  { value: 'custom', label: 'Custom' },
]
