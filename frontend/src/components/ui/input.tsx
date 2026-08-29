import * as React from 'react'
import { Input as BaseInput } from '@base-ui/react/input'
import { gdcUi } from '../../lib/gdc-ui-tokens'
import { cn } from '../../lib/utils'

export type InputProps = Omit<React.ComponentPropsWithoutRef<typeof BaseInput>, 'id'> & {
  id?: string
  label?: React.ReactNode
  error?: React.ReactNode
  containerClassName?: string
  labelClassName?: string
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    id: providedId,
    label,
    error,
    className,
    containerClassName,
    labelClassName,
    'aria-describedby': describedBy,
    'aria-invalid': ariaInvalid,
    ...props
  },
  ref,
) {
  const generatedId = React.useId()
  const id = providedId ?? generatedId
  const errorId = error ? `${id}-error` : undefined
  const descriptionIds = [describedBy, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('min-w-0', containerClassName)}>
      {label ? (
        <label htmlFor={id} className={cn('mb-1 block', gdcUi.formLabel, labelClassName)}>
          {label}
        </label>
      ) : null}
      <BaseInput
        ref={ref as React.Ref<HTMLElement>}
        id={id}
        aria-invalid={ariaInvalid ?? (error ? true : undefined)}
        aria-describedby={descriptionIds}
        className={cn(
          'w-full disabled:cursor-not-allowed disabled:opacity-50',
          gdcUi.input,
          error && 'border-red-500 focus:border-red-500 focus:ring-red-500/30',
          className,
        )}
        {...props}
      />
      {error ? (
        <p id={errorId} className="mt-1 text-[11px] text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  )
})
