/**
 * Data Relay Sheet — side/end overlay using Base UI Dialog (not vaul / Drawer).
 * Styled for operator drawers (policy, destination, wizard protection).
 */
import * as React from 'react'
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { cn } from '../../lib/utils'

type OpenChangeHandler = (open: boolean) => void

export type SheetSide = 'right' | 'bottom'

export type SheetProps = {
  open: boolean
  onOpenChange: OpenChangeHandler
  children: React.ReactNode
  disablePointerDismissal?: boolean
  modal?: boolean | 'trap-focus'
}

export function Sheet({
  open,
  onOpenChange,
  children,
  disablePointerDismissal = false,
  modal = true,
}: SheetProps) {
  return (
    <BaseDialog.Root
      open={open}
      onOpenChange={(next) => onOpenChange(next)}
      modal={modal}
      disablePointerDismissal={disablePointerDismissal}
    >
      {children}
    </BaseDialog.Root>
  )
}

export type SheetPortalProps = {
  children: React.ReactNode
  side?: SheetSide
  className?: string
}

export function SheetPortal({ children, side = 'right', className }: SheetPortalProps) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Viewport
        className={cn(
          'fixed inset-0 z-50 flex outline-none',
          side === 'right' ? 'justify-end' : 'items-end justify-center',
          className,
        )}
      >
        {children}
      </BaseDialog.Viewport>
    </BaseDialog.Portal>
  )
}

export type SheetBackdropProps = React.ComponentPropsWithoutRef<typeof BaseDialog.Backdrop>

export function SheetBackdrop({ className, ...props }: SheetBackdropProps) {
  return (
    <BaseDialog.Backdrop
      className={cn('fixed inset-0 z-50 bg-slate-900/40 dark:bg-black/50', className)}
      {...props}
    />
  )
}

export type SheetContentProps = React.ComponentPropsWithoutRef<typeof BaseDialog.Popup> & {
  side?: SheetSide
  'data-testid'?: string
}

export function SheetContent({ className, side = 'right', children, ...props }: SheetContentProps) {
  return (
    <BaseDialog.Popup
      className={cn(
        'relative z-50 flex h-full flex-col border-slate-200/90 bg-white shadow-xl outline-none dark:border-gdc-border dark:bg-gdc-card',
        side === 'right'
          ? 'w-full max-w-lg border-l'
          : 'max-h-[85vh] w-full rounded-t-2xl border-t',
        className,
      )}
      {...props}
    >
      {children}
    </BaseDialog.Popup>
  )
}

export type SheetTitleProps = React.ComponentPropsWithoutRef<typeof BaseDialog.Title>

export function SheetTitle({ className, ...props }: SheetTitleProps) {
  return (
    <BaseDialog.Title
      className={cn('text-[14px] font-semibold text-slate-900 dark:text-slate-100', className)}
      {...props}
    />
  )
}

export type SheetDescriptionProps = React.ComponentPropsWithoutRef<typeof BaseDialog.Description>

export function SheetDescription({ className, ...props }: SheetDescriptionProps) {
  return (
    <BaseDialog.Description
      className={cn('text-[11px] text-slate-500 dark:text-gdc-muted', className)}
      {...props}
    />
  )
}

export type SheetCloseProps = React.ComponentPropsWithoutRef<typeof BaseDialog.Close>

export function SheetClose({ className, ...props }: SheetCloseProps) {
  return <BaseDialog.Close className={cn(className)} {...props} />
}
