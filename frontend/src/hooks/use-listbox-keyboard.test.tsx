import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useListboxKeyboard } from './use-listbox-keyboard'

function Harness({ count, onSelect }: { count: number; onSelect: (i: number) => void }) {
  const { activeIndex, onKeyDown } = useListboxKeyboard(count, onSelect)
  return (
    <div>
      <input aria-label="Search" onKeyDown={onKeyDown} />
      <span data-testid="active-index">{activeIndex}</span>
    </div>
  )
}

describe('useListboxKeyboard', () => {
  it('moves active index with ArrowDown / ArrowUp and selects with Enter', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<Harness count={3} onSelect={onSelect} />)
    const search = screen.getByLabelText('Search')
    search.focus()

    await user.keyboard('{ArrowDown}')
    expect(screen.getByTestId('active-index')).toHaveTextContent('0')
    await user.keyboard('{ArrowDown}')
    expect(screen.getByTestId('active-index')).toHaveTextContent('1')
    await user.keyboard('{ArrowUp}')
    expect(screen.getByTestId('active-index')).toHaveTextContent('0')
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith(0)
  })
})
