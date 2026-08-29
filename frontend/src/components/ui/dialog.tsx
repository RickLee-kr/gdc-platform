/**
 * Data Relay Dialog — GDC-styled wrapper over Base UI Dialog.
 * Operators see Data Relay vocabulary only; Base UI is an implementation detail.
 */
import * as React from 'react'
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { cn } from '../../lib/utils'
import { gdcUi } from '../../lib/gdc-ui-tokens'

type OpenChangeHandler = (open: boolean) => void

export type DialogProps = {
  open: boolean
  onOpenChange: OpenChangeHandler
  children: React.ReactNode
  /** When true, backdrop / outside press does not close (default false). */
  disablePointerDismissal?: boolean
  modal?: boolean | 'trap-focus'
}

export function Dialog({
  open,
  onOpenChange,
  children,
  disablePointerDismissal = false,
  modal = true,
}: DialogProps) {
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

export type DialogPortalProps = {
  children: React.ReactNode
  className?: string
}

export function DialogPortal({ children, className }: DialogPortalProps) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Viewport
        className={cn(
          'fixed inset-0 z-50 flex items-center justify-center p-4 outline-none',
          className,
        )}
      >
        {children}
      </BaseDialog.Viewport>
    </BaseDialog.Portal>
  )
}

export type DialogBackdropProps = React.ComponentPropsWithoutRef<typeof BaseDialog.Backdrop>

export function DialogBackdrop({ className, ...props }: DialogBackdropProps) {
  return (
    <BaseDialog.Backdrop
      className={cn('fixed inset-0 z-50 bg-slate-950/50 dark:bg-black/60', className)}
      {...props}
    />
  )
}

export type DialogContentProps = React.ComponentPropsWithoutRef<typeof BaseDialog.Popup> & {
  /** Optional test id preserved for E2E contracts. */
  'data-testid'?: string
}

export function DialogContent({ className, children, ...props }: DialogContentProps) {
  return (
    <BaseDialog.Popup
      className={cn(gdcUi.modalPanel, 'relative z-50 outline-none', className)}
      {...props}
    >
      {children}
    </BaseDialog.Popup>
  )
}

export type DialogTitleProps = React.ComponentPropsWithoutRef<typeof BaseDialog.Title>

export function DialogTitle({ className, ...props }: DialogTitleProps) {
  return (
    <BaseDialog.Title
      className={cn('text-base font-semibold text-slate-900 dark:text-gdc-foreground', className)}
      {...props}
    />
  )
}

export type DialogDescriptionProps = React.ComponentPropsWithoutRef<typeof BaseDialog.Description>

export function DialogDescription({ className, ...props }: DialogDescriptionProps) {
  return (
    <BaseDialog.Description
      className={cn('text-[13px] text-slate-600 dark:text-gdc-muted', className)}
      {...props}
    />
  )
}

export type DialogCloseProps = React.ComponentPropsWithoutRef<typeof BaseDialog.Close>

export function DialogClose({ className, ...props }: DialogCloseProps) {
  return <BaseDialog.Close className={cn(className)} {...props} />
}
