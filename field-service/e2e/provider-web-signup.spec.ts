// Playwright smoke tests for provider web signup (resume token flow).
//
// Tests the new /provider/signup?t=<token> finish page and graceful handling
// of invalid/missing tokens.

import { test, expect } from '@playwright/test'

test.describe('provider web signup', () => {
  test('invalid token shows graceful error', async ({ page }) => {
    await page.goto('/provider/signup?t=does-not-exist-1234567890ab')
    await expect(page.getByText(/resume link unavailable|invalid|expired/i)).toBeVisible()
  })

  test('missing token parameter shows graceful error', async ({ page }) => {
    await page.goto('/provider/signup')
    // Either shows an error or redirects — must not 500 or show error boundary
    const response = await page.goto('/provider/signup')
    expect(response?.status()).toBeLessThan(500)
    await expect(page.locator('text=An unexpected error occurred')).toHaveCount(0)
    await expect(page.locator('text=Something went wrong on this page')).toHaveCount(0)
  })
})
