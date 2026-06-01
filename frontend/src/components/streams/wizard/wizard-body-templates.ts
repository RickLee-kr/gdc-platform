/**
 * Wizard HTTP Request body templates.
 *
 * These are pure UI-side payload presets injected into the JSON Request Body
 * textarea. The runtime/back-end keeps full control over template-variable
 * substitution (`{{checkpoint.last_timestamp}}`, `{{now}}`, etc.) — these
 * presets only seed common shapes so operators do not have to retype them.
 *
 * Adding/removing templates here must NOT change any runtime behaviour.
 */

export type BodyTemplateId =
  | 'none'
  | 'empty_json'
  | 'elasticsearch_stellar'
  | 'incremental_timestamp'
  | 'cursor_pagination'
  | 'security_events'

export interface BodyTemplate {
  id: BodyTemplateId
  label: string
  description: string
  body: string
}

/** Default template selection shown in the dropdown on mount. */
export const DEFAULT_BODY_TEMPLATE_ID: BodyTemplateId = 'none'

/**
 * Template variables surfaced as a compact chips row near the request body.
 * These mirror the runtime substitution syntax (see runtime templating).
 */
export const BODY_TEMPLATE_VARIABLES: readonly string[] = [
  '{{checkpoint.last_timestamp}}',
  '{{checkpoint.cursor}}',
  '{{now}}',
  '{{start_ts}}',
  '{{end_ts}}',
]

const ELASTICSEARCH_BODY = `{
  "size": 100,
  "sort": [
    {
      "timestamp": "asc"
    },
    {
      "_id": "asc"
    }
  ],
  "query": {
    "bool": {
      "filter": []
    }
  }
}`

const INCREMENTAL_TIMESTAMP_BODY = `{
  "from": "{{checkpoint.last_timestamp}}",
  "to": "{{now}}",
  "limit": 100
}`

const CURSOR_PAGINATION_BODY = `{
  "cursor": "{{checkpoint.cursor}}",
  "limit": 100
}`

const SECURITY_EVENTS_BODY = `{
  "query": {
    "severity": ["high", "critical"]
  },
  "limit": 100,
  "sort": "asc"
}`

export const BODY_TEMPLATES: readonly BodyTemplate[] = [
  {
    id: 'none',
    label: 'None / Empty body',
    description: 'Standard REST APIs that do not require a request body.',
    body: '',
  },
  {
    id: 'empty_json',
    label: 'Empty JSON Object',
    description: 'Minimal JSON body for APIs that require a JSON object.',
    body: '{}',
  },
  {
    id: 'elasticsearch_stellar',
    label: 'Elasticsearch / Stellar Search',
    description: 'Recommended for Elasticsearch/Stellar Cyber style search APIs.',
    body: ELASTICSEARCH_BODY,
  },
  {
    id: 'incremental_timestamp',
    label: 'Incremental Timestamp Polling',
    description: 'For APIs that poll by timestamp window.',
    body: INCREMENTAL_TIMESTAMP_BODY,
  },
  {
    id: 'cursor_pagination',
    label: 'Cursor Pagination',
    description: 'For APIs that use cursor-based pagination.',
    body: CURSOR_PAGINATION_BODY,
  },
  {
    id: 'security_events',
    label: 'Security Events Query',
    description: 'Common security event search pattern.',
    body: SECURITY_EVENTS_BODY,
  },
] as const

export function findBodyTemplate(id: BodyTemplateId): BodyTemplate {
  const t = BODY_TEMPLATES.find((row) => row.id === id)
  if (!t) throw new Error(`Unknown body template id: ${id}`)
  return t
}
