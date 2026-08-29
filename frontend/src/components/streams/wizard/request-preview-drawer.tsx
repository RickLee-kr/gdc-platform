import { Copy, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../../lib/utils'
import { ResizableSplit } from '../../ui/resizable-split'
import {
  Sheet,
  SheetBackdrop,
  SheetClose,
  SheetContent,
  SheetPortal,
  SheetTitle,
} from '../../ui/sheet'

export type RequestPreviewDrawerProps = {
  open: boolean
  title: string
  previewKindLabel: string
  onClose: () => void
  draft: string
  onDraftChange: (next: string) => void
  draftDisabled?: boolean
  draftPlaceholder?: string
  toolbar?: ReactNode
  footer?: ReactNode
  children?: ReactNode
  /** When true, template and test result share the body with a draggable divider. */
  splitResults?: boolean
}

function RequestTemplatePane({
  draft,
  onDraftChange,
  draftDisabled,
  draftPlaceholder,
  toolbar,
  fillHeight,
  className,
}: {
  draft: string
  onDraftChange: (next: string) => void
  draftDisabled?: boolean
  draftPlaceholder?: string
  toolbar?: ReactNode
  fillHeight?: boolean
  className?: string
}) {
  return (
    <div className={cn('flex h-full min-h-0 flex-col gap-2 px-4 py-3', fillHeight && 'flex-1', className)}>
      <div className="flex shrink-0 items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">Request template</p>
        {toolbar}
      </div>
      <textarea
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        spellCheck={false}
        disabled={draftDisabled}
        placeholder={draftPlaceholder}
        data-testid="request-preview-draft"
        className={cn(
          'gdc-thin-scroll block w-full rounded-md border border-slate-200/80 bg-slate-950 p-3 font-mono text-[11px] leading-snug text-emerald-200 placeholder:text-emerald-200/40 disabled:opacity-50 dark:border-gdc-border',
          fillHeight ? 'min-h-0 flex-1 resize-none' : 'h-[min(26vh,220px)] min-h-[140px] resize-y',
        )}
      />
    </div>
  )
}

function RequestResultsPane({ children, footer }: { children?: ReactNode; footer?: ReactNode }) {
  return (
    <div
      className="gdc-thin-scroll flex h-full min-h-0 flex-col gap-2 overflow-y-auto px-4 py-3"
      data-testid="request-preview-drawer-results"
    >
      {children}
      {footer ? <div className="shrink-0 text-[10px] text-slate-500 dark:text-gdc-mutedStrong">{footer}</div> : null}
    </div>
  )
}

export function RequestPreviewDrawer({
  open,
  title,
  previewKindLabel,
  onClose,
  draft,
  onDraftChange,
  draftDisabled = false,
  draftPlaceholder,
  toolbar,
  footer,
  children,
  splitResults = false,
}: RequestPreviewDrawerProps) {
  const templatePane = (
    <RequestTemplatePane
      draft={draft}
      onDraftChange={onDraftChange}
      draftDisabled={draftDisabled}
      draftPlaceholder={draftPlaceholder}
      toolbar={toolbar}
      fillHeight
    />
  )

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetPortal>
        <SheetBackdrop data-testid="request-preview-drawer-backdrop" className="bg-black/30" onClick={onClose} />
        <SheetContent
          className="max-w-xl border-slate-200 bg-white dark:border-gdc-border dark:bg-gdc-card"
          data-testid="request-preview-drawer"
          aria-label={title}
        >
        <div className="shrink-0 border-b border-slate-200 px-4 py-3 dark:border-gdc-border">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <SheetTitle className="text-sm text-slate-900 dark:text-slate-100">{title}</SheetTitle>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-gdc-mutedStrong">{previewKindLabel}</p>
            </div>
            <SheetClose
              onClick={onClose}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-gdc-rowHover"
              aria-label="Close request preview"
              data-testid="request-preview-drawer-close"
            >
              <X className="h-4 w-4" />
            </SheetClose>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {splitResults ? (
            <ResizableSplit
              direction="column"
              initialRatio={0.32}
              minFirstPx={100}
              minSecondPx={140}
              storageKey="gdc.wizard.request-preview.split"
              className="flex-1"
              first={templatePane}
              second={<RequestResultsPane footer={footer}>{children}</RequestResultsPane>}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <RequestTemplatePane
                draft={draft}
                onDraftChange={onDraftChange}
                draftDisabled={draftDisabled}
                draftPlaceholder={draftPlaceholder}
                toolbar={toolbar}
                fillHeight
                className="min-h-0 flex-1"
              />
              <div className="gdc-thin-scroll shrink-0 px-4 pb-3" data-testid="request-preview-drawer-hints">
                {children}
                {footer ? (
                  <div className="mt-2 text-[10px] text-slate-500 dark:text-gdc-mutedStrong">{footer}</div>
                ) : null}
              </div>
            </div>
          )}
        </div>
        </SheetContent>
      </SheetPortal>
    </Sheet>
  )
}

export function RequestPreviewCopyButton({
  disabled,
  onClick,
}: {
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-7 items-center gap-1 rounded border border-slate-200/90 bg-white px-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200 dark:hover:bg-gdc-rowHover"
    >
      <Copy className="h-3 w-3" aria-hidden />
      Copy
    </button>
  )
}
