// E2E — Provider lead journey
//
// Verifies the provider-facing lead access flow:
//   1. An invalid handoff token renders a non-500 error page (not a crash)
//   2. The /provider/lead alias behaves identically to /provider/handoff
//   3. Provider opportunity response API requires auth (401 without session)
//   4. Provider lead contact-customer API requires auth (401 without session)
//   5. (Conditional) A valid signed lead URL renders the lead detail page
//
// Required env vars:
//   E2E_BASE_URL — full URL of the environment under test
//
// Optional env vars:
//   E2E_PROVIDER_LEAD_URL — full signed URL for a real provider lead; enables
//                           the full "view lead detail" smoke test

import { test, expect } from '@playwright/test'

// ─── Invalid token handling ───────────────────────────────────────────────────

test('invalid handoff token renders an error page, not a 500', async ({ page }) => {
  const res = await page.goto('/provider/handoff/invalid-token-xyz-12345')

  // Must not be a raw 500 — Next.js error boundary or notFound should handle this
  expect(res?.status()).not.toBe(500)

  // Must not render a bare unhandled crash — either a friendly error page or a
  // redirect to sign-in is acceptable
  await expect(page.locator('text=Internal Server Error')).toHaveCount(0)
})

test('invalid token via /provider/lead alias also renders gracefully', async ({ page }) => {
  const res = await page.goto('/provider/lead/invalid-token-xyz-12345')

  expect(res?.status()).not.toBe(500)
  await expect(page.locator('text=Internal Server Error')).toHaveCount(0)
})

// ─── API auth guards ──────────────────────────────────────────────────────────

test('provider opportunity GET returns 401 without auth', async ({ request }) => {
  const res = await request.get('/api/provider/opportunities/nonexistent-lead-id')
  expect(res.status()).toBe(401)
})

test('provider opportunity POST returns 401 without auth', async ({ request }) => {
  const res = await request.post('/api/provider/opportunities/nonexistent-lead-id', {
    data: { response: 'INTERESTED', callOutFee: 350 },
  })
  expect(res.status()).toBe(401)
})

test('provider lead contact-customer endpoint returns 401 without auth', async ({ request }) => {
  const res = await request.post('/api/provider/leads/nonexistent-lead-id/contact-customer', {
    data: {},
  })
  expect(res.status()).toBe(401)
})

// The assignment-offer endpoints are already covered in matching-flow.spec.ts.
// These additional checks verify the selected-provider acceptance path.

test('selected-provider accept endpoint returns 401 without auth', async ({ request }) => {
  const res = await request.post('/api/provider/assignment-offers/nonexistent-lead/accept', {
    data: {},
  })
  expect(res.status()).toBe(401)
})

test('selected-provider reject endpoint returns 401 without auth', async ({ request }) => {
  const res = await request.post('/api/provider/assignment-offers/nonexistent-lead/reject', {
    data: {},
  })
  expect(res.status()).toBe(401)
})

// ─── Valid signed URL smoke (only when E2E_PROVIDER_LEAD_URL is set) ──────────

test('valid signed lead URL renders provider job detail page', async ({ page }) => {
  const leadUrl = process.env.E2E_PROVIDER_LEAD_URL
  test.skip(!leadUrl, 'E2E_PROVIDER_LEAD_URL not set — skipping valid-token lead detail smoke')

  const res = await page.goto(leadUrl!)
  expect(res?.status()).toBeLessThan(400)

  // The provider job/lead detail page should render job information,
  // not an error boundary or a blank screen
  await expect(page.locator('text=An unexpected error occurred')).toHaveCount(0)
  await expect(page.locator('text=Something went wrong')).toHaveCount(0)
  await expect(page.locator('text=Internal Server Error')).toHaveCount(0)

  // At least one of these lead-detail landmarks must be present
  await expect(
    page.locator('text=Job details').or(
      page.locator('text=Accept').or(
        page.locator('text=Decline').or(
          page.locator('text=Call-out fee')
        )
      )
    )
  ).toBeVisible({ timeout: 15_000 })
})
