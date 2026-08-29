import * as React from 'react'
import { Button as BaseButton } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { gdcUi } from '../../lib/gdc-ui-tokens'
import { cn } from '../../lib/utils'

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-violet-500/40 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: gdcUi.primaryBtn,
        secondary: gdcUi.secondaryBtn,
        destructive:
          'rounded-lg border border-red-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-red-700 shadow-sm hover:bg-red-50 dark:border-red-500/40 dark:bg-gdc-card dark:text-red-200 dark:hover:bg-red-500/10',
        ghost:
          'rounded-lg px-2 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-gdc-mutedStrong dark:hover:bg-gdc-elevated dark:hover:text-gdc-foreground',
      },
      size: {
        default: 'h-9',
        sm: 'h-8',
        icon: 'h-8 w-8 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export type ButtonProps = React.ComponentPropsWithoutRef<typeof BaseButton> &
  VariantProps<typeof buttonVariants> & {
    loading?: boolean
  }

export const Button = React.forwardRef<HTMLElement, ButtonProps>(function Button(
  { className, variant, size, loading = false, disabled, type = 'button', children, ...props },
  ref,
) {
  return (
    <BaseButton
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
      {children}
    </BaseButton>
  )
})
