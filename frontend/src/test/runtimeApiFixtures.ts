/** Typed builders for mocked runtime API JSON bodies used in UI tests. */

export function connectorUiConfigFixture(): { connector: { id: string; secret: string }; meta: boolean } {
  return { connector: { id: 'c1', secret: 'abc' }, meta: true }
}

export function connectorSaveOkFixture(): { saved: boolean } {
  return { saved: true }
}

export function sourceUiConfigFixture(): {
  source: {
    enabled: boolean
    config_json: { url: string }
    auth_json: { token: string }
  }
} {
  return {
    source: {
      enabled: true,
      config_json: { url: 'https://example.test' },
      auth_json: { token: 't' },
    },
  }
}

export function genericOkFixture(): { ok: boolean } {
  return { ok: true }
}

export function streamUiConfigFixture(): {
  stream: {
    name: string
    enabled: boolean
    polling_interval: number
    config_json: { x: number }
    rate_limit_json: { per_sec: number }
  }
} {
  return {
    stream: {
      name: 's',
      enabled: true,
      polling_interval: 120,
      config_json: { x: 1 },
      rate_limit_json: { per_sec: 5 },
    },
  }
}

export function routeUiConfigFixture(): {
  route: {
    enabled: boolean
    failure_policy: string
    formatter_config_json: { fmt: boolean }
    rate_limit_json: { rps: number }
  }
  destination: { enabled: boolean }
} {
  return {
    route: {
      enabled: true,
      failure_policy: 'LOG_AND_CONTINUE',
      formatter_config_json: { fmt: true },
      rate_limit_json: { rps: 10 },
    },
    destination: { enabled: false },
  }
}

export function destinationUiConfigFixture(): {
  destination: {
    name: string
    enabled: boolean
    config_json: { host: string }
    rate_limit_json: { burst: number }
  }
} {
  return {
    destination: {
      name: 'dest-a',
      enabled: true,
      config_json: { host: 'h' },
      rate_limit_json: { burst: 2 },
    },
  }
}

export function mappingUiConfigFixture(): {
  source_config: { sample_payload: { events: { id: number; label: string }[] } }
  mapping: { field_mappings: Record<string, string>; event_array_path: string }
  enrichment: { enrichment: { injected: number }; override_policy: string }
} {
  return {
    source_config: {
      sample_payload: {
        events: [{ id: 99, label: 'alpha' }],
      },
    },
    mapping: {
      field_mappings: {
        existing_out: '$.events[0].id',
      },
      event_array_path: '$.events',
    },
    enrichment: {
      enrichment: { injected: 1 },
      override_policy: 'KEEP_EXISTING',
    },
  }
}

export function mappingTabPreviewResponseFixture(): { preview: string } {
  return { preview: 'ok' }
}

export function dashboardSummaryFixture(): {
  summary: { total_streams: number; running_streams: number; recent_failures: number }
  recent_problem_routes: {
    stream_id: number
    route_id: number
    destination_id: number
    stage: string
    error_code: string
    message: string
    created_at: string
  }[]
  recent_rate_limited_routes: unknown[]
  recent_unhealthy_streams: unknown[]
} {
  return {
    summary: {
      total_streams: 3,
      running_streams: 2,
      recent_failures: 7,
    },
    recent_problem_routes: [
      {
        stream_id: 1,
        route_id: 2,
        destination_id: 9,
        stage: 'route_send_failed',
        error_code: 'E1',
        message: 'timeout',
        created_at: '2026-05-01T10:00:00Z',
      },
    ],
    recent_rate_limited_routes: [],
    recent_unhealthy_streams: [],
  }
}

export function streamHealthFixture(): {
  stream_id: number
  stream_status: string
  health: string
  limit: number
  summary: {
    total_routes: number
    healthy_routes: number
    degraded_routes: number
    unhealthy_routes: number
    disabled_routes: number
    idle_routes: number
  }
  routes: unknown[]
} {
  return {
    stream_id: 42,
    stream_status: 'RUNNING',
    health: 'HEALTHY',
    limit: 100,
    summary: { total_routes: 0, healthy_routes: 0, degraded_routes: 0, unhealthy_routes: 0, disabled_routes: 0, idle_routes: 0 },
    routes: [],
  }
}

export function streamStatsFixture(): {
  stream_id: number
  stream_status: string
  checkpoint: { type: string; value: { o: number } }
  summary: { total_logs: number }
  last_seen: Record<string, unknown>
  routes: unknown[]
  recent_logs: unknown[]
} {
  return {
    stream_id: 7,
    stream_status: 'RUNNING',
    checkpoint: { type: 'OFFSET', value: { o: 1 } },
    summary: { total_logs: 0 },
    last_seen: {},
    routes: [],
    recent_logs: [],
  }
}

export function timelineFixture(): {
  stream_id: number
  total: number
  items: {
    id: number
    created_at: string
    stream_id: number
    route_id: number
    destination_id: number
    stage: string
    level: string
    status: string
    message: string
    error_code: string
    http_status: number
    retry_count: number
    payload_sample: { sample: string }
  }[]
} {
  return {
    stream_id: 5,
    total: 1,
    items: [
      {
        id: 100,
        created_at: '2026-05-02T11:00:00Z',
        stream_id: 5,
        route_id: 7,
        destination_id: 11,
        stage: 'run_complete',
        level: 'INFO',
        status: 'SUCCESS',
        message: 'done',
        error_code: 'NONE',
        http_status: 200,
        retry_count: 0,
        payload_sample: { sample: 'x' },
      },
    ],
  }
}

export function timelineEmptyItemsFixture(): { stream_id: number; total: number; items: unknown[] } {
  return { stream_id: 9, total: 0, items: [] }
}

export function logsSearchFixture(): {
  total_returned: number
  filters: { stream_id: number; limit: number }
  logs: { id: number; stage: string; level: string; message: string; created_at: string }[]
} {
  return {
    total_returned: 1,
    filters: { stream_id: 12, limit: 50 },
    logs: [{ id: 1, stage: 'route_send_success', level: 'INFO', message: 'ok', created_at: '2026-05-03T00:00:00Z' }],
  }
}

export function logsPageFixture(): {
  total_returned: number
  has_next: boolean
  next_cursor_created_at: string
  next_cursor_id: number
  items: { id: number; created_at: string; stage: string; level: string; message: string }[]
} {
  return {
    total_returned: 1,
    has_next: true,
    next_cursor_created_at: '2026-05-04T08:30:00Z',
    next_cursor_id: 9001,
    items: [{ id: 3, created_at: '2026-05-04T09:00:00Z', stage: 'route_skip', level: 'WARN', message: 'skip' }],
  }
}

export function logsPageEmptyItemsFixture(): {
  total_returned: number
  has_next: boolean
  items: unknown[]
} {
  return { total_returned: 0, has_next: false, items: [] }
}

export function logsCleanupFixture(): {
  older_than_days: number
  dry_run: boolean
  cutoff: string
  matched_count: number
  deleted_count: number
  message: string
} {
  return {
    older_than_days: 14,
    dry_run: true,
    cutoff: '2026-04-01T00:00:00Z',
    matched_count: 2,
    deleted_count: 0,
    message: 'dry run',
  }
}

export function logsCleanupZeroMatchFixture(): {
  older_than_days: number
  dry_run: boolean
  cutoff: string
  matched_count: number
  deleted_count: number
  message: string
} {
  return {
    older_than_days: 90,
    dry_run: true,
    cutoff: '2026-01-01T00:00:00Z',
    matched_count: 0,
    deleted_count: 0,
    message: 'nothing to delete',
  }
}

export function failureTrendFixture(): {
  total: number
  buckets: { stage: string; count: number; latest_created_at: string; stream_id: number; route_id: number }[]
} {
  return {
    total: 2,
    buckets: [
      {
        stage: 'route_send_failed',
        count: 5,
        latest_created_at: '2026-05-05T12:00:00Z',
        stream_id: 1,
        route_id: 2,
      },
    ],
  }
}

export function failureTrendEmptyBucketsFixture(): { total: number; buckets: unknown[] } {
  return { total: 0, buckets: [] }
}

export function logsSearchEmptyFixture(): {
  total_returned: number
  filters: Record<string, unknown>
  logs: unknown[]
} {
  return {
    total_returned: 0,
    filters: {},
    logs: [],
  }
}

export function streamControlStartFixture(): {
  stream_id: number
  enabled: boolean
  status: string
  action: string
  message: string
} {
  return {
    stream_id: 11,
    enabled: true,
    status: 'RUNNING',
    action: 'started',
    message: 'stream started',
  }
}

export function streamControlStopFixture(): {
  stream_id: number
  enabled: boolean
  status: string
  action: string
  message: string
} {
  return {
    stream_id: 22,
    enabled: false,
    status: 'STOPPED',
    action: 'stopped',
    message: 'stream stopped',
  }
}

export function httpApiTestFixture(): {
  raw_response: { ok: boolean }
  extracted_events: { id: number }[]
  event_count: number
} {
  return {
    raw_response: { ok: true },
    extracted_events: [{ id: 1 }],
    event_count: 3,
  }
}

export function mappingPreviewFixture(): {
  input_event_count: number
  mapped_event_count: number
  preview_events: { out: string }[]
} {
  return {
    input_event_count: 2,
    mapped_event_count: 1,
    preview_events: [{ out: 'z' }],
  }
}

export function formatPreviewFixture(): {
  destination_type: string
  message_count: number
  preview_messages: { body: string }[]
} {
  return {
    destination_type: 'WEBHOOK_POST',
    message_count: 2,
    preview_messages: [{ body: '{}' }],
  }
}

export function routeDeliveryPreviewFixture(): {
  route_id: number
  destination_id: number
  destination_type: string
  route_enabled: boolean
  destination_enabled: boolean
  message_count: number
  resolved_formatter_config: Record<string, unknown>
  preview_messages: unknown[]
} {
  return {
    route_id: 55,
    destination_id: 66,
    destination_type: 'WEBHOOK_POST',
    route_enabled: true,
    destination_enabled: true,
    message_count: 1,
    resolved_formatter_config: {},
    preview_messages: [],
  }
}

export function emptyHttpApiTestFixture(): {
  raw_response: Record<string, never>
  extracted_events: unknown[]
  event_count: number
} {
  return { raw_response: {}, extracted_events: [], event_count: 0 }
}

export function emptyMappingPreviewFixture(): {
  input_event_count: number
  mapped_event_count: number
  preview_events: unknown[]
} {
  return { input_event_count: 0, mapped_event_count: 0, preview_events: [] }
}

export function emptyFormatPreviewFixture(): {
  destination_type: string
  message_count: number
  preview_messages: unknown[]
} {
  return { destination_type: 'WEBHOOK_POST', message_count: 0, preview_messages: [] }
}

export function emptyRouteDeliveryPreviewFixture(): {
  route_id: number
  destination_id: number
  destination_type: string
  route_enabled: boolean
  destination_enabled: boolean
  message_count: number
  resolved_formatter_config: Record<string, unknown>
  preview_messages: unknown[]
} {
  return {
    route_id: 1,
    destination_id: 2,
    destination_type: 'WEBHOOK_POST',
    route_enabled: true,
    destination_enabled: true,
    message_count: 0,
    resolved_formatter_config: {},
    preview_messages: [],
  }
}
