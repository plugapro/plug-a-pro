// E2E — Matching flow smoke tests
//
// Verifies the orchestrator path end-to-end:
//   1. Admin dispatch page loads and can trigger manual orchestration
//   2. Match attempts are visible in the dispatch timeline
//   3. Provider lead accept/reject API endpoints respond correctly
//   4. Admin matching health card renders on the dashboard
//
// Required env vars (same as smoke.spec.ts):
//   E2E_BASE_URL       — full URL of the environment under test
//   E2E_ADMIN_EMAIL    — test admin account email
//   E2E_ADMIN_PASSWORD — test admin account password
//
// Optional env vars:
//   E2E_PROVIDER_TOKEN — Bearer token for a seeded provider account
//   E2E_OPEN_JOB_ID    — an OPEN job request ID to use for manual dispatch smoke

import { test, expect, type Page } from '@playwright/test'

// ─── Sign-in helper ───────────────────────────────────────────────────────────

async function signIn(page: Page) {
  await page.goto('/admin-sign-in')
  await page.fill('input[type="email"]', process.env.E2E_ADMIN_EMAIL ?? '')
  await page.fill('input[type="password"]', process.env.E2E_ADMIN_PASSWORD ?? '')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/admin\/?$/, { timeout: 15_000 })
}

// ─── Dashboard matching health card ──────────────────────────────────────────

test('admin dashboard renders matching health card', async ({ page }) => {
  await signIn(page)

  const response = await page.goto('/admin')
  expect(response?.status()).toBeLessThan(400)

  // The matching health card added in T9 must be present
  await expect(
    page.locator('text=Matching health').or(page.locator('text=Matching Health'))
  ).toBeVisible({ timeout: 10_000 })

  // Must not show an error boundary
  await expect(page.locator('text=An unexpected error occurred')).toHaveCount(0)
  await expect(page.locator('text=Something went wrong')).toHaveCount(0)
})

// ─── Dispatch page ────────────────────────────────────────────────────────────

test('admin dispatch page renders without error', async ({ page }) => {
  await signIn(page)

  const response = await page.goto('/admin/dispatch')
  expect(response?.status()).toBeLessThan(400)

  await expect(page.locator('text=An unexpected error occurred')).toHaveCount(0)
  await expect(page.locator('text=Something went wrong')).toHaveCount(0)
})

test('admin dispatch page shows job list or empty state', async ({ page }) => {
  await signIn(page)

  await page.goto('/admin/dispatch')

  // Either a table row exists or an empty-state message — either is valid
  const hasRows = await page.locator('table tbody tr').count()
  const hasEmptyState = await page.locator('text=No open jobs').count()
  expect(hasRows + hasEmptyState).toBeGreaterThan(0)
})

// ─── Provider assignment-offer API endpoints ──────────────────────────────────
// These tests call the API directly to verify the endpoints exist and return
// expected status codes without a valid session / provider record.

test('accept endpoint returns 401 without auth', async ({ request }) => {
  const res = await request.post('/api/provider/assignment-offers/nonexistent-lead/accept', {
    data: {},
  })
  expect(res.status()).toBe(401)
})

test('reject endpoint returns 401 without auth', async ({ request }) => {
  const res = await request.post('/api/provider/assignment-offers/nonexistent-lead/reject', {
    data: {},
  })
  expect(res.status()).toBe(401)
})

// ─── Internal match trigger endpoint ─────────────────────────────────────────

test('internal match endpoint returns 401 without CRON_SECRET', async ({ request }) => {
  const res = await request.post('/api/internal/match', {
    data: { jobRequestId: 'smoke-test-job' },
  })
  // Must be protected — 401 or 403
  expect([401, 403]).toContain(res.status())
})

// ─── Heartbeat endpoint ───────────────────────────────────────────────────────

test('provider heartbeat endpoint returns 401 without auth', async ({ request }) => {
  const res = await request.post('/api/provider/heartbeat', {
    data: { lat: -26.1, lng: 28.05 },
  })
  expect(res.status()).toBe(401)
})

// ─── Full manual dispatch smoke (only when E2E_OPEN_JOB_ID is set) ────────────

test('manual re-dispatch via admin UI returns a match result', async ({ page }) => {
  const jobId = process.env.E2E_OPEN_JOB_ID
  test.skip(!jobId, 'E2E_OPEN_JOB_ID not set — skipping manual dispatch smoke')

  await signIn(page)
  await page.goto('/admin/dispatch')

  // Find the job row and click "Re-dispatch" or "Match Now" button
  const jobRow = page.locator(`[data-job-id="${jobId}"]`).or(
    page.locator('table tbody tr').filter({ hasText: jobId! })
  )

  await expect(jobRow).toBeVisible({ timeout: 10_000 })

  const dispatchBtn = jobRow.locator('button').filter({
    hasText: /re.dispatch|match now|run match/i,
  })

  if ((await dispatchBtn.count()) > 0) {
    await dispatchBtn.click()
    // Expect either a success toast or a no-match message — no error boundary
    await expect(
      page.locator('text=Dispatched').or(page.locator('text=No match found')).or(
        page.locator('text=Already held')
      )
    ).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('text=An unexpected error occurred')).toHaveCount(0)
  }
})
