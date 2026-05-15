import type { Dispatch, SetStateAction } from 'react'
import { prettyJson } from '../jsonUtils'
import type { ApiState, TabKey } from '../runtimeTypes'
import { TAB_LABELS } from '../runtimeTypes'
import { validateSourceSavePayload, validateStreamSavePayload } from '../utils/runtimeConfigValidation'
import { RUNTIME_MESSAGES, runtimeConfigActionChips } from '../utils/runtimeMessages'
import { RuntimeMessage, RuntimeRequestStatus } from './runtime/RuntimeAlert'
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
  reloadCurrentTab: () => void
  saveCurrentTab: () => void
  unsavedByTab: Record<TabKey, string[]>
  recommendedNextAction: string
  compactIdsLine: string
}

export function RuntimeConfigSection(p: RuntimeConfigSectionProps) {
  const tabBusy = p.apiState[p.activeTab].loading
  const tabHint: Record<TabKey, string> = {
    connector: 'Workflow: Load config -> metadata/status 점검 -> Save.',
    source: 'Workflow: config_json/auth_json/enabled 상태를 확인 후 Save.',
    stream: 'Workflow: polling_interval/config_json/rate_limit_json 점검 후 Save.',
    mapping: 'Workflow: Load mapping -> raw tree 클릭(JSONPath) -> preview 실행.',
    route: 'Workflow: route enabled/failure policy/formatter/rate limit 점검 후 Save.',
    destination: 'Workflow: destination enabled/config/rate limit 점검 후 Save.',
  }
  const unsavedItems = p.unsavedByTab[p.activeTab]
  const backendActionHint: Record<TabKey, string> = {
    connector: 'Backend actions: GET config load, POST save payload',
    source: 'Backend actions: GET config load, POST save payload',
    stream: 'Backend actions: GET config load, POST save payload',
    mapping: 'Backend actions: GET mapping config, POST preview only (save endpoint 없음)',
    route: 'Backend actions: GET config load, POST save payload',
    destination: 'Backend actions: GET config load, POST save payload',
  }

  const actionChips = runtimeConfigActionChips(p.activeTab)
  const sourceValidation = validateSourceSavePayload(p.sourceSave)
  const streamValidation = validateStreamSavePayload(p.streamSave)

  return (
    <>
      <nav className="tabs">
        {(Object.keys(TAB_LABELS) as TabKey[]).map((key) => (
          <button
            key={key}
            className={`runtime-tab-btn ${p.activeTab === key ? 'active' : ''}`}
            type="button"
            aria-label={TAB_LABELS[key]}
            onClick={() => p.setActiveTab(key)}
          >
            <span className="runtime-tab-label">{TAB_LABELS[key]}</span>
            {p.unsavedByTab[key].length > 0 ? (
              <span className="tab-dirty-badge" title={RUNTIME_MESSAGES.tabDirtyBadgeTitle}>
                {RUNTIME_MESSAGES.tabDirtyBadgeText}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      <section className="panel panel-scroll">
        <section
          className="config-operator-guidance"
          role="region"
          aria-label={RUNTIME_MESSAGES.configOperatorGuidanceRegionLabel}
        >
          <div className="config-operator-guidance-grid">
            <div className="config-next-action-callout">
              <strong className="config-next-action-label">Recommended next action</strong>
              <p className="config-next-action-body">{p.recommendedNextAction}</p>
            </div>
            <div className="config-ids-compact-block">
              <strong className="config-ids-compact-label">Selected IDs</strong>
              <code className="config-ids-compact-code">{p.compactIdsLine}</code>
            </div>
          </div>
          <div className="config-action-mode-chips" role="list" aria-label="Current tab action modes">
            {actionChips.map((chip) => (
              <span key={chip.key} role="listitem" className="action-mode-chip" data-action-mode={chip.mode}>
                {chip.label}
              </span>
            ))}
          </div>
        </section>

        <RuntimeRequestStatus
          loading={p.apiState[p.activeTab].loading}
          success={p.apiState[p.activeTab].success}
          error={p.apiState[p.activeTab].error}
        />
        <div className="tab-ergonomics">
          <button type="button" disabled={tabBusy} onClick={p.reloadCurrentTab}>
            Reload current tab
          </button>
          <button type="button" disabled={tabBusy || p.activeTab === 'mapping'} onClick={p.saveCurrentTab}>
            Save current tab
          </button>
        </div>
        <RuntimeMessage tone="config-tab-hint">{tabHint[p.activeTab]}</RuntimeMessage>
        <RuntimeMessage tone="config-tab-hint">{backendActionHint[p.activeTab]}</RuntimeMessage>
        <RuntimeMessage tone={unsavedItems.length > 0 ? 'unsaved-indicator' : 'muted'}>
          Unsaved local edits: {unsavedItems.length > 0 ? unsavedItems.join(', ') : 'none'}
        </RuntimeMessage>

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
              <RuntimeMessage tone="obs-hint">{RUNTIME_MESSAGES.frontendHintLabel}</RuntimeMessage>
              {sourceValidation.hints.length > 0 ? (
                <ul className="frontend-hint-list">
                  {sourceValidation.hints.map((hint) => (
                    <li key={hint}>{hint}</li>
                  ))}
                </ul>
              ) : (
                <RuntimeMessage tone="muted">Source payload passes current frontend checks.</RuntimeMessage>
              )}
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
              <RuntimeMessage tone="obs-hint">{RUNTIME_MESSAGES.frontendHintLabel}</RuntimeMessage>
              {streamValidation.hints.length > 0 ? (
                <ul className="frontend-hint-list">
                  {streamValidation.hints.map((hint) => (
                    <li key={hint}>{hint}</li>
                  ))}
                </ul>
              ) : (
                <RuntimeMessage tone="muted">Stream payload passes current frontend checks.</RuntimeMessage>
              )}
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
                <p className="error">
                  raw_response JSON 형식이 잘못되었습니다. JSON 문법을 수정하면 트리와 Preview가 다시 활성화됩니다.
                </p>
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
