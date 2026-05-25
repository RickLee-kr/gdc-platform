/**
 * Short, English-only tooltip copy reused across the UI.
 *
 * Keep each entry under two short lines. Add an `example` only when it
 * clarifies usage at a glance (paths, template variables, etc.).
 *
 * Do not introduce long paragraphs here; if a screen needs more context,
 * keep the existing helper text and use these tooltips as a supplement.
 */

export const HELP_COPY = {
  // A. Stream request / checkpoint
  checkpointMode: {
    content: 'Only fetches events after the last successful delivery.',
    example: 'updated_after={{checkpoint.last_timestamp}}',
  },
  checkpointVariable: {
    content: 'Field that uniquely orders events (timestamp, id, or cursor).',
    example: '$.event.creationTime',
  },
  checkpointPrimary: {
    content: 'Primary sort field used to resume from where the last run left off.',
    example: '$.hits.hits[*]._source.timestamp',
  },
  checkpointSecondary: {
    content: 'Optional tie-breaker when many events share the same primary value.',
    example: '$.hits.hits[*]._id',
  },
  requestBodyTemplate: {
    content: 'Use {{checkpoint.*}} variables so each run pulls only new data.',
    example: '{"since":"{{checkpoint.last_timestamp}}"}',
  },
  cursorExample: {
    content: 'Cursor-based APIs return a token used for the next page.',
    example: 'cursor={{checkpoint.next_cursor}}',
  },
  noCheckpointWarning: {
    content:
      'No checkpoint variable is configured. The stream may re-fetch the same events on every run.',
    example: 'Add a $.timestamp or $.next_cursor path below to fix.',
  },

  // B. Record Selection / JSON Preview
  eventSource: {
    content: 'The array in the response that contains events.',
    example: '$.data.items',
  },
  eventRoot: {
    content: 'Optional nested object inside each array element to deliver.',
    example: '$.event',
  },
  runtimeExtraction: {
    content: 'Combined path the runtime uses. Stays in sync with Event Source + Event Root.',
    example: '$.Records[*].event',
  },
  previewSample: {
    content: 'Path of the record currently shown in the preview pane.',
    example: '$.Records[0].event',
  },

  // C. Mapping
  mappingSourcePath: {
    content: 'JSONPath relative to one extracted event, not the raw response envelope.',
    example: '$.eventTime',
  },
  mappingOutputField: {
    content: 'Key written into the delivered payload.',
    example: 'event_time',
  },
  mappingRelativeRule: {
    content: 'Paths must start at the extracted event root, not the API response wrapper.',
    example: 'Use $.eventTime, not $.Records[0].event.eventTime',
  },

  // D. Enrichment
  enrichmentStaticFields: {
    content: 'Fixed key/value pairs added after mapping so receivers can identify the log type.',
    example: 'vendor=stellar · log_type=security',
  },
  enrichmentOverridePolicy: {
    content: 'KEEP_EXISTING preserves mapped values; OVERWRITE replaces them with enrichment values.',
  },
  enrichmentVendorFields: {
    content: 'Identify the source so the destination can route or normalize correctly.',
    example: 'vendor · product · log_type',
  },

  // E. Destination / Route
  destinationEnabled: {
    content: 'When disabled, this destination is skipped without changing routes.',
  },
  destinationRateLimit: {
    content: 'Outbound delivery rate cap per destination. Separate from source polling rate.',
  },
  destinationVsRoute: {
    content: 'Destinations are reusable endpoints; Routes connect one Stream to one Destination.',
  },
  routeFailurePolicy: {
    content: 'Controls what happens when delivery fails.',
    example: 'Retry · Log and Continue · Pause Stream · Disable Route',
  },
  routeEnabled: {
    content: 'When disabled, the stream skips this route during fan-out.',
  },
  routeVsDestination: {
    content: 'Route connects one Stream to one Destination. Add multiple routes for fan-out.',
  },

  // F. Runtime / Logs
  runtimeEps: {
    content: 'Events per second delivered over the rolling window.',
  },
  runtimeLastSuccess: {
    content: 'Most recent time at least one route delivered successfully.',
  },
  runtimeLastError: {
    content: 'Most recent time a route delivery failed.',
  },
  runtimeCheckpoint: {
    content: 'Last successfully delivered event position.',
  },
  runtimeRetry: {
    content: 'How often deliveries needed a retry to succeed.',
  },
  runtimeRouteFailure: {
    content: 'Routes whose latest deliveries failed or degraded.',
  },
  runtimeLogStage: {
    content: 'Which pipeline step produced this log entry.',
    example: 'source_fetch · mapping · route_send',
  },
} as const

export type HelpCopyKey = keyof typeof HELP_COPY
