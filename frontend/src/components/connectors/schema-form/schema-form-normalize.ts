import type {
  GdcAuthSchema,
  JsonSchemaObject,
  JsonSchemaProperty,
  SchemaFormFieldDef,
  SchemaFormFieldType,
} from './schema-form-types'

function inferFieldType(prop: JsonSchemaProperty): SchemaFormFieldType {
  if (prop['x-gdc-secret'] || prop['x-gdc-widget'] === 'password') return 'password'
  if (prop.enum && prop.enum.length > 0) return 'select'
  if (prop.type === 'boolean') return 'boolean'
  if (prop.type === 'number' || prop.type === 'integer') return 'number'
  return 'string'
}

function jsonSchemaPropertyToField(name: string, prop: JsonSchemaProperty, required: boolean): SchemaFormFieldDef {
  return {
    name,
    label: prop.title ?? name,
    description: prop.description,
    required,
    type: inferFieldType(prop),
    min_length: prop.minLength,
    max_length: prop.maxLength,
    enum: prop.enum,
    default: prop.default ?? prop.const,
    secret: Boolean(prop['x-gdc-secret'] || prop['x-gdc-widget'] === 'password'),
    hidden: Boolean(prop['x-gdc-hidden'] || prop.const !== undefined),
  }
}

/** Normalize GDC fields schema or JSON Schema into a unified field list. */
export function normalizeAuthSchema(raw: unknown): { schema: GdcAuthSchema | null; error: string | null } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { schema: null, error: 'Auth schema must be a JSON object.' }
  }

  const obj = raw as Record<string, unknown>

  if (Array.isArray(obj.fields)) {
    const fields = obj.fields
      .filter((item): item is SchemaFormFieldDef => Boolean(item && typeof item === 'object' && typeof (item as SchemaFormFieldDef).name === 'string'))
      .map((field) => ({
        ...field,
        label: field.label ?? field.name,
      }))
    if (fields.length === 0) {
      return { schema: null, error: 'Auth schema fields array is empty.' }
    }
    const authType = typeof obj.type === 'string' ? obj.type : 'unknown'
    return { schema: { type: authType, fields }, error: null }
  }

  const jsonSchema = obj as JsonSchemaObject
  if (jsonSchema.properties && typeof jsonSchema.properties === 'object') {
    const requiredSet = new Set(jsonSchema.required ?? [])
    const fields = Object.entries(jsonSchema.properties)
      .map(([name, prop]) => jsonSchemaPropertyToField(name, prop, requiredSet.has(name)))
      .filter((field) => !field.hidden)
    if (fields.length === 0) {
      return { schema: null, error: 'JSON Schema has no renderable properties.' }
    }
    const authType =
      typeof obj.type === 'string'
        ? obj.type
        : String(jsonSchema.properties.auth_type?.const ?? 'unknown')
    return { schema: { type: authType, fields }, error: null }
  }

  return { schema: null, error: 'Unsupported auth schema format (expected fields[] or JSON Schema properties).' }
}

export function buildDefaultValues(schema: GdcAuthSchema): Record<string, string | boolean | number> {
  const values: Record<string, string | boolean | number> = {}
  for (const field of schema.fields) {
    if (field.default === undefined || field.default === null) continue
    if (field.type === 'boolean') {
      values[field.name] = Boolean(field.default)
    } else if (field.type === 'number') {
      values[field.name] = Number(field.default)
    } else {
      values[field.name] = String(field.default)
    }
  }
  return values
}
