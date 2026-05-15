import type { Dispatch, SetStateAction } from 'react'
import { useMemo, useState } from 'react'
import { JsonBlock, RowsTable, StatGrid } from '../observabilityUi'
import type { ApiState, CtrlApiKey, TabKey } from '../runtimeTypes'
import { RUNTIME_MESSAGES } from '../utils/runtimeMessages'
import { buildRuntimeReadinessSummary } from '../utils/runtimeReadiness'
import type { PersistedIds } from '../utils/runtimeState'
import { RuntimeMessage, RuntimeRequestStatus } from './runtime/RuntimeAlert'

export type ControlTestSectionProps = {
  ctrlApi: Record<CtrlApiKey, ApiState>
  streamControl: {
    result: Record<string, unknown> | null
    onStart: () => void
    onStop: () => void
  }
  apiTest: {
    source: string
    setSource: Dispatch<SetStateAction<string>>
    stream: string
    setStream: Dispatch<SetStateAction<string>>
    checkpoint: string
    setCheckpoint: Dispatch<SetStateAction<string>>
    onRun: () => void
    result: Record<string, unknown> | null
    extracted: unknown[]
  }
  mappingPreview: {
    rawResponse: string
    setRawResponse: Dispatch<SetStateAction<string>>
    fieldMappingsJson: string
    setFieldMappingsJson: Dispatch<SetStateAction<string>>
    enrichmentJson: string
    setEnrichmentJson: Dispatch<SetStateAction<string>>
    eventArrayPath: string
    setEventArrayPath: Dispatch<SetStateAction<string>>
    overridePolicy: string
    setOverridePolicy: Dispatch<SetStateAction<string>>
    onRun: () => void
    result: Record<string, unknown> | null
    previewEvents: unknown[]
  }
  formatPreview: {
    eventsJson: string
    setEventsJson: Dispatch<SetStateAction<string>>
    destinationType: string
    setDestinationType: Dispatch<SetStateAction<string>>
    formatterConfig: string
    setFormatterConfig: Dispatch<SetStateAction<string>>
    onRun: () => void
    result: Record<string, unknown> | null
  }
  routePreview: {
    eventsJson: string
    setEventsJson: Dispatch<SetStateAction<string>>
    onRun: () => void
    result: Record<string, unknown> | null
  }
}

export type RuntimeTestControlSectionProps = ControlTestSectionProps & {
  compactIdsLine: string
  ids: PersistedIds
  unsavedByTab: Record<TabKey, string[]>
}

function scrollToPanel(id: string) {
  const el = document.getElementById(id)
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

export function RuntimeTestControlSection(p: RuntimeTestControlSectionProps) {
  const { ctrlApi } = p
  const streamBusy = ctrlApi.streamStart.loading || ctrlApi.streamStop.loading
  const scr = p.streamControl.result
  const streamCtlSuccess = ctrlApi.streamStart.success || ctrlApi.streamStop.success
  const streamCtlError = ctrlApi.streamStart.error || ctrlApi.streamStop.error

  const [realControlAck, setRealControlAck] = useState(false)
  const [startConfirmTyped, setStartConfirmTyped] = useState('')
  const [stopConfirmTyped, setStopConfirmTyped] = useState('')

  const summary = useMemo(
    () => buildRuntimeReadinessSummary(p.ids, p.unsavedByTab),
    [p.ids, p.unsavedByTab],
  )

  const streamIdTrim = p.ids.streamId.trim()
  const expectedStartPhrase = `START ${streamIdTrim}`
  const expectedStopPhrase = `STOP ${streamIdTrim}`
  const startPhraseMatch = streamIdTrim.length > 0 && startConfirmTyped.trim() === expectedStartPhrase
  const stopPhraseMatch = streamIdTrim.length > 0 && stopConfirmTyped.trim() === expectedStopPhrase
  const startDisabled = streamBusy || !realControlAck || !streamIdTrim || !startPhraseMatch
  const stopDisabled = streamBusy || !realControlAck || !streamIdTrim || !stopPhraseMatch

  return (
    <section
      className="panel runtime-test-control-panel panel-scroll"
      role="region"
      aria-label={RUNTIME_MESSAGES.runtimeTestControlRegionLabel}
    >
      <h2 className="ui-section-header">{RUNTIME_MESSAGES.runtimeTestControlTitle}</h2>

      <div className="rtc-readiness-summary ui-helper-block" aria-label={RUNTIME_MESSAGES.readinessSummaryAriaLabel}>
        <h3 className="rtc-subheading">{RUNTIME_MESSAGES.readinessSummaryHeading}</h3>
        <ul className="rtc-readiness-list">
          {summary.rows.map((row) => (
            <li key={row.key} className={row.ok ? 'rtc-readiness-ok' : 'rtc-readiness-missing'}>
              <span className="rtc-readiness-mark" aria-hidden="true">
                {row.ok ? '✓' : '○'}
              </span>
              {row.label}
            </li>
          ))}
        </ul>
      </div>

      <section className="rtc-preview-zone" id="rtc-preview-zone-top" aria-labelledby="rtc-preview-heading">
        <h3 id="rtc-preview-heading" className="rtc-zone-heading">
          {RUNTIME_MESSAGES.runtimePreviewZoneHeading}
        </h3>
        <RuntimeMessage tone="warning-banner" as="div">
          {RUNTIME_MESSAGES.previewOnlyIntro}
        </RuntimeMessage>
        <RuntimeMessage tone="muted" as="div">
          {RUNTIME_MESSAGES.previewZoneTitle}: quick jumps scroll to each panel; Run buttons below invoke the same in-memory preview endpoints as before (no persistence).
        </RuntimeMessage>

        <ul className="rtc-preview-blurbs">
          <li>{RUNTIME_MESSAGES.runtimePreviewBlurbApiTest}</li>
          <li>{RUNTIME_MESSAGES.runtimePreviewBlurbMapping}</li>
          <li>{RUNTIME_MESSAGES.runtimePreviewBlurbFormat}</li>
          <li>{RUNTIME_MESSAGES.runtimePreviewBlurbRoute}</li>
        </ul>

        <div className="rtc-quick-actions ui-action-group" role="group" aria-label="Preview quick jumps">
          <button type="button" className="rtc-quick-btn" onClick={() => scrollToPanel('rtc-panel-api-test')}>
            {RUNTIME_MESSAGES.runtimeQuickJumpApiTest}
          </button>
          <button type="button" className="rtc-quick-btn" onClick={() => scrollToPanel('rtc-panel-mapping')}>
            {RUNTIME_MESSAGES.runtimeQuickJumpMapping}
          </button>
          <button type="button" className="rtc-quick-btn" onClick={() => scrollToPanel('rtc-panel-format')}>
            {RUNTIME_MESSAGES.runtimeQuickJumpFormat}
          </button>
          <button type="button" className="rtc-quick-btn" onClick={() => scrollToPanel('rtc-panel-route')}>
            {RUNTIME_MESSAGES.runtimeQuickJumpRoute}
          </button>
        </div>

        <p className="rtc-compact-ids-line">
          <strong>{RUNTIME_MESSAGES.runtimeSelectedIdsHeading}:</strong> <code>{p.compactIdsLine}</code>
        </p>

        <div className="rtc-prerequisites">
          <h4 className="rtc-prerequisites-heading">{RUNTIME_MESSAGES.runtimePreviewPrerequisitesHeading}</h4>
          {summary.previewPrerequisites.length === 0 ? (
            <p className="muted">{RUNTIME_MESSAGES.runtimePreviewPrerequisitesNone}</p>
          ) : (
            <ul>
              {summary.previewPrerequisites.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="preview-only-zone-inner">
          <div className="control-subpanel" id="rtc-panel-api-test">
            <h3>HTTP API test (preview)</h3>
            <RuntimeMessage tone="obs-hint">POST /api/v1/runtime/api-test/http</RuntimeMessage>
            <div className="section-grid control-json-grid">
              <label>
                source_config (JSON object)
                <textarea value={p.apiTest.source} onChange={(e) => p.apiTest.setSource(e.target.value)} spellCheck={false} />
              </label>
              <label>
                stream_config (JSON object)
                <textarea value={p.apiTest.stream} onChange={(e) => p.apiTest.setStream(e.target.value)} spellCheck={false} />
              </label>
              <label>
                checkpoint (optional JSON object)
                <textarea value={p.apiTest.checkpoint} onChange={(e) => p.apiTest.setCheckpoint(e.target.value)} spellCheck={false} />
              </label>
            </div>
            <button type="button" disabled={ctrlApi.apiTest.loading} onClick={p.apiTest.onRun}>
              Run HTTP API test (preview only)
            </button>
            <RuntimeRequestStatus
              loading={ctrlApi.apiTest.loading}
              success={ctrlApi.apiTest.success}
              error={ctrlApi.apiTest.error}
            />
            {p.apiTest.result && (
              <>
                <RuntimeMessage tone="result-summary">{RUNTIME_MESSAGES.previewSummaryHttpApiTest}</RuntimeMessage>
                <StatGrid
                  title="Summary"
                  data={{
                    event_count: p.apiTest.result.event_count as number,
                  }}
                />
                <JsonBlock title="raw_response" value={p.apiTest.result.raw_response} />
                <RowsTable title="extracted_events" rows={p.apiTest.extracted as unknown[]} />
              </>
            )}
          </div>

          <div className="control-subpanel" id="rtc-panel-mapping">
            <h3>Mapping preview</h3>
            <RuntimeMessage tone="obs-hint">POST /api/v1/runtime/preview/mapping — preview only</RuntimeMessage>
            <label>
              raw_response (JSON)
              <textarea value={p.mappingPreview.rawResponse} onChange={(e) => p.mappingPreview.setRawResponse(e.target.value)} spellCheck={false} />
            </label>
            <label>
              field_mappings (JSON object of string → JSONPath string)
              <textarea
                value={p.mappingPreview.fieldMappingsJson}
                onChange={(e) => p.mappingPreview.setFieldMappingsJson(e.target.value)}
                spellCheck={false}
              />
            </label>
            <label>
              enrichment (JSON object)
              <textarea value={p.mappingPreview.enrichmentJson} onChange={(e) => p.mappingPreview.setEnrichmentJson(e.target.value)} spellCheck={false} />
            </label>
            <label>
              event_array_path
              <input value={p.mappingPreview.eventArrayPath} onChange={(e) => p.mappingPreview.setEventArrayPath(e.target.value)} />
            </label>
            <label>
              override_policy
              <select value={p.mappingPreview.overridePolicy} onChange={(e) => p.mappingPreview.setOverridePolicy(e.target.value)}>
                <option value="KEEP_EXISTING">KEEP_EXISTING</option>
                <option value="OVERRIDE">OVERRIDE</option>
                <option value="ERROR_ON_CONFLICT">ERROR_ON_CONFLICT</option>
              </select>
            </label>
            <button type="button" disabled={ctrlApi.mappingCtl.loading} onClick={p.mappingPreview.onRun}>
              Run mapping preview (preview only)
            </button>
            <RuntimeRequestStatus
              loading={ctrlApi.mappingCtl.loading}
              success={ctrlApi.mappingCtl.success}
              error={ctrlApi.mappingCtl.error}
            />
            {p.mappingPreview.result && (
              <>
                <RuntimeMessage tone="result-summary">{RUNTIME_MESSAGES.previewSummaryMapping}</RuntimeMessage>
                <StatGrid
                  title="Counts"
                  data={{
                    input_event_count: p.mappingPreview.result.input_event_count as number,
                    mapped_event_count: p.mappingPreview.result.mapped_event_count as number,
                  }}
                />
                <RowsTable title="preview_events" rows={p.mappingPreview.previewEvents as unknown[]} />
              </>
            )}
          </div>

          <div className="control-subpanel" id="rtc-panel-format">
            <h3>Delivery format preview</h3>
            <RuntimeMessage tone="obs-hint">POST /api/v1/runtime/preview/format — preview only</RuntimeMessage>
            <label>
              events (JSON array of objects)
              <textarea value={p.formatPreview.eventsJson} onChange={(e) => p.formatPreview.setEventsJson(e.target.value)} spellCheck={false} />
            </label>
            <label>
              destination_type
              <select value={p.formatPreview.destinationType} onChange={(e) => p.formatPreview.setDestinationType(e.target.value)}>
                <option value="SYSLOG_UDP">SYSLOG_UDP</option>
                <option value="SYSLOG_TCP">SYSLOG_TCP</option>
                <option value="WEBHOOK_POST">WEBHOOK_POST</option>
              </select>
            </label>
            <label>
              formatter_config (JSON object)
              <textarea value={p.formatPreview.formatterConfig} onChange={(e) => p.formatPreview.setFormatterConfig(e.target.value)} spellCheck={false} />
            </label>
            <button type="button" disabled={ctrlApi.formatPreview.loading} onClick={p.formatPreview.onRun}>
              Run delivery format preview (preview only)
            </button>
            <RuntimeRequestStatus
              loading={ctrlApi.formatPreview.loading}
              success={ctrlApi.formatPreview.success}
              error={ctrlApi.formatPreview.error}
            />
            {p.formatPreview.result && (
              <>
                <RuntimeMessage tone="result-summary">{RUNTIME_MESSAGES.previewSummaryFormat}</RuntimeMessage>
                <StatGrid
                  title="Result summary"
                  data={{
                    destination_type: String(p.formatPreview.result.destination_type ?? ''),
                    message_count: p.formatPreview.result.message_count as number,
                  }}
                />
                <JsonBlock title="preview_messages" value={p.formatPreview.result.preview_messages} />
              </>
            )}
          </div>

          <div className="control-subpanel" id="rtc-panel-route">
            <h3>Route delivery preview</h3>
            <RuntimeMessage tone="obs-hint">
              POST /api/v1/runtime/preview/route-delivery — uses route_id above; preview only (no sender / no live delivery)
            </RuntimeMessage>
            <label>
              events (JSON array of final_event objects)
              <textarea value={p.routePreview.eventsJson} onChange={(e) => p.routePreview.setEventsJson(e.target.value)} spellCheck={false} />
            </label>
            <button type="button" disabled={ctrlApi.routeDeliveryPreview.loading} onClick={p.routePreview.onRun}>
              Run route delivery preview (preview only)
            </button>
            <RuntimeRequestStatus
              loading={ctrlApi.routeDeliveryPreview.loading}
              success={ctrlApi.routeDeliveryPreview.success}
              error={ctrlApi.routeDeliveryPreview.error}
            />
            {p.routePreview.result && (
              <>
                <RuntimeMessage tone="result-summary">{RUNTIME_MESSAGES.previewSummaryRouteDelivery}</RuntimeMessage>
                <StatGrid
                  title="Route context"
                  data={{
                    route_id: p.routePreview.result.route_id as number,
                    destination_id: p.routePreview.result.destination_id as number,
                    destination_type: String(p.routePreview.result.destination_type ?? ''),
                    route_enabled: p.routePreview.result.route_enabled as boolean,
                    destination_enabled: p.routePreview.result.destination_enabled as boolean,
                    message_count: p.routePreview.result.message_count as number,
                  }}
                />
                <JsonBlock title="resolved_formatter_config" value={p.routePreview.result.resolved_formatter_config} />
                <JsonBlock title="preview_messages" value={p.routePreview.result.preview_messages} />
              </>
            )}
          </div>
        </div>
      </section>

      <section className="rtc-real-control-zone control-live-zone" aria-labelledby="rtc-real-control-heading">
        <h3 id="rtc-real-control-heading" className="rtc-zone-heading">
          {RUNTIME_MESSAGES.runtimeRealControlZoneHeading}
        </h3>
        <RuntimeMessage tone="warning-banner">{RUNTIME_MESSAGES.realControlBanner}</RuntimeMessage>
        <RuntimeMessage tone="obs-hint">{RUNTIME_MESSAGES.streamControlEndpointHint}</RuntimeMessage>
        <RuntimeMessage tone="obs-hint">{RUNTIME_MESSAGES.runtimePreviewBeforeStartHint}</RuntimeMessage>
        <RuntimeMessage tone="muted">{RUNTIME_MESSAGES.runtimeRealControlPreviewSafetyNote}</RuntimeMessage>
        <p className="rtc-stream-id-line">
          <strong>stream_id:</strong> <code>{streamIdTrim || '—'}</code>
        </p>

        <label className="rtc-real-control-ack">
          <input
            type="checkbox"
            checked={realControlAck}
            onChange={(e) => setRealControlAck(e.target.checked)}
            aria-label={RUNTIME_MESSAGES.runtimeRealControlAckAriaLabel}
          />
          <span>{RUNTIME_MESSAGES.runtimeRealControlAckAriaLabel}</span>
        </label>

        <div className="rtc-typed-confirm-grid">
          <label>
            {RUNTIME_MESSAGES.runtimeControlStartConfirmLabel}
            <input
              value={startConfirmTyped}
              onChange={(e) => setStartConfirmTyped(e.target.value)}
              spellCheck={false}
            />
          </label>
          <p className="muted">
            <strong>{RUNTIME_MESSAGES.runtimeControlStartExpectedPrefix}</strong> <code>{expectedStartPhrase}</code>
          </p>
          {!startPhraseMatch && startConfirmTyped.trim().length > 0 ? (
            <RuntimeMessage tone="muted">{RUNTIME_MESSAGES.runtimeControlConfirmMismatchHint}</RuntimeMessage>
          ) : null}
        </div>

        <div className="rtc-typed-confirm-grid">
          <label>
            {RUNTIME_MESSAGES.runtimeControlStopConfirmLabel}
            <input
              value={stopConfirmTyped}
              onChange={(e) => setStopConfirmTyped(e.target.value)}
              spellCheck={false}
            />
          </label>
          <p className="muted">
            <strong>{RUNTIME_MESSAGES.runtimeControlStopExpectedPrefix}</strong> <code>{expectedStopPhrase}</code>
          </p>
          {!stopPhraseMatch && stopConfirmTyped.trim().length > 0 ? (
            <RuntimeMessage tone="muted">{RUNTIME_MESSAGES.runtimeControlConfirmMismatchHint}</RuntimeMessage>
          ) : null}
        </div>

        <div className="obs-controls rtc-real-control-buttons">
          <button type="button" className="danger" disabled={startDisabled} onClick={p.streamControl.onStart}>
            Start stream (REAL CONTROL)
          </button>
          <button type="button" className="danger" disabled={stopDisabled} onClick={p.streamControl.onStop}>
            Stop stream (REAL CONTROL)
          </button>
        </div>
        {!realControlAck ? (
          <RuntimeMessage tone="muted" as="p">
            Enable Start/Stop by confirming you understand real runtime effects (checkbox above).
          </RuntimeMessage>
        ) : null}
        {!streamIdTrim ? (
          <RuntimeMessage tone="muted" as="p">
            Enter stream_id in the toolbar before Start/Stop.
          </RuntimeMessage>
        ) : null}
        <RuntimeRequestStatus loading={streamBusy} success={streamCtlSuccess} error={streamCtlError} />
        {scr && (
          <StatGrid
            title="Last control response"
            data={{
              stream_id: scr.stream_id as number,
              enabled: scr.enabled as boolean,
              status: String(scr.status ?? ''),
              action: String(scr.action ?? ''),
              message: String(scr.message ?? ''),
            }}
          />
        )}
      </section>
    </section>
  )
}
