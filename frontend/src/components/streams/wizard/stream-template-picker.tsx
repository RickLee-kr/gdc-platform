import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { cn } from '../../../lib/utils'
import {
  fetchConnectorRegistryDetail,
  fetchConnectorRegistryResources,
  type ConnectorRegistryResourcesRead,
} from '../../../api/gdcConnectorsRegistry'

export type StreamTemplateOption = {
  id: string
  name: string
  description?: string | null
}

export type StreamTemplatePickerProps = {
  moduleId: string | null
  selectedTemplateIds: string[]
  onSelectionChange: (templateIds: string[]) => void
}

export function StreamTemplatePicker({
  moduleId,
  selectedTemplateIds,
  onSelectionChange,
}: StreamTemplatePickerProps) {
  const [loading, setLoading] = useState(false)
  const [resources, setResources] = useState<ConnectorRegistryResourcesRead | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!moduleId) {
      setResources(null)
      setLoadError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    void (async () => {
      const [detail, res] = await Promise.all([
        fetchConnectorRegistryDetail(moduleId),
        fetchConnectorRegistryResources(moduleId),
      ])
      if (cancelled) return
      if (!detail || detail.resolved.status === 'invalid') {
        setResources(null)
        setLoadError('Module is invalid or unavailable — use manual stream configuration.')
        setLoading(false)
        return
      }
      if (!res) {
        setResources(null)
        setLoadError('Stream templates unavailable — use manual stream configuration.')
        setLoading(false)
        return
      }
      setResources(res)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [moduleId])

  const options = useMemo((): StreamTemplateOption[] => {
    if (!resources) return []
    const manifestStreams = Object.keys(resources.streams)
    if (manifestStreams.length === 0) return []
    return manifestStreams
      .sort()
      .map((id) => {
        const tpl = resources.streams[id] ?? {}
        const name = typeof tpl.name === 'string' && tpl.name.trim() ? tpl.name.trim() : id
        const description = typeof tpl.description === 'string' ? tpl.description : null
        return { id, name, description }
      })
  }, [resources])

  useEffect(() => {
    if (!moduleId || options.length === 0) return
    const valid = new Set(options.map((o) => o.id))
    const pruned = selectedTemplateIds.filter((id) => valid.has(id))
    if (pruned.length !== selectedTemplateIds.length) {
      onSelectionChange(pruned)
    }
  }, [moduleId, options, onSelectionChange, selectedTemplateIds])

  if (!moduleId) return null

  if (loading) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg border border-slate-200/80 bg-slate-50/70 p-3 text-[12px] text-slate-600 dark:border-gdc-border dark:bg-gdc-card dark:text-gdc-muted"
        data-testid="stream-template-picker-loading"
      >
        <Loader2 className="h-4 w-4 animate-spin text-violet-600" aria-hidden />
        Loading stream templates…
      </div>
    )
  }

  if (loadError) {
    return (
      <div
        className="rounded-lg border border-amber-300/70 bg-amber-50 p-3 text-[12px] text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
        data-testid="stream-template-picker-fallback"
      >
        {loadError}
      </div>
    )
  }

  if (options.length === 0) {
    return (
      <div
        className="rounded-lg border border-slate-200/80 bg-slate-50/70 p-3 text-[12px] text-slate-600 dark:border-gdc-border dark:bg-gdc-card dark:text-gdc-muted"
        data-testid="stream-template-picker-empty"
      >
        No stream templates in this module — configure the stream manually in later steps.
      </div>
    )
  }

  const toggle = (templateId: string) => {
    if (selectedTemplateIds.includes(templateId)) {
      onSelectionChange(selectedTemplateIds.filter((id) => id !== templateId))
    } else {
      onSelectionChange([...selectedTemplateIds, templateId])
    }
  }

  return (
    <section
      className="rounded-lg border border-violet-200/70 bg-violet-50/40 p-3 dark:border-violet-500/30 dark:bg-violet-500/5"
      data-testid="stream-template-picker"
    >
      <div className="space-y-1">
        <h4 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Stream Templates</h4>
        <p className="text-[11px] text-slate-600 dark:text-gdc-muted">
          Select one or more endpoints to materialize with default mapping, enrichment, and checkpoint presets.
        </p>
      </div>
      <ul className="mt-3 space-y-2">
        {options.map((opt) => {
          const checked = selectedTemplateIds.includes(opt.id)
          return (
            <li key={opt.id}>
              <label
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 transition-colors',
                  checked
                    ? 'border-violet-400/70 bg-white dark:border-violet-500/50 dark:bg-gdc-card'
                    : 'border-slate-200/80 bg-white/80 hover:bg-white dark:border-gdc-border dark:bg-gdc-card/60',
                )}
                data-testid={`stream-template-option-${opt.id}`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                  checked={checked}
                  onChange={() => toggle(opt.id)}
                  data-testid={`stream-template-checkbox-${opt.id}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-semibold text-slate-900 dark:text-slate-100">{opt.name}</span>
                  {opt.description ? (
                    <span className="mt-0.5 block text-[11px] text-slate-600 dark:text-gdc-muted">{opt.description}</span>
                  ) : null}
                  <span className="mt-0.5 block font-mono text-[10px] text-slate-500 dark:text-gdc-muted">{opt.id}</span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
