import { test, expect } from '@playwright/test'

/**
 * Keyboard accessibility smoke for Administration modals.
 * Requires a running frontend with admin credentials (same as other e2e suites).
 */
test.describe('Administration modal keyboard a11y', () => {
  test.skip(({ }, testInfo) => {
    // Opt-in suite — run with PLAYWRIGHT_ADMIN_A11Y=1 when environment is ready.
    testInfo.skip(!process.env.PLAYWRIGHT_ADMIN_A11Y, 'Set PLAYWRIGHT_ADMIN_A11Y=1 to enable')
  })

  test('Retention dialog traps focus and restores on Escape', async ({ page }) => {
    await page.goto('/settings/administration')
    const openBtn = page.getByRole('button', { name: /Edit policy|Retention/i }).first()
    await openBtn.focus()
    await openBtn.press('Enter')
    const dialog = page.getByTestId('admin-retention-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('aria-modal', 'true')

    // Tab should stay inside the dialog.
    await page.keyboard.press('Tab')
    const focusedInside = await page.evaluate(() => {
      const dlg = document.querySelector('[data-testid="admin-retention-dialog"]')
      return Boolean(dlg && dlg.contains(document.activeElement))
    })
    expect(focusedInside).toBe(true)

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(openBtn).toBeFocused()
  })
})
