import type { Dispatch, SetStateAction } from 'react'
import { JsonBlock, RowsTable, StatGrid } from '../observabilityUi'
import type { CtrlApiKey, ApiState } from '../runtimeTypes'

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

export function ControlTestSection(p: ControlTestSectionProps) {
  const { ctrlApi } = p
  const streamBusy = ctrlApi.streamStart.loading || ctrlApi.streamStop.loading
  const scr = p.streamControl.result

  return (
    <section className="panel control-test-panel panel-scroll">
      <div className="control-live-zone">
        <h2>Stream control</h2>
        <p className="warning-banner">
          Start / Stop persist stream enabled + status in the database. Does not invoke StreamRunner. Not a preview.
        </p>
        <p className="muted obs-hint">
          {'POST /api/v1/runtime/streams/{stream_id}/start | /stop — uses stream_id above'}
        </p>
        <div className="obs-controls">
          <button type="button" className="danger" disabled={streamBusy} onClick={p.streamControl.onStart}>
            Start stream
          </button>
          <button type="button" className="danger" disabled={streamBusy} onClick={p.streamControl.onStop}>
            Stop stream
          </button>
        </div>
        <div className="status">
          {streamBusy && <span className="loading">로딩 중...</span>}
          {(ctrlApi.streamStart.success || ctrlApi.streamStop.success) && (
            <span className="success">{ctrlApi.streamStart.success || ctrlApi.streamStop.success}</span>
          )}
          {(ctrlApi.streamStart.error || ctrlApi.streamStop.error) && (
            <pre className="error">{ctrlApi.streamStart.error || ctrlApi.streamStop.error}</pre>
          )}
        </div>
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
      </div>

      <div className="preview-only-zone">
        <h2 className="preview-only-title">Preview / test only</h2>
        <p className="muted">
          No checkpoint updates. No live destination delivery. Read-only or in-memory preview endpoints only.
        </p>

        <div className="control-subpanel">
          <h3>HTTP API test (preview)</h3>
          <p className="muted obs-hint">POST /api/v1/runtime/api-test/http</p>
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
          <div className="status">
            {ctrlApi.apiTest.loading && <span className="loading">로딩 중...</span>}
            {ctrlApi.apiTest.success && <span className="success">{ctrlApi.apiTest.success}</span>}
            {ctrlApi.apiTest.error && <pre className="error">{ctrlApi.apiTest.error}</pre>}
          </div>
          {p.apiTest.result && (
            <>
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

        <div className="control-subpanel">
          <h3>Mapping preview</h3>
          <p className="muted obs-hint">POST /api/v1/runtime/preview/mapping — preview only</p>
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
          <div className="status">
            {ctrlApi.mappingCtl.loading && <span className="loading">로딩 중...</span>}
            {ctrlApi.mappingCtl.success && <span className="success">{ctrlApi.mappingCtl.success}</span>}
            {ctrlApi.mappingCtl.error && <pre className="error">{ctrlApi.mappingCtl.error}</pre>}
          </div>
          {p.mappingPreview.result && (
            <>
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

        <div className="control-subpanel">
          <h3>Delivery format preview</h3>
          <p className="muted obs-hint">POST /api/v1/runtime/preview/format — preview only</p>
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
          <div className="status">
            {ctrlApi.formatPreview.loading && <span className="loading">로딩 중...</span>}
            {ctrlApi.formatPreview.success && <span className="success">{ctrlApi.formatPreview.success}</span>}
            {ctrlApi.formatPreview.error && <pre className="error">{ctrlApi.formatPreview.error}</pre>}
          </div>
          {p.formatPreview.result && (
            <>
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

        <div className="control-subpanel">
          <h3>Route delivery preview</h3>
          <p className="muted obs-hint">
            POST /api/v1/runtime/preview/route-delivery — uses route_id above; preview only (no sender / no live delivery)
          </p>
          <label>
            events (JSON array of final_event objects)
            <textarea value={p.routePreview.eventsJson} onChange={(e) => p.routePreview.setEventsJson(e.target.value)} spellCheck={false} />
          </label>
          <button type="button" disabled={ctrlApi.routeDeliveryPreview.loading} onClick={p.routePreview.onRun}>
            Run route delivery preview (preview only)
          </button>
          <div className="status">
            {ctrlApi.routeDeliveryPreview.loading && <span className="loading">로딩 중...</span>}
            {ctrlApi.routeDeliveryPreview.success && (
              <span className="success">{ctrlApi.routeDeliveryPreview.success}</span>
            )}
            {ctrlApi.routeDeliveryPreview.error && (
              <pre className="error">{ctrlApi.routeDeliveryPreview.error}</pre>
            )}
          </div>
          {p.routePreview.result && (
            <>
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
  )
}
