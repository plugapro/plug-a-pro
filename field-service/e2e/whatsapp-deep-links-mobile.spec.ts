import { expect, test } from '@playwright/test'

test.describe('WhatsApp deep links (mobile, logged out)', () => {
  test.skip(({ isMobile }) => !isMobile, 'Runs only on mobile projects')

  test('provider View Lead signed link opens without login', async ({ page }) => {
    const leadUrl = process.env.E2E_PROVIDER_LEAD_URL
    test.skip(!leadUrl, 'E2E_PROVIDER_LEAD_URL not set — skipping provider lead deep-link mobile check')

    const response = await page.goto(leadUrl!)
    expect(response?.status()).toBeLessThan(400)
    await expect(page).not.toHaveURL(/\/(?:provider-)?sign-?in/i)
    await expect(page.locator('text=Internal Server Error')).toHaveCount(0)
    await expect(page.locator('text=Sign in')).toHaveCount(0)
  })

  test('provider View Job signed link opens without login', async ({ page }) => {
    const jobUrl = process.env.E2E_PROVIDER_JOB_URL
    test.skip(!jobUrl, 'E2E_PROVIDER_JOB_URL not set — skipping provider job deep-link mobile check')

    const response = await page.goto(jobUrl!)
    expect(response?.status()).toBeLessThan(400)
    await expect(page).not.toHaveURL(/\/(?:provider-)?sign-?in/i)
    await expect(page.locator('text=Internal Server Error')).toHaveCount(0)
    await expect(page.locator('text=Sign in')).toHaveCount(0)
  })

  test('customer request/status signed link opens without login', async ({ page }) => {
    const requestUrl = process.env.E2E_CUSTOMER_REQUEST_URL
    test.skip(!requestUrl, 'E2E_CUSTOMER_REQUEST_URL not set — skipping customer request deep-link mobile check')

    const response = await page.goto(requestUrl!)
    expect(response?.status()).toBeLessThan(400)
    await expect(page).not.toHaveURL(/\/sign-?in/i)
    await expect(page.locator('text=Internal Server Error')).toHaveCount(0)
    await expect(page.locator('text=Sign in')).toHaveCount(0)
  })
})
