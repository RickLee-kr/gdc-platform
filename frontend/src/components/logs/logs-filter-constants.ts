export {
  PIPELINE_STAGE_FILTER_OPTIONS,
  type PipelineStageFilterOption,
} from './delivery-log-stages'

export const TIME_RANGE_OPTIONS = ['Last 15 minutes', 'Last 1 hour', 'Last 6 hours', 'Last 24 hours'] as const

export const ALL_STREAMS_LABEL = 'All Streams'
export const ALL_ROUTES_LABEL = 'All Routes'

export const LEVEL_FILTER_OPTIONS = ['All Levels', 'ERROR', 'WARN', 'INFO', 'DEBUG'] as const
