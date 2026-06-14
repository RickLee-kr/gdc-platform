import { describe, expect, it } from 'vitest'
import {
  buildProtectionPathAliasMap,
  collectRuntimeEventFieldPaths,
  normalizeProtectionJsonPath,
  resolveProtectionFieldPath,
} from './wizard-data-protection-path-resolve'
import { buildInitialState } from './wizard-state'

describe('wizard-data-protection-path-resolve', () => {
  it('resolves mapping rename alias $.user.email → $.email', () => {
    const state = buildInitialState()
    state.mapping = [{ id: 'm1', outputField: 'email', sourceJsonPath: '$.user.email' }]
    state.apiTest.analysis = {
      sampleEvent: { user: { email: 'a@b.c' } },
      flatPreviewFields: ['$.user.email'],
      detectedArrays: [],
      detectedCheckpointCandidates: [],
      responseSummary: {
        root_type: 'object',
        approx_size_bytes: 10,
        top_level_keys: ['user'],
        item_count_root: 1,
        truncation: null,
      },
      selectedEventArrayDefault: null,
      previewError: null,
    }
    state.apiTest.extractedEvents = [{ user: { email: 'a@b.c' } }]

    const aliases = buildProtectionPathAliasMap(state)
    expect(aliases.get('$.user.email')).toBe('$.email')

    const runtimePaths = collectRuntimeEventFieldPaths({ email: 'a@b.c' })
    const resolved = resolveProtectionFieldPath('$.user.email', runtimePaths, aliases)
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.resolvedPath).toBe('$.email')
  })

  it('matches runtime path directly when already enriched', () => {
    const paths = collectRuntimeEventFieldPaths({ email: 'x', phone: '010' })
    const resolved = resolveProtectionFieldPath('$.email', paths, new Map())
    expect(resolved).toEqual({ ok: true, resolvedPath: '$.email' })
  })

  it('fails when path missing from runtime event', () => {
    const resolved = resolveProtectionFieldPath('$.missing', ['$.email'], new Map())
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) {
      expect(resolved.error).toContain('does not exist')
    }
  })

  it('normalizes paths without $ prefix', () => {
    expect(normalizeProtectionJsonPath('email')).toBe('$.email')
    expect(normalizeProtectionJsonPath('$.email')).toBe('$.email')
  })

  it('resolves regex output alias', () => {
    const state = buildInitialState()
    state.mappingMode = 'full_event_regex'
    state.fullEventRegexConfigJson = JSON.stringify({
      preserve_source: false,
      rules: [
        {
          output_field: 'extracted_email',
          source_path: '$.message',
          pattern: 'email=([^;]+)',
          group: 1,
        },
      ],
    })
    const aliases = buildProtectionPathAliasMap(state)
    expect(aliases.get('$.message')).toBe('$.extracted_email')
  })
})
