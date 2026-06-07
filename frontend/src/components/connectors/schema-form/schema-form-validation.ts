import type { GdcAuthSchema, SchemaFormFieldDef, SchemaFormValidationError, SchemaFormValues } from './schema-form-types'

function validateField(field: SchemaFormFieldDef, raw: unknown): string | null {
  const label = field.label ?? field.name

  if (field.type === 'boolean') {
    if (field.required && typeof raw !== 'boolean') {
      return `${label} is required.`
    }
    return null
  }

  const value = raw == null ? '' : String(raw)
  const trimmed = value.trim()

  if (field.required && !trimmed) {
    return `${label} is required.`
  }

  if (!trimmed) return null

  if (field.min_length != null && trimmed.length < field.min_length) {
    return `${label} must be at least ${field.min_length} characters.`
  }

  if (field.max_length != null && trimmed.length > field.max_length) {
    return `${label} must be at most ${field.max_length} characters.`
  }

  if (field.enum && field.enum.length > 0 && !field.enum.includes(trimmed)) {
    return `${label} must be one of: ${field.enum.join(', ')}.`
  }

  return null
}

export function validateSchemaForm(schema: GdcAuthSchema, values: SchemaFormValues): SchemaFormValidationError[] {
  const errors: SchemaFormValidationError[] = []
  for (const field of schema.fields) {
    if (field.hidden) continue
    const message = validateField(field, values[field.name])
    if (message) {
      errors.push({ field: field.name, message })
    }
  }
  return errors
}

export function schemaFormHasErrors(schema: GdcAuthSchema, values: SchemaFormValues): boolean {
  return validateSchemaForm(schema, values).length > 0
}
