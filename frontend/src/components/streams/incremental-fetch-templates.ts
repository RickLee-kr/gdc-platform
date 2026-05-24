/** Incremental fetch request-body templates for HTTP API polling streams (UI only). */

export const INCREMENTAL_FETCH_CHECKPOINT_HELPER =
  'Checkpoint variables are only injected where you place them. If no checkpoint variable is configured, the stream will call the API as-is and may fetch the API default range or full dataset.'

export const INCREMENTAL_FETCH_GDC_NOTE =
  'GDC does not automatically know each API’s incremental query format. It only substitutes checkpoint and runtime variables in the request params, body, headers, and path you configure.'

export const CHECKPOINT_TEMPLATE_VARIABLES = [
  '{{checkpoint.last_timestamp}}',
  '{{checkpoint.last_timestamp_ms}}',
  '{{checkpoint.last_event_id}}',
  '{{checkpoint.next_cursor}}',
  '{{runtime.now_ms}}',
  '{{runtime.now_iso}}',
] as const

export type IncrementalFetchTemplateId =
  | 'full_fetch'
  | 'timestamp_filter'
  | 'time_range'
  | 'cursor'
  | 'event_id'
  | 'elasticsearch_search'

export type IncrementalFetchTemplate = {
  id: IncrementalFetchTemplateId
  label: string
  description: string
  checkpointType: string
  checkpointUpdatePathExample: string
  sortingRequirement?: string
  warning?: string
  body: string
}

export const INCREMENTAL_FETCH_TEMPLATES: IncrementalFetchTemplate[] = [
  {
    id: 'full_fetch',
    label: 'No checkpoint / full fetch',
    description: 'Fixed page size with no checkpoint filter. Use only when the API default window is acceptable or for one-off backfills.',
    checkpointType: 'None',
    checkpointUpdatePathExample: '— (no checkpoint variable in body)',
    warning:
      'This does not use checkpoint variables. It may fetch duplicate or full data depending on the API.',
    body: `{
  "limit": 1000
}`,
  },
  {
    id: 'timestamp_filter',
    label: 'Timestamp JSON body filter',
    description: 'Filter events after the last committed timestamp (e.g. Cybereason-style filters array).',
    checkpointType: 'TIMESTAMP',
    checkpointUpdatePathExample: 'e.g. $.data[-1].creationTime or your event timestamp field',
    sortingRequirement: 'Ascending sort on the same timestamp field',
    warning: 'Requires API-side filtering and ascending sort.',
    body: `{
  "filters": [
    {
      "fieldName": "creationTime",
      "operator": "GreaterThan",
      "values": ["{{checkpoint.last_timestamp}}"]
    }
  ],
  "sort": [
    {
      "fieldName": "creationTime",
      "order": "ASC"
    }
  ],
  "limit": 1000
}`,
  },
  {
    id: 'time_range',
    label: 'Time range body',
    description: 'Window from last checkpoint milliseconds through current runtime time.',
    checkpointType: 'TIMESTAMP (ms)',
    checkpointUpdatePathExample: 'e.g. $.events[-1].timestamp (ms epoch in response)',
    sortingRequirement: 'Ascending sort on timestamp when the API supports it',
    warning: 'Requires API-side filtering and ascending sort.',
    body: `{
  "startTime": "{{checkpoint.last_timestamp_ms}}",
  "endTime": "{{runtime.now_ms}}",
  "limit": 1000
}`,
  },
  {
    id: 'cursor',
    label: 'Cursor / next page token',
    description: 'Pass the stored cursor from the previous response for paginated incremental fetch.',
    checkpointType: 'CURSOR',
    checkpointUpdatePathExample: 'e.g. $.next_cursor or $.pagination.next',
    warning: 'Requires response next_cursor extraction to update checkpoint.',
    body: `{
  "cursor": "{{checkpoint.next_cursor}}",
  "limit": 1000
}`,
  },
  {
    id: 'event_id',
    label: 'Event ID greater-than',
    description: 'Monotonic event id filter for APIs that support id_gt-style queries.',
    checkpointType: 'EVENT_ID',
    checkpointUpdatePathExample: 'e.g. $.items[-1].id',
    sortingRequirement: 'Ascending sort on id',
    warning: 'Requires API-side filtering and ascending sort.',
    body: `{
  "filter": {
    "id_gt": "{{checkpoint.last_event_id}}"
  },
  "sort": [
    {
      "fieldName": "id",
      "order": "ASC"
    }
  ],
  "limit": 1000
}`,
  },
  {
    id: 'elasticsearch_search',
    label: 'Elasticsearch / Stellar _search',
    description: 'Range filter on timestamp with composite sort for stable paging (SER / Elasticsearch-style).',
    checkpointType: 'TIMESTAMP (+ _id tie-break)',
    checkpointUpdatePathExample: 'e.g. $.hits.hits[-1]._source.timestamp and ._id',
    sortingRequirement: 'timestamp asc, then _id asc',
    warning:
      'Use timestamp + _id as a stable sort to avoid missing events with identical timestamps.',
    body: `{
  "size": 1000,
  "sort": [
    { "timestamp": "asc" },
    { "_id": "asc" }
  ],
  "query": {
    "bool": {
      "filter": [
        {
          "range": {
            "timestamp": {
              "gt": "{{checkpoint.last_timestamp}}"
            }
          }
        }
      ]
    }
  }
}`,
  },
]

export function getIncrementalFetchTemplate(id: IncrementalFetchTemplateId): IncrementalFetchTemplate | undefined {
  return INCREMENTAL_FETCH_TEMPLATES.find((t) => t.id === id)
}
