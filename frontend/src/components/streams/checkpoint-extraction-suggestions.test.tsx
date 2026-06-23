import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { analyzeCheckpointExtractionSuggestions } from './checkpoint-extraction-suggestions'
import { CheckpointExtractionSuggestionsPanel } from './checkpoint-extraction-suggestions-panel'

const SAMPLE_PAYLOAD = {
  data: {
    events: [
      { id: 'evt-1', timestamp: '2026-01-01T00:00:00Z', _id: 'a1' },
      { id: 'evt-2', timestamp: '2026-01-02T00:00:00Z', _id: 'a2' },
    ],
    next_cursor: 'cursor-page-2',
  },
}

describe('analyzeCheckpointExtractionSuggestions', () => {
  it('detects likely event array path', () => {
    const result = analyzeCheckpointExtractionSuggestions(SAMPLE_PAYLOAD)
    expect(result.suggestedEventArrayPath).toBe('$.data.events')
    expect(result.detectedEventArrayCandidates.length).toBeGreaterThan(0)
  })

  it('detects timestamp checkpoint candidate and sort recommendation', () => {
    const result = analyzeCheckpointExtractionSuggestions(SAMPLE_PAYLOAD)
    expect(result.suggestedCheckpointType).toBe('TIMESTAMP')
    expect(result.suggestedExtractionPathRelative).toContain('timestamp')
    expect(result.suggestedSort).toMatch(/timestamp ASC/i)
    expect(result.suggestedTieBreaker).toMatch(/_id ASC/i)
  })

  it('warns when ascending sort is not present in the sample request body', () => {
    const result = analyzeCheckpointExtractionSuggestions(SAMPLE_PAYLOAD)
    expect(result.warnings.some((w) => w.includes('ascending sort'))).toBe(true)
  })

  it('detects cursor field at response root', () => {
    const result = analyzeCheckpointExtractionSuggestions(SAMPLE_PAYLOAD)
    expect(result.detectedCheckpointCandidates.some((c) => c.checkpointType === 'CURSOR')).toBe(true)
    expect(result.warnings.some((w) => w.includes('next cursor extraction'))).toBe(true)
  })

  it('detects event ID fields on sample events', () => {
    const payload = {
      items: [{ event_id: '100', created_at: '2026-01-01T00:00:00Z' }],
    }
    const result = analyzeCheckpointExtractionSuggestions(payload)
    expect(result.detectedCheckpointCandidates.some((c) => c.checkpointType === 'EVENT_ID')).toBe(true)
  })

  it('flags full-fetch risk when body has no checkpoint fields', () => {
    const result = analyzeCheckpointExtractionSuggestions({ limit: 1000 })
    expect(result.warnings.some((w) => w.includes('No likely event array path'))).toBe(true)
  })

  it('prefers scalar values[0] paths for wrapped Cybereason creationTime objects', () => {
    const payload = {
      data: {
        result: [
          {
            simpleValues: {
              creationTime: { values: ['1722202400000'] },
            },
          },
        ],
      },
    }
    const result = analyzeCheckpointExtractionSuggestions(payload)
    const scalarPath = result.detectedCheckpointCandidates.find((c) => c.path.endsWith('.values[0]'))
    expect(scalarPath?.path).toContain('creationTime.values[0]')
    expect(scalarPath?.checkpointType).toBe('TIMESTAMP')
  })
})

describe('CheckpointExtractionSuggestionsPanel', () => {
  it('renders suggested fields and warnings', () => {
    render(<CheckpointExtractionSuggestionsPanel parsedJson={SAMPLE_PAYLOAD} />)
    expect(screen.getByTestId('checkpoint-extraction-suggestions-panel')).toBeInTheDocument()
    expect(screen.getByText('Checkpoint Extraction Suggestions')).toBeInTheDocument()
    expect(screen.getByText('TIMESTAMP')).toBeInTheDocument()
    expect(screen.getByText(/Suggested event array path/)).toBeInTheDocument()
    expect(screen.getByText('Warnings')).toBeInTheDocument()
    expect(screen.getByText(/GDC only injects checkpoint variables where configured/)).toBeInTheDocument()
  })

  it('apply suggestion buttons update form state via handlers', async () => {
    const user = userEvent.setup()
    const onApplyEventArrayPath = vi.fn()
    const onApplyCheckpointExtraction = vi.fn()
    const onApplySortRecommendation = vi.fn()

    render(
      <CheckpointExtractionSuggestionsPanel
        parsedJson={SAMPLE_PAYLOAD}
        applyHandlers={{
          onApplyEventArrayPath,
          onApplyCheckpointExtraction,
          onApplySortRecommendation,
        }}
      />,
    )

    await user.click(screen.getByTestId('apply-event-array-path'))
    expect(onApplyEventArrayPath).toHaveBeenCalledWith('$.data.events')

    await user.click(screen.getByTestId('apply-checkpoint-extraction'))
    expect(onApplyCheckpointExtraction).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpointType: 'TIMESTAMP',
        extractionPathRelative: expect.stringContaining('timestamp'),
      }),
    )

    await user.click(screen.getByTestId('apply-sort-recommendation'))
    expect(onApplySortRecommendation).toHaveBeenCalledWith(
      expect.objectContaining({ primaryFieldName: 'timestamp' }),
    )
  })
})
