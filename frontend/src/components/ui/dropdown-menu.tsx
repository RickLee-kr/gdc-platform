import * as React from 'react'
import { Menu as BaseMenu } from '@base-ui/react/menu'
import { cn } from '../../lib/utils'

export type DropdownMenuProps = React.ComponentPropsWithoutRef<typeof BaseMenu.Root>

export function DropdownMenu(props: DropdownMenuProps) {
  return <BaseMenu.Root {...props} />
}

export type DropdownMenuTriggerProps = React.ComponentPropsWithoutRef<typeof BaseMenu.Trigger>

export const DropdownMenuTrigger = React.forwardRef<HTMLButtonElement, DropdownMenuTriggerProps>(
  function DropdownMenuTrigger({ className, type = 'button', ...props }, ref) {
    return (
      <BaseMenu.Trigger
        ref={ref}
        type={type}
        className={cn(
          'inline-flex items-center justify-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    )
  },
)

export type DropdownMenuContentProps = React.ComponentPropsWithoutRef<typeof BaseMenu.Popup> & {
  align?: React.ComponentPropsWithoutRef<typeof BaseMenu.Positioner>['align']
  side?: React.ComponentPropsWithoutRef<typeof BaseMenu.Positioner>['side']
  sideOffset?: number
}

export const DropdownMenuContent = React.forwardRef<HTMLDivElement, DropdownMenuContentProps>(
  function DropdownMenuContent(
    { className, align = 'end', side = 'bottom', sideOffset = 6, ...props },
    ref,
  ) {
    return (
      <BaseMenu.Portal>
        <BaseMenu.Positioner align={align} side={side} sideOffset={sideOffset} className="z-50 outline-none">
          <BaseMenu.Popup
            ref={ref}
            className={cn(
              'min-w-40 rounded-lg border border-slate-200 bg-white p-1 text-[12px] text-slate-800 shadow-lg outline-none',
              'dark:border-gdc-borderStrong dark:bg-gdc-elevated dark:text-gdc-foreground dark:shadow-gdc-elevated',
              className,
            )}
            {...props}
          />
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    )
  },
)

export type DropdownMenuItemProps = React.ComponentPropsWithoutRef<typeof BaseMenu.Item> & {
  destructive?: boolean
}

export const DropdownMenuItem = React.forwardRef<HTMLElement, DropdownMenuItemProps>(
  function DropdownMenuItem({ className, destructive = false, ...props }, ref) {
    return (
      <BaseMenu.Item
        ref={ref}
        className={cn(
          'flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 outline-none',
          'data-[highlighted]:bg-violet-50 data-[highlighted]:text-violet-800 data-[disabled]:opacity-50',
          'dark:data-[highlighted]:bg-gdc-cardHover dark:data-[highlighted]:text-gdc-foreground',
          destructive && 'text-red-700 dark:text-red-300',
          className,
        )}
        {...props}
      />
    )
  },
)

export type DropdownMenuSeparatorProps = React.ComponentPropsWithoutRef<typeof BaseMenu.Separator>

export function DropdownMenuSeparator({ className, ...props }: DropdownMenuSeparatorProps) {
  return <BaseMenu.Separator className={cn('my-1 h-px bg-slate-200 dark:bg-gdc-divider', className)} {...props} />
}
