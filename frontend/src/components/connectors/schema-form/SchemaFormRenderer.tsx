import { cn } from '../../../lib/utils'
import type { GdcAuthSchema, SchemaFormFieldDef, SchemaFormValidationError, SchemaFormValues } from './schema-form-types'

const inputCls =
  'h-9 w-full rounded-md border border-slate-200/90 bg-white px-2.5 text-[12px] text-slate-900 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400/30 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100'

export type SchemaFormRendererProps = {
  schema: GdcAuthSchema
  values: SchemaFormValues
  errors?: SchemaFormValidationError[]
  readOnly?: boolean
  onChange: (next: SchemaFormValues) => void
}

function fieldError(errors: SchemaFormValidationError[] | undefined, name: string): string | undefined {
  return errors?.find((item) => item.field === name)?.message
}

function renderControl(
  field: SchemaFormFieldDef,
  value: string | boolean | number | undefined,
  readOnly: boolean,
  onFieldChange: (name: string, next: string | boolean | number) => void,
) {
  const disabled = readOnly || field.hidden

  if (field.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-[12px] font-medium text-slate-800 dark:text-slate-200">
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(e) => onFieldChange(field.name, e.target.checked)}
          data-testid={`schema-field-${field.name}`}
        />
        {field.label ?? field.name}
      </label>
    )
  }

  if (field.type === 'select' || (field.enum && field.enum.length > 0)) {
    const options = field.enum ?? []
    return (
      <select
        value={value == null ? '' : String(value)}
        disabled={disabled}
        onChange={(e) => onFieldChange(field.name, e.target.value)}
        className={inputCls}
        data-testid={`schema-field-${field.name}`}
        aria-label={field.label ?? field.name}
      >
        {!field.required ? <option value="">Select…</option> : null}
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    )
  }

  const isSecret = field.secret || field.type === 'password'
  return (
    <input
      type={isSecret ? 'password' : field.type === 'number' ? 'number' : 'text'}
      value={value == null ? '' : String(value)}
      disabled={disabled}
      onChange={(e) =>
        onFieldChange(field.name, field.type === 'number' ? Number(e.target.value) : e.target.value)
      }
      placeholder={field.label ?? field.name}
      className={inputCls}
      data-testid={`schema-field-${field.name}`}
      aria-label={field.label ?? field.name}
      autoComplete={isSecret ? 'off' : undefined}
    />
  )
}

export function SchemaFormRenderer({ schema, values, errors, readOnly = false, onChange }: SchemaFormRendererProps) {
  function onFieldChange(name: string, next: string | boolean | number) {
    onChange({ ...values, [name]: next })
  }

  const visibleFields = schema.fields.filter((field) => !field.hidden)

  return (
    <div className="space-y-3" data-testid="schema-form-renderer">
      <p className="text-[11px] text-slate-500 dark:text-gdc-muted">
        Auth type: <span className="font-semibold text-slate-700 dark:text-slate-200">{schema.type}</span>
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {visibleFields.map((field) => {
          const err = fieldError(errors, field.name)
          const isCheckbox = field.type === 'boolean'
          return (
            <div
              key={field.name}
              className={cn('space-y-1', isCheckbox ? 'md:col-span-2' : undefined)}
              data-testid={`schema-field-row-${field.name}`}
            >
              {!isCheckbox ? (
                <label className="text-[11px] font-semibold text-slate-600 dark:text-gdc-mutedStrong">
                  {field.label ?? field.name}
                  {field.required ? <span className="text-red-500"> *</span> : null}
                </label>
              ) : null}
              {field.description && !isCheckbox ? (
                <p className="text-[10px] text-slate-500 dark:text-gdc-muted">{field.description}</p>
              ) : null}
              {renderControl(field, values[field.name], readOnly, onFieldChange)}
              {err ? (
                <p className="text-[11px] font-medium text-red-600 dark:text-red-300" data-testid={`schema-error-${field.name}`}>
                  {err}
                </p>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
