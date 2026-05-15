export type MappingFieldType = 'string' | 'number' | 'datetime'

export type MappingEditRow = {
  id: string
  sourceJsonPath: string
  outputField: string
  type: MappingFieldType
  required: boolean
  defaultValue: string
  source: 'auto' | 'manual' | 'custom'
}
