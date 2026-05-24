import { CHECKPOINT_TEMPLATE_VARIABLES } from './incremental-fetch-templates'

export const PAGINATION_QUERY_CHECKPOINT_HELPER =
  'Query params use the same explicit checkpoint variables as the request body. GDC substitutes them only where you configure them — standalone {{checkpoint}} is deprecated.'

export const PAGINATION_CURSOR_PARAM_PLACEHOLDER = 'e.g. cursor — value: {{checkpoint.next_cursor}}'

/** @deprecated Standalone {{checkpoint}} is not used in the edit-page UI. */
export const DEPRECATED_CHECKPOINT_PLACEHOLDER = '{{checkpoint}}'

export function normalizePaginationLabel(raw: string): string {
  const t = raw.trim()
  if (!t || t.toLowerCase() === 'none') return 'None'
  return raw.trim()
}

export function paginationQueryCheckpointVariable(paginationType: string): string {
  if (normalizePaginationLabel(paginationType) === 'None') return ''
  return '{{checkpoint.next_cursor}}'
}

export function buildApiTestParams(form: {
  paginationType: string
  cursorParam: string
}): Record<string, string> {
  if (normalizePaginationLabel(form.paginationType) === 'None') return {}
  const cp = form.cursorParam.trim()
  if (!cp) return {}
  return { [cp]: paginationQueryCheckpointVariable(form.paginationType) }
}

export function buildPersistParams(form: {
  paginationType: string
  cursorParam: string
}): Record<string, string> {
  if (normalizePaginationLabel(form.paginationType) === 'None') return {}
  const cp = form.cursorParam.trim()
  if (!cp) return {}
  return { [cp]: paginationQueryCheckpointVariable(form.paginationType) }
}

export { CHECKPOINT_TEMPLATE_VARIABLES }
