import { describe, expect, it } from 'vitest'
import {
  buildWizardDestinationsFromRouteSources,
  fullEventJsonataExpressionFromFieldMappings,
} from './wizard-stream-hydrate'
import type { MappingUIConfigRouteItem } from '../../../api/types/gdcApi'
import type { RouteRead } from '../../../api/gdcRoutes'
import { apiTestPatchFromPersistedSample } from './wizard-sample-persist'

describe('fullEventJsonataExpressionFromFieldMappings', () => {
  it('reads jsonata_expression for full_event_jsonata mappings', () => {
    expect(
      fullEventJsonataExpressionFromFieldMappings({
        mapping_mode: 'full_event_jsonata',
        jsonata_expression: '$merge([$, { "host": hostname }])',
      }),
    ).toBe('$merge([$, { "host": hostname }])')
  })

  it('falls back to legacy expression key when jsonata_expression is absent', () => {
    expect(
      fullEventJsonataExpressionFromFieldMappings({
        mapping_mode: 'full_event_jsonata',
        expression: '{ "id": id }',
      }),
    ).toBe('{ "id": id }')
  })

  it('returns empty string for non-jsonata mapping modes', () => {
    expect(
      fullEventJsonataExpressionFromFieldMappings({
        mapping_mode: 'basic_jsonpath',
        jsonata_expression: 'ignored',
      }),
    ).toBe('')
  })
})

describe('buildWizardDestinationsFromRouteSources', () => {
  it('prefers mapping-ui routes when both sources include the same route', () => {
    const mappingRoutes: MappingUIConfigRouteItem[] = [
      {
        route_id: 42,
        destination_id: 7,
        destination_name: 'Webhook A',
        destination_type: 'WEBHOOK_POST',
        route_enabled: true,
        destination_enabled: true,
        formatter_config: { message_prefix_enabled: true, message_prefix_template: 'custom-prefix' },
        route_rate_limit: { per_minute: 30 },
        failure_policy: 'RETRY_AND_BACKOFF',
      },
    ]
    const catalogRoutes: RouteRead[] = [
      {
        id: 42,
        stream_id: 10,
        destination_id: 7,
        enabled: false,
        failure_policy: 'LOG_AND_CONTINUE',
      },
    ]

    const result = buildWizardDestinationsFromRouteSources(mappingRoutes, catalogRoutes, [
      { id: 7, destination_type: 'WEBHOOK_POST' },
    ])

    expect(result.routeDrafts).toHaveLength(1)
    expect(result.routeDrafts[0]).toMatchObject({
      key: 'route-42',
      destinationId: 7,
      enabled: true,
      failurePolicy: 'RETRY_AND_BACKOFF',
    })
    expect(result.messagePrefixTemplate).toBe('custom-prefix')
  })

  it('falls back to catalog routes when mapping-ui routes are empty', () => {
    const catalogRoutes: RouteRead[] = [
      {
        id: 99,
        stream_id: 10,
        destination_id: 3,
        enabled: true,
        failure_policy: 'LOG_AND_CONTINUE',
        formatter_config_json: {
          message_prefix_enabled: false,
          message_prefix_template: 'from-catalog',
        },
      },
    ]

    const result = buildWizardDestinationsFromRouteSources([], catalogRoutes, [
      { id: 3, destination_type: 'SYSLOG_UDP' },
    ])

    expect(result.routeDrafts).toEqual([
      expect.objectContaining({
        key: 'route-99',
        destinationId: 3,
        enabled: true,
        failurePolicy: 'LOG_AND_CONTINUE',
      }),
    ])
    expect(result.destinationKindsById[3]).toBe('SYSLOG_UDP')
    expect(result.messagePrefixEnabledByDestinationId[3]).toBe(false)
    expect(result.messagePrefixTemplate).toBe('from-catalog')
  })

  it('merges mapping-ui and catalog-only routes without duplicates', () => {
    const mappingRoutes: MappingUIConfigRouteItem[] = [
      {
        route_id: 1,
        destination_id: 5,
        destination_name: 'A',
        destination_type: 'WEBHOOK_POST',
        route_enabled: true,
        destination_enabled: true,
        formatter_config: {},
        route_rate_limit: {},
        failure_policy: 'LOG_AND_CONTINUE',
      },
    ]
    const catalogRoutes: RouteRead[] = [
      { id: 1, stream_id: 10, destination_id: 5, enabled: true },
      { id: 2, stream_id: 10, destination_id: 6, enabled: true, failure_policy: 'DISABLE_ROUTE_ON_FAILURE' },
    ]

    const result = buildWizardDestinationsFromRouteSources(mappingRoutes, catalogRoutes, [
      { id: 5, destination_type: 'WEBHOOK_POST' },
      { id: 6, destination_type: 'SYSLOG_TCP' },
    ])

    expect(result.routeDrafts.map((draft) => draft.key)).toEqual(['route-1', 'route-2'])
    expect(result.routeDrafts[1]?.failurePolicy).toBe('DISABLE_ROUTE_ON_FAILURE')
  })
})

describe('hydrate sample-data restore', () => {
  it('apiTestPatchFromPersistedSample keeps empty fallback when no sample saved', () => {
    expect(apiTestPatchFromPersistedSample(null)).toBeNull()
  })

  it('restores union schema for Transform source-of-truth without re-test', () => {
    const patch = apiTestPatchFromPersistedSample({
      stream_id: 10,
      has_sample_data: true,
      last_test_response: { http_status: 200, finished_at: '2026-07-13T09:00:00.000Z' },
      sample_events: [{ host: 'a', message: 'm' }],
      sample_count: 1,
      union_schema: {
        total_events: 1,
        fields: [
          { field_path: 'host', field_type: 'string', occurrence_count: 1, sample_values: ['a'] },
          { field_path: 'message', field_type: 'string', occurrence_count: 1, sample_values: ['m'] },
        ],
      },
      event_root_path: null,
      record_path: '$',
      checkpoint_test_result: null,
      incremental_test_result: null,
      saved_at: '2026-07-13T09:00:00.000Z',
      message: 'ok',
    })
    expect(patch?.apiTest.unionSchema?.fields.map((f) => f.field_path)).toEqual(['host', 'message'])
    expect(patch?.apiTest.extractedEvents?.[0]).toEqual({ host: 'a', message: 'm' })
    expect(patch?.apiTest.status).toBe('success')
  })
})
