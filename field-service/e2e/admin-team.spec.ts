// E2E — Admin team management surface
//
// Verifies the admin team management surface:
//   1. /admin/team renders without error for authenticated admins
//   2. Team list shows rows, empty state, or flag-off notice (not a 500)
//   3. Unauthenticated access to /admin/team is redirected or denied
//
// Required env vars (same as smoke.spec.ts):
//   E2E_BASE_URL       — full URL of the environment under test
//   E2E_ADMIN_EMAIL    — test admin account email
//   E2E_ADMIN_PASSWORD — test admin account password
//
// Note: The team management page is behind the admin.users.v2 feature flag.
// Tests accept flag-on (table visible) and flag-off (coming soon / not enabled)
// states to avoid CI failures when the flag is toggled.

import { test, expect, type Page } from '@playwright/test'

// ─── Sign-in helper ───────────────────────────────────────────────────────────
// Admin auth is handled outside the app (credentials shared separately with staff).

async function signIn(page: Page) {
  const sessionCookie = process.env.E2E_ADMIN_SESSION_COOKIE
  if (sessionCookie) {
    await page.context().addCookies([{ name: 'sb-access-token', value: sessionCookie, domain: new URL(process.env.E2E_BASE_URL ?? 'http://localhost').hostname, path: '/' }])
    await page.goto('/admin')
    await page.waitForURL(/\/admin\/?/, { timeout: 15_000 })
    return
  }
  const res = await page.request.post('/api/auth/session', {
    data: { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD },
  })
  if (!res.ok()) throw new Error(`Admin session setup failed: ${res.status()}`)
  await page.goto('/admin')
  await page.waitForURL(/\/admin\/?/, { timeout: 15_000 })
}

// ─── Authenticated tests ──────────────────────────────────────────────────────

test('admin team page loads without error for authenticated admin', async ({ page }) => {
  await signIn(page)

  const response = await page.goto('/admin/team')
  expect(response?.status()).toBeLessThan(400)

  await expect(page.locator('text=An unexpected error occurred')).toHaveCount(0)
  await expect(page.locator('text=Something went wrong')).toHaveCount(0)
  await expect(page.locator('text=Internal Server Error')).toHaveCount(0)
})

test('admin team page shows content or flag-off notice', async ({ page }) => {
  await signIn(page)

  await page.goto('/admin/team')

  // Accept any of three valid states:
  //   - flag on + members present: table rows exist
  //   - flag on + no members yet: empty-state text
  //   - flag off: coming-soon / not-enabled notice
  const tableRows = await page.locator('table tbody tr').count()
  const emptyState = await page
    .locator('text=No team members').or(page.locator('text=No members')).count()
  const flagOff = await page
    .locator('text=coming soon').or(page.locator('text=not enabled')).or(page.locator('text=Coming Soon')).or(page.locator('text=Not enabled')).count()

  expect(tableRows + emptyState + flagOff).toBeGreaterThan(0)
})

// ─── Unauthenticated access guard ─────────────────────────────────────────────

test('unauthenticated access to /admin/team redirects or returns non-200', async ({ page }) => {
  // Navigate without signing in — auth guard should redirect away or return ≥300.
  const response = await page.goto('/admin/team')

  const finalUrl = page.url()
  const redirectedAway = !finalUrl.endsWith('/admin/team')
  const nonSuccessStatus = (response?.status() ?? 200) >= 300

  // Either condition is acceptable: a redirect or a non-2xx HTTP status.
  expect(redirectedAway || nonSuccessStatus).toBe(true)
})
