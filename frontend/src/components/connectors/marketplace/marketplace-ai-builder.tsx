import { Loader2, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import {
  createBuilderDraft,
  type MarketplaceBuilderDraftResponse,
  type MarketplaceCapabilitiesRead,
} from '../../../api/gdcMarketplace'
import {
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogPortal,
  DialogTitle,
} from '../../ui/dialog'

export type MarketplaceAiBuilderProps = {
  capabilities: MarketplaceCapabilitiesRead | null
  onClose: () => void
}

export function MarketplaceAiBuilder({ capabilities, onClose }: MarketplaceAiBuilderProps) {
  const [vendor, setVendor] = useState('')
  const [product, setProduct] = useState('')
  const [documentation, setDocumentation] = useState('')
  const [provider, setProvider] = useState<'fixture' | 'manual'>('fixture')
  const [supplied, setSupplied] = useState('')
  const [trustCandidate, setTrustCandidate] = useState<'Local Draft' | 'Imported Draft'>('Local Draft')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<MarketplaceBuilderDraftResponse | null>(null)

  const productionUnavailable = capabilities ? !capabilities.production_ai_provider_implemented : true

  async function onSubmit() {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      let supplied_translation: Record<string, unknown> | null = null
      if (provider === 'manual' && supplied.trim()) {
        try {
          supplied_translation = JSON.parse(supplied) as Record<string, unknown>
        } catch {
          setError('Supplied translation must be valid JSON.')
          setBusy(false)
          return
        }
      }
      const draft = await createBuilderDraft({
        provider_name: provider,
        vendor: vendor || undefined,
        product: product || undefined,
        documentation: documentation || undefined,
        supplied_translation,
        trust_candidate: trustCandidate,
      })
      setResult(draft)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogPortal>
        <DialogBackdrop className="bg-slate-900/40" />
        <DialogContent
          className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-0 shadow-xl dark:border-gdc-border dark:bg-gdc-card"
          data-testid="marketplace-ai-builder"
        >
        <div className="flex items-center justify-between border-b border-slate-200/80 px-4 py-3 dark:border-gdc-divider">
          <DialogTitle className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-gdc-foreground">
            <Sparkles className="h-4 w-4 text-violet-500" aria-hidden />
            Create with AI
          </DialogTitle>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close AI builder"
            data-testid="marketplace-ai-builder-close"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-gdc-elevated dark:hover:text-slate-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-4 py-3">
          {productionUnavailable ? (
            <p
              className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-[12px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
              data-testid="marketplace-ai-provider-unavailable"
            >
              Production network AI provider is unavailable. Drafts are generated deterministically with the{' '}
              <span className="font-mono">fixture</span> or <span className="font-mono">manual</span> provider and
              always result in a <span className="font-semibold">Local Draft</span> — never auto-published, installed,
              or connected to a credential/stream.
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] font-semibold text-slate-600 dark:text-gdc-muted">
              Vendor
              <input
                type="text"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                data-testid="marketplace-ai-builder-vendor"
                className="mt-0.5 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[12px] font-normal text-slate-800 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
              />
            </label>
            <label className="text-[11px] font-semibold text-slate-600 dark:text-gdc-muted">
              Product
              <input
                type="text"
                value={product}
                onChange={(e) => setProduct(e.target.value)}
                data-testid="marketplace-ai-builder-product"
                className="mt-0.5 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[12px] font-normal text-slate-800 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
              />
            </label>
          </div>

          <label className="mt-2 block text-[11px] font-semibold text-slate-600 dark:text-gdc-muted">
            Provider
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as 'fixture' | 'manual')}
              data-testid="marketplace-ai-builder-provider"
              className="mt-0.5 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[12px] font-normal text-slate-800 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
            >
              <option value="fixture">Fixture (deterministic sample)</option>
              <option value="manual">Manual (supplied translation)</option>
            </select>
          </label>

          {provider === 'manual' ? (
            <label className="mt-2 block text-[11px] font-semibold text-slate-600 dark:text-gdc-muted">
              Supplied translation (JSON)
              <textarea
                value={supplied}
                onChange={(e) => setSupplied(e.target.value)}
                rows={4}
                data-testid="marketplace-ai-builder-supplied"
                className="mt-0.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-[11px] font-normal text-slate-800 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
              />
            </label>
          ) : (
            <label className="mt-2 block text-[11px] font-semibold text-slate-600 dark:text-gdc-muted">
              Documentation excerpt (optional evidence)
              <textarea
                value={documentation}
                onChange={(e) => setDocumentation(e.target.value)}
                rows={4}
                data-testid="marketplace-ai-builder-documentation"
                className="mt-0.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-normal text-slate-800 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
              />
            </label>
          )}

          <label className="mt-2 block text-[11px] font-semibold text-slate-600 dark:text-gdc-muted">
            Trust candidate
            <select
              value={trustCandidate}
              onChange={(e) => setTrustCandidate(e.target.value as 'Local Draft' | 'Imported Draft')}
              data-testid="marketplace-ai-builder-trust-candidate"
              className="mt-0.5 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[12px] font-normal text-slate-800 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100"
            >
              <option value="Local Draft">Local Draft</option>
              <option value="Imported Draft">Imported Draft</option>
            </select>
          </label>

          {error ? (
            <p
              className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-[12px] text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"
              data-testid="marketplace-ai-builder-error"
            >
              {error}
            </p>
          ) : null}

          {result ? (
            <div
              className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-[12px] text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100"
              data-testid="marketplace-ai-builder-result"
            >
              <p className="font-semibold">
                {result.status} · Trust candidate: <span data-testid="marketplace-ai-builder-result-trust">{result.trust_candidate}</span>
              </p>
              <p>Package generated: {result.package_generated ? 'Yes' : 'No'}</p>
              {result.package_path ? <p className="break-all font-mono text-[10px]">{result.package_path}</p> : null}
              <p>Validation: {result.validation_status}</p>
              {result.open_questions.length > 0 ? (
                <div className="mt-1">
                  <p className="font-semibold">Open questions</p>
                  <ul className="list-inside list-disc">
                    {result.open_questions.map((q, i) => (
                      <li key={i}>{q.message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="mt-2 text-[11px] font-medium">
                This is a draft only. It has not been installed, published, or connected to any credential or stream.
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200/80 px-4 py-3 dark:border-gdc-divider">
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={busy}
            data-testid="marketplace-ai-builder-submit"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            Generate Draft
          </button>
        </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  )
}
