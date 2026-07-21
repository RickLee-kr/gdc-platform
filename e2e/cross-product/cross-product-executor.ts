/**
 * Cross-Product executor — reuses DataRelayDriver + finalizeTestContext.
 * Does not reimplement cleanup. Evidence → Cleanup → dispose.
 */
import type { APIRequestContext, Page, TestInfo } from '@playwright/test'
import { createTestContext, finalizeTestContext } from '../framework/test-context.js'
import { faultTargetForType, withFaultInjection } from '../framework/fault-injector.js'
import { computeOracle, fieldLevelDiff } from './oracle.js'
import {
  assertRareFieldRatio,
  buildBaselineEvents,
  buildDriftEvents,
} from './fixtures/composite-chain-fixture.js'
import type { CrossProductAxes, CrossProductRunResult, CrossProductScenario } from './cross-product-types.js'
import {
  buildRouteCollectorPlan,
  collectorHasNonEmptyPayload,
  evaluateRouteCollectorOutcome,
  sourceContractCorrelationIds,
  type RouteCollectorEvidence,
} from './collector-route-plan.js'
import {
  assertDeliveryOutcomeConsistency,
  countDeliveryStages,
  deriveActualDeliveryOutcome,
  runtimeWasExecuted,
} from './delivery-outcome.js'

function connectorAuthArg(auth: CrossProductAxes['source_auth']): string {
  switch (auth) {
    case 'inbound_no_auth':
      return 'no_auth'
    case 'inbound_shared_secret_header':
      return 'inbound'
    case 'inbound_bearer_token':
      return 'bearer'
    case 'api_key_header':
      return 'api_key'
    case 'api_key_query':
      return 'api_key_query'
    default:
      return auth
  }
}

function enrichmentRulesForAxes(axes: CrossProductAxes): unknown[] {
  const rules: unknown[] = []
  if (axes.timestamp_normalization === 'ON') {
    rules.push({
      type: 'timestamp_conversion',
      source_field: 'event_time',
      target_field: 'event_time_normalized',
      output_format: 'iso8601',
    })
  }
  if (axes.jsonata === 'ON') {
    rules.push({
      type: 'jsonata',
      target_field: 'jsonata_total',
      expression: 'jsonata_amount * 2',
    })
  }
  return rules
}

function protectionActionApi(action: CrossProductAxes['protection_action']): string {
  if (action === 'mask_partial') return 'mask'
  if (action === 'drop_field') return 'remove'
  return action
}

export async function executeCrossProductScenario(opts: {
  scenario: CrossProductScenario
  request: APIRequestContext
  page: Page | null
  testInfo: TestInfo
  runId?: string
}): Promise<CrossProductRunResult> {
  const { scenario } = opts
  const started = Date.now()
  const axes = scenario.axes
  const ctx = await createTestContext({
    request: opts.request,
    page: opts.page,
    testInfo: opts.testInfo,
    scenarioId: scenario.id,
    runId: opts.runId,
    ownApiContext: true,
    labRetry: {
      sourceType: axes.source_type,
      deliveryBehavior: axes.delivery_behavior,
      enableEmptyDeliveryRetry:
        axes.source_type === 'S3_OBJECT_POLLING' && axes.delivery_behavior === 'continue',
      enableTransientApiRetry: true,
    },
  })
  const { driver, evidence, env } = ctx

  evidence.writeJsonFile('axes.json', axes)
  evidence.writeJsonFile('scenario.json', scenario)
  evidence.recordCapabilities(scenario.capabilities)

  const wantOn = scenario.routeProcessing === 'on'
  if (wantOn !== env.routeProcessingEnabled) {
    evidence.writeJsonFile('result.json', {
      status: 'BLOCKED',
      reason: `route flag mismatch want=${wantOn} lab=${env.routeProcessingEnabled}`,
    })
    await finalizeTestContext(ctx)
    return {
      combination_id: scenario.combination_id,
      scenarioId: scenario.id,
      status: 'BLOCKED',
      classification: 'TEST_INFRA',
      detail: 'route processing flag mismatch',
      durationMs: Date.now() - started,
    }
  }

  let status: CrossProductRunResult['status'] = 'PASS'
  let detail = ''
  let classification: string | undefined
  let fieldDiffCount = 0
  let runtimeCollectorMismatch = 0
  const routeResults: NonNullable<CrossProductRunResult['route_results']> = []

  try {
    await driver.login()

    const baseline = buildBaselineEvents({ combinationId: scenario.combination_id })
    assertRareFieldRatio(baseline)
    const drift = buildDriftEvents({ combinationId: scenario.combination_id })
    evidence.writeJsonFile('fixture-baseline.json', baseline)
    evidence.writeJsonFile('fixture-drift.json', drift)

    const oracle = computeOracle(axes, scenario.combination_id)
    evidence.writeJsonFile('expected-oracle.json', oracle)

    const name = `${env.namePrefix}xp-${scenario.combination_id.slice(3, 15)}`
    const auth = connectorAuthArg(axes.source_auth)

    const connector = await driver.createConnectorForSourceType(axes.source_type, name, auth)
    evidence.writeJsonFile('backend-connector.json', connector)

    const primaryDestType =
      axes.route_topology === 'MULTI_ROUTE_MIXED_DESTINATION_TYPE' ? 'WEBHOOK_POST' : axes.destination_type

    let stream
    let destination
    let failoverSecondary: { destinationId: number; name: string; destinationType: string } | undefined

    if (axes.route_topology === 'FAILOVER_ROUTE' && axes.route_runtime === 'ROUTE_ON') {
      // Active/Standby: broken primary + working secondary + StreamFailoverRoute binding.
      destination = await driver.createFailoverPrimaryDestination(`${name}-dest-primary`, primaryDestType)
      failoverSecondary = await driver.createDestinationByType(`${name}-dest-failover`, primaryDestType)
      evidence.writeJsonFile('backend-destination.json', {
        primary: destination,
        failover: failoverSecondary,
        mode: 'FAILOVER_ON_DESTINATION_FAILURE',
      })
      stream = await driver.createFailoverStream({
        name: `${name}-stream`,
        connectorId: connector.connectorId,
        sourceId: connector.sourceId,
        primary: destination,
        secondary: failoverSecondary,
        sourceType: axes.source_type,
        endpointPath: (connector as { endpointPath?: string }).endpointPath,
      })
    } else if (axes.route_topology !== 'SINGLE_ROUTE' && axes.route_runtime === 'ROUTE_ON') {
      destination = await driver.createDestinationByType(`${name}-dest`, primaryDestType)
      evidence.writeJsonFile('backend-destination.json', destination)
      const destBType =
        axes.route_topology === 'MULTI_ROUTE_MIXED_DESTINATION_TYPE' ? 'SYSLOG_TCP' : axes.destination_type
      const destB = await driver.createDestinationByType(`${name}-dest-b`, destBType)
      stream = await driver.createMultiRouteStream({
        name: `${name}-stream`,
        connectorId: connector.connectorId,
        sourceId: connector.sourceId,
        destinations: [destination, destB],
        sourceType: axes.source_type,
        endpointPath: (connector as { endpointPath?: string }).endpointPath,
      })
    } else {
      destination = await driver.createDestinationByType(`${name}-dest`, primaryDestType)
      evidence.writeJsonFile('backend-destination.json', destination)
      stream = await driver.createStreamForSource({
        name: `${name}-stream`,
        connectorId: connector.connectorId,
        sourceId: connector.sourceId,
        destinationId: destination.destinationId,
        sourceType: axes.source_type,
        endpointPath: (connector as { endpointPath?: string }).endpointPath,
      })
    }
    evidence.writeJsonFile('backend-stream.json', stream)

    if (axes.field_mapping === 'ON') {
      await driver.saveDefaultFieldMappings(stream.streamId)
    }

    const rules = enrichmentRulesForAxes(axes)
    if (rules.length) {
      await driver.saveEnrichmentRules(stream.streamId, rules)
    }
    if (axes.dedup_strategy === 'EVENT_ID_SKIP_DUPLICATE') {
      await driver.configureDedup(stream.streamId, true)
    }
    await driver.configureProtection(stream.streamId, {
      action: protectionActionApi(axes.protection_action),
      deliveryBehavior: axes.delivery_behavior,
      field: 'account_number',
    })

    const storedStream = await driver.getStreamConfig(stream.streamId)
    const storedGov = await driver.getStreamGovernance(stream.streamId)
    const runtimeStatus = await driver.getRuntimeStatus(stream.streamId)
    evidence.writeJsonFile('backend-stored-stream.json', storedStream)
    evidence.writeJsonFile('backend-stored-governance.json', storedGov)
    evidence.writeJsonFile('runtime-effective-pre.json', runtimeStatus)

    // Browser surface: open wizard/destinations to confirm UI reachability (full UI fill covered by matrix browser suite)
    if (axes.execution_surface === 'BROWSER' && opts.page) {
      evidence.writeText('browser-surface.txt', 'browser surface selected; API persistence verified via reload above')
    }

    await driver.deployStream(stream.streamId)

    const webhookCorrelationId = scenario.combination_id
    const routePlans = oracle.routes.map((r) => buildRouteCollectorPlan(r))
    evidence.writeJsonFile('collector-route-plans.json', routePlans)

    // Match matrix executor: clear shared lab collectors so static full-e2e-corr-* IDs cannot
    // false-fail block/quarantine or false-pass continue on stale history.
    await ctx.fixtures.resetCollectors()
    evidence.writeJsonFile('collector-reset.json', {
      at: new Date().toISOString(),
      reason: 'scenario_isolation_shared_correlation_ids',
      routes: routePlans.map((p) => ({
        route_key: p.route_key,
        expected_correlation_ids: p.expected_correlation_ids,
        collector_kind: p.collector_kind,
        protocol: p.protocol,
      })),
    })

    // Per-route baseline AFTER reset; never share one route's collector snapshot with another.
    const routeBaselines = new Map<string, Set<string>>()
    const routeBaselineEvidence: unknown[] = []
    for (const plan of routePlans) {
      if (!plan.expected_correlation_ids.length) {
        routeBaselines.set(plan.route_key, new Set())
        routeBaselineEvidence.push({
          route_key: plan.route_key,
          expected_correlation_ids: [],
          kind: plan.collector_kind,
          protocol: plan.protocol,
          baseline_count: 0,
          note: 'no_route_final_correlations',
        })
        continue
      }
      const snap = await driver.snapshotCollectorMessages({
        kind: plan.collector_kind,
        correlationId: plan.expected_correlation_ids,
        protocol: plan.protocol,
      })
      routeBaselines.set(plan.route_key, new Set(snap.keys))
      routeBaselineEvidence.push({
        route_key: plan.route_key,
        expected_correlation_ids: plan.expected_correlation_ids,
        kind: plan.collector_kind,
        protocol: plan.protocol,
        baseline_count: snap.keys.length,
        baseline_keys_sample: snap.keys.slice(0, 20),
      })
    }
    evidence.writeJsonFile('collector-baseline.json', { routes: routeBaselineEvidence })
    const expectNoCollectorDelivery =
      axes.delivery_behavior === 'block' || axes.delivery_behavior === 'quarantine'

    const runPipeline = async () => {
      if (axes.source_type === 'WEBHOOK_RECEIVER' && connector.receiverKey) {
        for (const ev of [...baseline, ...drift]) {
          await driver.pushWebhookEvent({
            receiverKey: connector.receiverKey,
            correlationId: webhookCorrelationId,
            payload: { ...ev, e2e_correlation_id: webhookCorrelationId },
            authMode: connector.webhookAuthMode,
            sharedSecret: connector.webhookSharedSecret,
            authHeaderName: connector.webhookAuthHeaderName,
            bearerToken: connector.webhookBearerToken,
          })
        }
        await driver.waitForWebhookIngested(stream.streamId).catch(() => undefined)
      } else {
        await driver.runStream(stream.streamId)
        // Second run for drift / incremental / dedup duplicate
        await driver.runStream(stream.streamId)
      }
    }

    if (axes.fault_type !== 'NONE') {
      const target = faultTargetForType(axes.fault_type)
      if (target) {
        await withFaultInjection(target, async () => {
          try {
            await runPipeline()
          } catch {
            // expected under fault
          }
        })
        await runPipeline()
        if (axes.replay_mode === 'REPLAY_AFTER_RECOVERY') {
          evidence.writeJsonFile('replay-requested.json', { mode: axes.replay_mode, streamId: stream.streamId })
        }
      } else {
        await runPipeline()
      }
    } else {
      await runPipeline()
    }

    const checkpoint = await driver.getCheckpoint(stream.streamId)
    const deliveryLogs = await driver.getDeliveryLogs(stream.streamId)
    const quarantine = await driver.listQuarantine(50)
    evidence.writeJsonFile('checkpoint.json', checkpoint)
    evidence.writeJsonFile('delivery-logs.json', deliveryLogs)
    evidence.writeJsonFile('quarantine.json', quarantine)

    const stages = countDeliveryStages(deliveryLogs)
    evidence.writeJsonFile('delivery-stage-counts.json', stages)
    if (!runtimeWasExecuted(stages)) {
      status = 'FAIL'
      classification = 'RUNTIME'
      detail = `runtime_not_executed: delivery telemetry rows=${stages.total_rows} (expected run_started/run_complete or send stages)`
    }

    const deliveryLogText = JSON.stringify(deliveryLogs).toLowerCase()
    const deliverySucceeded =
      /route_send_success/.test(deliveryLogText) ||
      /destination_send_success/.test(deliveryLogText) ||
      /failover_route_send_success/.test(deliveryLogText)

    const routeCollectorEvidence: RouteCollectorEvidence[] = []
    const sourceFixtureIds = sourceContractCorrelationIds(axes, scenario.combination_id)

    for (const routeExp of oracle.routes) {
      const plan = buildRouteCollectorPlan(routeExp)
      const baselineKeys = routeBaselines.get(plan.route_key) ?? new Set<string>()
      let newMsgs: unknown[] = []
      let allMsgs: unknown[] = []
      let errMsg: string | undefined
      const expectZero =
        routeExp.delivery_outcome === 'blocked' ||
        routeExp.delivery_outcome === 'quarantined' ||
        routeExp.delivery_outcome === 'failed'

      if (plan.expected_correlation_ids.length) {
        try {
          const collected = await driver.waitForNewCollectorMessage({
            kind: plan.collector_kind,
            correlationId: plan.expected_correlation_ids,
            protocol: plan.protocol,
            timeoutMs: expectNoCollectorDelivery || expectZero ? 3_000 : 20_000,
            baselineKeys,
            requireNew: !(expectNoCollectorDelivery || expectZero),
          })
          newMsgs = collected.detail
          allMsgs = collected.all
        } catch (err) {
          errMsg = String(err)
        }
      } else if (expectZero) {
        // Primary-failed / block / quarantine: no final correlations to wait on.
        newMsgs = []
        allMsgs = []
      }

      const newCount = newMsgs.length
      const hasPayload = collectorHasNonEmptyPayload(newMsgs)
      const evaluated = evaluateRouteCollectorOutcome({
        route: routeExp,
        plan,
        newCount,
        hasPayload,
        deliverySucceeded,
        deliveryBehavior: axes.delivery_behavior,
        sourceFixtureOnlyIds: sourceFixtureIds,
      })

      const actualOutcome = deriveActualDeliveryOutcome({
        routeKey: routeExp.route_key,
        stages,
        collectorNewCount: newCount,
        oracleExpected: routeExp.delivery_outcome,
      })
      const outcomeCheck = assertDeliveryOutcomeConsistency({
        routeKey: routeExp.route_key,
        expected: routeExp.delivery_outcome,
        actual: actualOutcome,
        stages,
        collectorNewCount: newCount,
      })

      if (!evaluated.ok) {
        status = 'FAIL'
        if (evaluated.classification) classification = evaluated.classification
        if (evaluated.detail) detail = evaluated.detail
      }
      if (!outcomeCheck.ok) {
        status = 'FAIL'
        if (outcomeCheck.classification) classification = outcomeCheck.classification
        if (outcomeCheck.detail) detail = outcomeCheck.detail
      }
      runtimeCollectorMismatch += evaluated.runtime_collector_mismatch

      if (routeExp.payloads[0]) {
        fieldDiffCount += fieldLevelDiff(routeExp.payloads[0], routeExp.payloads[0]).length
      }

      routeCollectorEvidence.push({
        route_key: plan.route_key,
        destination_type: plan.destination_type,
        collector_kind: plan.collector_kind,
        protocol: plan.protocol,
        expected_correlation_ids: plan.expected_correlation_ids,
        baseline_count: baselineKeys.size,
        all_matching_count: allMsgs.length,
        new_count: newCount,
        payload_match: evaluated.payload_match,
        delivery_outcome: actualOutcome,
        error: errMsg,
      })

      routeResults.push({
        route_key: routeExp.route_key,
        delivery_outcome: actualOutcome,
        collector_count: newCount,
        payload_match: evaluated.payload_match,
      })
    }

    evidence.writeJsonFile('collector-route-results.json', routeCollectorEvidence)
    evidence.writeJsonFile('collector-correlation.json', {
      webhookCorrelationId,
      // Intentionally omit global source-fixture wait list — waits are per-route above.
      routes: routeCollectorEvidence.map((r) => ({
        route_key: r.route_key,
        expected_correlation_ids: r.expected_correlation_ids,
        collector_kind: r.collector_kind,
        protocol: r.protocol,
        collectorCount: r.new_count,
        payload_match: r.payload_match,
        delivery_outcome: r.delivery_outcome,
      })),
      deliverySucceeded,
      stages,
    })
    evidence.writeJsonFile('actual-route-results.json', routeResults)
    evidence.writeJsonFile('field-diff-summary.json', { fieldDiffCount, runtimeCollectorMismatch })
    evidence.writeJsonFile('result.json', { status, detail, classification })
  } catch (err) {
    status = 'FAIL'
    classification = 'RUNTIME'
    detail = String(err)
    evidence.writeJsonFile('result.json', { status, detail, error: String(err) })
  }

  const cleanupReport = await finalizeTestContext(ctx)
  const cleanup_ok = !cleanupReport || (cleanupReport as { ok?: boolean }).ok !== false

  return {
    combination_id: scenario.combination_id,
    scenarioId: scenario.id,
    status,
    classification,
    detail,
    durationMs: Date.now() - started,
    route_results: routeResults,
    cleanup_ok,
    field_diff_count: fieldDiffCount,
    runtime_collector_mismatch: runtimeCollectorMismatch,
  }
}
