/** GDC simplified auth schema (manifest auth_schema.json). */
export type SchemaFormFieldType = 'string' | 'boolean' | 'number' | 'select' | 'password'

export type SchemaFormFieldDef = {
  name: string
  label?: string
  description?: string
  required?: boolean
  type?: SchemaFormFieldType
  min_length?: number
  max_length?: number
  enum?: string[]
  default?: unknown
  secret?: boolean
  hidden?: boolean
}

export type GdcAuthSchema = {
  type: string
  fields: SchemaFormFieldDef[]
}

/** JSON Schema Draft fragment (auth_schema.json alternative). */
export type JsonSchemaObject = {
  type?: string
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
}

export type JsonSchemaProperty = {
  type?: string
  title?: string
  description?: string
  default?: unknown
  enum?: string[]
  minLength?: number
  maxLength?: number
  const?: string
  'x-gdc-secret'?: boolean
  'x-gdc-hidden'?: boolean
  'x-gdc-widget'?: string
}

export type SchemaFormValues = Record<string, string | boolean | number>

export type SchemaFormValidationError = {
  field: string
  message: string
}
