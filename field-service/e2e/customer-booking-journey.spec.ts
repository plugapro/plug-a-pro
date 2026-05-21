// E2E — Customer booking journey
//
// Verifies the customer-facing booking funnel end-to-end:
//   1. Homepage renders hero, category grid, and provider CTA strip
//   2. Category cards link to the providers browse page with the correct param
//   3. /book/[category] renders the address step without error
//   4. Attempting to advance past the address step without a suburb shows validation
//   5. Providers browse page loads with a category filter
//   6. An invalid booking category returns 404 (not a crash)
//
// Required env vars:
//   E2E_BASE_URL — full URL of the environment under test
//
// No auth is required for steps 1–3. The OTP gate only fires on the confirm
// submit (step 4), so the full address → description → confirm progression can
// be tested anonymously.

import { test, expect } from '@playwright/test'

// ─── Homepage ─────────────────────────────────────────────────────────────────

test('homepage renders hero section and trust pill', async ({ page }) => {
  const res = await page.goto('/')
  expect(res?.status()).toBeLessThan(400)

  await expect(page.locator('text=Rated by real customers')).toBeVisible({ timeout: 10_000 })
  await expect(
    page.locator('text=Skilled help near you').or(page.locator('text=what needs fixing'))
  ).toBeVisible({ timeout: 10_000 })

  await expect(page.locator('text=An unexpected error occurred')).toHaveCount(0)
  await expect(page.locator('text=Something went wrong')).toHaveCount(0)
})

test('homepage renders category grid', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('text=Browse by category')).toBeVisible({ timeout: 10_000 })

  // At least two category cards must be visible
  const categoryLinks = page.locator('a[href*="category="]')
  await expect(categoryLinks.first()).toBeVisible({ timeout: 10_000 })
  expect(await categoryLinks.count()).toBeGreaterThanOrEqual(2)
})

test('homepage renders provider CTA strip for anonymous visitors', async ({ page }) => {
  await page.goto('/')

  await expect(
    page.locator('text=Join as provider').or(page.locator('text=For service providers'))
  ).toBeVisible({ timeout: 10_000 })
})

test('homepage search bar is visible and has correct form action', async ({ page }) => {
  await page.goto('/')

  const searchForm = page.locator('form[action="/providers"]')
  await expect(searchForm).toBeVisible({ timeout: 10_000 })
  await expect(searchForm.locator('input[name="q"]')).toBeVisible()
})

// ─── Category navigation ───────────────────────────────────────────────────────

test('plumbing category card navigates to providers browse with category param', async ({ page }) => {
  await page.goto('/')

  const plumbingLink = page.locator('a[href*="category=plumbing"]').first()
  await expect(plumbingLink).toBeVisible({ timeout: 10_000 })

  await plumbingLink.click()
  await page.waitForURL(/\/providers/, { timeout: 10_000 })

  expect(page.url()).toContain('category=plumbing')
  expect(page.url()).not.toContain('500')
})

// ─── Providers browse ─────────────────────────────────────────────────────────

test('providers browse page loads without error for a valid category', async ({ page }) => {
  const res = await page.goto('/providers?category=plumbing')
  expect(res?.status()).toBeLessThan(400)

  await expect(page.locator('text=An unexpected error occurred')).toHaveCount(0)
  await expect(page.locator('text=Something went wrong')).toHaveCount(0)
})

// ─── Booking flow — address step ──────────────────────────────────────────────

test('/book/plumbing renders the address step without error', async ({ page }) => {
  const res = await page.goto('/book/plumbing')
  expect(res?.status()).toBeLessThan(400)

  // The step 1 progress bar or the "Plumbing · Step 1 of 3" label must be visible
  await expect(
    page.locator('text=Step 1 of 3').or(page.locator('[role="progressbar"]'))
  ).toBeVisible({ timeout: 10_000 })

  // Privacy notice is the first UI element inside the address form
  await expect(page.locator('text=Your address stays private')).toBeVisible({ timeout: 10_000 })

  // The "Continue →" submit button must exist
  await expect(page.locator('button[type="submit"]', { hasText: /continue/i })).toBeVisible()

  await expect(page.locator('text=An unexpected error occurred')).toHaveCount(0)
  await expect(page.locator('text=Something went wrong')).toHaveCount(0)
})

test('address step shows validation error when advancing without selecting a suburb', async ({ page }) => {
  await page.goto('/book/plumbing')

  // Wait for the form to be interactive
  const submitBtn = page.locator('button[type="submit"]', { hasText: /continue/i })
  await expect(submitBtn).toBeVisible({ timeout: 10_000 })

  await submitBtn.click()

  // Suburb validation fires first: locationNodeId is null on mount
  await expect(
    page.locator('text=Select your suburb').or(
      page.locator('text=complete the full service address')
    )
  ).toBeVisible({ timeout: 5_000 })
})

test('back button is present on the address step', async ({ page }) => {
  await page.goto('/book/plumbing')

  await expect(page.locator('text=Step 1 of 3').or(page.locator('[role="progressbar"]'))).toBeVisible({ timeout: 10_000 })

  // ChevronLeft back button exists (aria-label not set, but it's the only icon button in the header)
  const backBtn = page.locator('button').filter({ has: page.locator('svg') }).first()
  await expect(backBtn).toBeVisible()
})

// ─── Invalid category ─────────────────────────────────────────────────────────

test('/book/nonexistent-category returns 404', async ({ page }) => {
  const res = await page.goto('/book/nonexistent-category-xyz')
  // Next.js notFound() renders a 404 page, not a 500
  expect(res?.status()).toBe(404)
})

// ─── Booking flow — description step (conditional on being able to advance) ───
//
// Full address entry requires interacting with the SuburbPicker (a custom async
// combobox backed by the locations API). This test is skipped unless the env
// var E2E_BASE_URL points to an environment where the locations API is live.
// When the full flow is available use E2E_BOOKING_FULL_FLOW=true to enable it.

test('can advance from address step to description step when address is complete', async ({ page }) => {
  test.skip(!process.env.E2E_BOOKING_FULL_FLOW, 'E2E_BOOKING_FULL_FLOW not set — skipping full address-step interaction')

  await page.goto('/book/plumbing')

  // The SuburbPicker renders an input — type to trigger the autocomplete
  const suburbInput = page.locator('input[placeholder*="suburb" i]').or(
    page.locator('input[placeholder*="search" i]')
  ).first()
  await suburbInput.fill('Sandton')

  // Wait for autocomplete options and select the first one
  const option = page.locator('[role="option"]').first()
  await expect(option).toBeVisible({ timeout: 8_000 })
  await option.click()

  // Fill remaining required fields
  await page.locator('input[placeholder*="street" i]').or(page.locator('input[name="addressLine1"]')).first().fill('1 Test Street')

  // Submit address step
  await page.locator('button[type="submit"]', { hasText: /continue/i }).click()

  // Should now be on step 2
  await expect(page.locator('text=Step 2 of 3')).toBeVisible({ timeout: 8_000 })
  await expect(page.locator('text=An unexpected error occurred')).toHaveCount(0)
})
