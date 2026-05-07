import type { Dispatch, SetStateAction } from 'react'
import { prettyJson } from '../jsonUtils'
import type { ApiState, TabKey } from '../runtimeTypes'
import { TAB_LABELS } from '../runtimeTypes'
import { JsonTree } from './JsonTree'

export type MappingRow = { outputField: string; sourcePath: string; sampleValue: unknown }

export type RuntimeConfigSectionProps = {
  activeTab: TabKey
  setActiveTab: Dispatch<SetStateAction<TabKey>>
  apiState: Record<TabKey, ApiState>
  connectorConfig: string
  connectorSave: string
  setConnectorSave: Dispatch<SetStateAction<string>>
  loadConnector: () => void
  saveConnector: () => void
  sourceConfig: string
  sourceSave: string
  setSourceSave: Dispatch<SetStateAction<string>>
  loadSource: () => void
  saveSource: () => void
  streamConfig: string
  streamSave: string
  setStreamSave: Dispatch<SetStateAction<string>>
  loadStream: () => void
  saveStream: () => void
  mappingConfig: string
  mappingRawResponseJson: string
  setMappingRawResponseJson: Dispatch<SetStateAction<string>>
  mappingRows: MappingRow[]
  mappingEventArrayPath: string
  setMappingEventArrayPath: Dispatch<SetStateAction<string>>
  mappingEnrichmentJson: string
  setMappingEnrichmentJson: Dispatch<SetStateAction<string>>
  mappingOverridePolicy: string
  setMappingOverridePolicy: Dispatch<SetStateAction<string>>
  mappingPreviewResult: string
  selectedJsonPath: string
  mappingTargetField: string
  setMappingTargetField: Dispatch<SetStateAction<string>>
  setSelectedJsonPath: Dispatch<SetStateAction<string>>
  parsedRawResponseForTree: { ok: true; value: unknown } | { ok: false; value: null }
  loadMapping: () => void
  runMappingPreview: () => void
  appendJsonPath: () => void
  routeConfig: string
  routeSave: string
  setRouteSave: Dispatch<SetStateAction<string>>
  loadRoute: () => void
  saveRoute: () => void
  destinationConfig: string
  destinationSave: string
  setDestinationSave: Dispatch<SetStateAction<string>>
  loadDestination: () => void
  saveDestination: () => void
}

export function RuntimeConfigSection(p: RuntimeConfigSectionProps) {
  const tabBusy = p.apiState[p.activeTab].loading

  return (
    <>
      <nav className="tabs">
        {(Object.keys(TAB_LABELS) as TabKey[]).map((key) => (
          <button key={key} className={p.activeTab === key ? 'active' : ''} type="button" onClick={() => p.setActiveTab(key)}>
            {TAB_LABELS[key]}
          </button>
        ))}
      </nav>

      <section className="panel panel-scroll">
        <div className="status">
          {p.apiState[p.activeTab].loading && <span className="loading">로딩 중...</span>}
          {p.apiState[p.activeTab].success && <span className="success">{p.apiState[p.activeTab].success}</span>}
          {p.apiState[p.activeTab].error && <pre className="error">{p.apiState[p.activeTab].error}</pre>}
        </div>

        {p.activeTab === 'connector' && (
          <div className="section-grid">
            <div>
              <h2>Connector Config</h2>
              <button type="button" disabled={tabBusy} onClick={p.loadConnector}>
                Load
              </button>
              <textarea value={p.connectorConfig} readOnly spellCheck={false} />
            </div>
            <div>
              <h2>Connector Save Payload</h2>
              <button type="button" disabled={tabBusy} onClick={p.saveConnector}>
                Save
              </button>
              <textarea value={p.connectorSave} onChange={(e) => p.setConnectorSave(e.target.value)} spellCheck={false} />
            </div>
          </div>
        )}

        {p.activeTab === 'source' && (
          <div className="section-grid">
            <div>
              <h2>Source Config</h2>
              <button type="button" disabled={tabBusy} onClick={p.loadSource}>
                Load
              </button>
              <textarea value={p.sourceConfig} readOnly spellCheck={false} />
            </div>
            <div>
              <h2>Source Save Payload</h2>
              <button type="button" disabled={tabBusy} onClick={p.saveSource}>
                Save
              </button>
              <textarea value={p.sourceSave} onChange={(e) => p.setSourceSave(e.target.value)} spellCheck={false} />
            </div>
          </div>
        )}

        {p.activeTab === 'stream' && (
          <div className="section-grid">
            <div>
              <h2>Stream Config</h2>
              <button type="button" disabled={tabBusy} onClick={p.loadStream}>
                Load
              </button>
              <textarea value={p.streamConfig} readOnly spellCheck={false} />
            </div>
            <div>
              <h2>Stream Save Payload</h2>
              <button type="button" disabled={tabBusy} onClick={p.saveStream}>
                Save
              </button>
              <textarea value={p.streamSave} onChange={(e) => p.setStreamSave(e.target.value)} spellCheck={false} />
            </div>
          </div>
        )}

        {p.activeTab === 'mapping' && (
          <div className="mapping-layout">
            <div className="section-grid mapping-top">
              <div className="mapping-panel">
                <h2>Mapping UI Config</h2>
                <button type="button" disabled={tabBusy} onClick={p.loadMapping}>
                  Load
                </button>
                <textarea value={p.mappingConfig} readOnly spellCheck={false} />
                <h3 className="subheading">raw_response (editable — drives tree & preview)</h3>
                <textarea
                  className="raw-response-editor"
                  value={p.mappingRawResponseJson}
                  onChange={(e) => p.setMappingRawResponseJson(e.target.value)}
                  spellCheck={false}
                />
              </div>
              <div className="enrichment-panel">
                <h2>Enrichment</h2>
                <label>
                  override_policy
                  <select value={p.mappingOverridePolicy} onChange={(e) => p.setMappingOverridePolicy(e.target.value)}>
                    <option value="KEEP_EXISTING">KEEP_EXISTING</option>
                    <option value="OVERRIDE">OVERRIDE</option>
                    <option value="ERROR_ON_CONFLICT">ERROR_ON_CONFLICT</option>
                  </select>
                </label>
                <label>
                  enrichment JSON
                  <textarea value={p.mappingEnrichmentJson} onChange={(e) => p.setMappingEnrichmentJson(e.target.value)} spellCheck={false} />
                </label>
              </div>
            </div>

            <div className="mapping-tools">
              <h2>Mapping Table</h2>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>output_field</th>
                      <th>source_json_path</th>
                      <th>sample_value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.mappingRows.map((row) => (
                      <tr key={row.outputField}>
                        <td>{row.outputField}</td>
                        <td>{row.sourcePath}</td>
                        <td>
                          <code>{row.sampleValue === null ? '—' : prettyJson(row.sampleValue)}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="path-builder">
                <input
                  placeholder="target output_field"
                  value={p.mappingTargetField}
                  onChange={(e) => p.setMappingTargetField(e.target.value)}
                />
                <input placeholder="selected json path" value={p.selectedJsonPath} readOnly />
                <button type="button" disabled={tabBusy} onClick={p.appendJsonPath}>
                  Apply Selected Path
                </button>
              </div>
            </div>

            <div className="mapping-preview-block">
              <h2>Preview (no destination delivery)</h2>
              <label>
                event_array_path
                <input value={p.mappingEventArrayPath} onChange={(e) => p.setMappingEventArrayPath(e.target.value)} />
              </label>
              <button type="button" disabled={tabBusy} onClick={p.runMappingPreview}>
                POST /api/v1/runtime/preview/mapping
              </button>
              <textarea value={p.mappingPreviewResult} readOnly placeholder="preview response" spellCheck={false} />
            </div>

            <div className="mapping-tree-block">
              <h2>Raw Payload JSON Tree (click path)</h2>
              {!p.parsedRawResponseForTree.ok ? (
                <p className="muted">raw_response JSON이 유효하지 않습니다. 수정하면 트리가 갱신됩니다.</p>
              ) : (
                <JsonTree value={p.parsedRawResponseForTree.value} basePath="$" onPickPath={p.setSelectedJsonPath} />
              )}
            </div>
          </div>
        )}

        {p.activeTab === 'route' && (
          <div className="section-grid">
            <div>
              <h2>Route Config</h2>
              <button type="button" disabled={tabBusy} onClick={p.loadRoute}>
                Load
              </button>
              <textarea value={p.routeConfig} readOnly spellCheck={false} />
            </div>
            <div>
              <h2>Route Save Payload</h2>
              <button type="button" disabled={tabBusy} onClick={p.saveRoute}>
                Save
              </button>
              <textarea value={p.routeSave} onChange={(e) => p.setRouteSave(e.target.value)} spellCheck={false} />
            </div>
          </div>
        )}

        {p.activeTab === 'destination' && (
          <div className="section-grid">
            <div>
              <h2>Destination Config</h2>
              <button type="button" disabled={tabBusy} onClick={p.loadDestination}>
                Load
              </button>
              <textarea value={p.destinationConfig} readOnly spellCheck={false} />
            </div>
            <div>
              <h2>Destination Save Payload</h2>
              <button type="button" disabled={tabBusy} onClick={p.saveDestination}>
                Save
              </button>
              <textarea value={p.destinationSave} onChange={(e) => p.setDestinationSave(e.target.value)} spellCheck={false} />
            </div>
          </div>
        )}
      </section>
    </>
  )
}
