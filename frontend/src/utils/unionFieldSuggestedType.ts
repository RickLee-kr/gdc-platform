function leafSegment(fieldPath: string): string {
  const trimmed = fieldPath.trim()
  const leaf = trimmed.split('.').pop() ?? trimmed
  return leaf.replace(/\[\d+\]/g, '').replace(/^\$\.?/, '').toLowerCase()
}

/** Union Schema Field Detail Panel — minimal suggested type labels. */
export function suggestUnionFieldTypeLabel(fieldPath: string): string {
  const leaf = leafSegment(fieldPath)
  if (!leaf) return '—'
  if (leaf === 'email' || leaf === 'e_mail') return 'Email Address'
  if (leaf === 'api_key' || leaf === 'apikey') return 'API Key'
  if (leaf === 'credit_card' || leaf.includes('credit_card')) return 'Credit Card'
  return '—'
}
