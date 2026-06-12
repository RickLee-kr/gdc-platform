#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const statsPath = resolve(__dirname, '../dist/bundle-stats.json')
function detectMainChunk(raw) {
  const names = new Set()
  for (const meta of Object.values(raw.nodeMetas ?? {})) {
    for (const key of Object.keys(meta.moduleParts ?? {})) {
      if (key.startsWith('assets/index-') && key.endsWith('.js')) names.add(key)
    }
  }
  const list = [...names]
  if (list.length === 1) return list[0]
  return list.sort((a, b) => b.length - a.length)[0] ?? 'assets/index.js'
}

function fmt(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function normalizeId(id) {
  return id
    .replace(/\0/g, '')
    .replace(/^\/home\/aella\/gdc-platform\/frontend\//, '')
    .replace(/\?commonjs-(exports|proxy|module|es-import|require)$/, '')
}

const raw = JSON.parse(readFileSync(statsPath, 'utf8'))
const { nodeMetas, nodeParts } = raw
const MAIN_CHUNK = detectMainChunk(raw)

const metaByUid = nodeMetas
const modules = []
for (const [partUid, part] of Object.entries(nodeParts)) {
  if (!part?.renderedLength || !part.metaUid) continue
  const meta = metaByUid[part.metaUid]
  if (!meta?.moduleParts?.[MAIN_CHUNK]) continue
  if (meta.moduleParts[MAIN_CHUNK] !== partUid) continue
  modules.push({
    id: normalizeId(meta.id ?? ''),
    renderedLength: part.renderedLength,
    gzipLength: part.gzipLength ?? null,
    brotliLength: part.brotliLength ?? null,
  })
}

modules.sort((a, b) => b.renderedLength - a.renderedLength)
const total = modules.reduce((s, m) => s + m.renderedLength, 0)

const top20 = modules.slice(0, 20).map((m, i) => ({
  rank: i + 1,
  id: m.id,
  rendered: m.renderedLength,
  renderedFmt: fmt(m.renderedLength),
  gzip: m.gzipLength,
  gzipFmt: m.gzipLength != null ? fmt(m.gzipLength) : null,
  pct: `${((100 * m.renderedLength) / total).toFixed(1)}%`,
}))

function sumMatching(pred) {
  const hits = modules.filter((m) => pred(m.id))
  const rendered = hits.reduce((s, m) => s + m.renderedLength, 0)
  return { moduleCount: hits.length, rendered, renderedFmt: fmt(rendered), pct: `${((100 * rendered) / total).toFixed(1)}%` }
}

const categories = {
  recharts: sumMatching((id) => id.includes('node_modules/recharts') || id.includes('node_modules/@reduxjs') || id.includes('node_modules/es-toolkit') || id.includes('node_modules/d3-')),
  dashboard: sumMatching((id) => id.includes('/components/dashboard/') || id.includes('/api/dashboard') || id.includes('/api/observability') || id.includes('/api/streamsKpi')),
  governance: sumMatching((id) => id.includes('/components/governance/') || id.includes('/lib/governance') || id.includes('/api/gdcGovernance')),
  wizard: sumMatching((id) => id.includes('/components/streams/wizard/') || id.includes('/components/streams/new-stream-wizard') || id.includes('wizard-state')),
  aiGateway: sumMatching((id) => id.includes('/components/ai-gateway/') || id.includes('/api/gdcAi')),
  monaco: sumMatching((id) => id.includes('monaco') || id.includes('@monaco-editor')),
  jsonEditor: sumMatching((id) => id.includes('jsoneditor') || id.includes('json-editor') || id.includes('@uiw/react-json')),
  routes: sumMatching((id) => id.includes('/components/routes/')),
  streams: sumMatching((id) => id.includes('/components/streams/') && !id.includes('/wizard/')),
  logs: sumMatching((id) => id.includes('/components/logs/')),
  runtime: sumMatching((id) => id.includes('/components/runtime/')),
  lucide: sumMatching((id) => id.includes('node_modules/lucide-react')),
  reactRouter: sumMatching((id) => id.includes('node_modules/react-router')),
  reactDom: sumMatching((id) => id.includes('node_modules/react-dom')),
  reactCore: sumMatching((id) => id.includes('node_modules/react/') || id === 'node_modules/react/index.js'),
}

console.log(JSON.stringify({ mainChunk: MAIN_CHUNK, totalRendered: total, totalFormatted: fmt(total), top20, categories }, null, 2))
