import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { TimezoneCombobox } from './timezone-combobox'

describe('TimezoneCombobox', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists UTC first, shows browser zone, and supports search', async () => {
    vi.stubGlobal('Intl', {
      ...Intl,
      supportedValuesOf: () => ['UTC', 'Asia/Seoul', 'Asia/Tokyo', 'Europe/Berlin', 'America/Los_Angeles'],
      DateTimeFormat: Intl.DateTimeFormat,
    })
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      locale: 'en-US',
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: 'Asia/Seoul',
    } as Intl.ResolvedDateTimeFormatOptions)

    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TimezoneCombobox value="UTC" onChange={onChange} data-testid="tz" />)

    await user.click(screen.getByTestId('tz-trigger'))
    expect(screen.getByTestId('tz-panel')).toBeInTheDocument()
    expect(screen.getByText(/Browser timezone: Asia\/Seoul/i)).toBeInTheDocument()

    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('UTC')

    await user.type(screen.getByTestId('tz-search'), 'tokyo')
    expect(screen.getByTestId('tz-option-Asia/Tokyo')).toBeInTheDocument()
    expect(screen.queryByTestId('tz-option-Europe/Berlin')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('tz-option-Asia/Tokyo'))
    expect(onChange).toHaveBeenCalledWith('Asia/Tokyo')
  })

  it('keeps an unknown saved value visible and warns', async () => {
    vi.stubGlobal('Intl', {
      ...Intl,
      supportedValuesOf: () => ['UTC', 'Asia/Seoul'],
      DateTimeFormat: Intl.DateTimeFormat,
    })
    const user = userEvent.setup()
    render(<TimezoneCombobox value="Legacy/BrokenZone" onChange={vi.fn()} data-testid="tz" />)
    expect(screen.getByTestId('tz-trigger')).toHaveTextContent('Legacy/BrokenZone')
    expect(screen.getByTestId('tz-invalid-warning')).toBeInTheDocument()

    await user.click(screen.getByTestId('tz-trigger'))
    expect(screen.getByTestId('tz-option-Legacy/BrokenZone')).toBeInTheDocument()
  })

  it('supports empty option for user preference', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <TimezoneCombobox
        value="Asia/Seoul"
        onChange={onChange}
        allowEmpty
        emptyLabel="Use platform / browser"
        data-testid="tz"
      />,
    )
    await user.click(screen.getByTestId('tz-trigger'))
    await user.click(screen.getByTestId('tz-option-empty'))
    expect(onChange).toHaveBeenCalledWith('')
  })
})
