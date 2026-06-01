// Playwright smoke tests — post-deploy safety net.
//
// Run after every deploy to migration/from-vdp. Any non-2xx response or
// visible error boundary text fails the suite. This is the regression
// that catches the "Error 3811911274" class of bug before ops finds it.
//
// Required env vars:
//   E2E_BASE_URL       — full URL of the environment to test (e.g. https://preview-xyz.vercel.app)
//   E2E_ADMIN_EMAIL    — email of a test admin account
//   E2E_ADMIN_PASSWORD — password of the test admin account

import { test, expect, type Page } from '@playwright/test'
import { ADMIN_SMOKE_ROUTES, CLIENT_PUBLIC_SMOKE_ROUTES } from '../lib/admin-nav-routes'

const hasAdminSmokeCredentials = Boolean(process.env.E2E_ADMIN_EMAIL && process.env.E2E_ADMIN_PASSWORD)

// ─── Sign-in helper ───────────────────────────────────────────────────────────
// Admin auth is handled outside the app (credentials shared separately with staff).
// This helper uses the Supabase session cookie injected via E2E_ADMIN_SESSION_COOKIE
// or falls back to a direct Supabase token exchange if E2E_ADMIN_EMAIL / _PASSWORD are set.

async function signIn(page: Page) {
  const sessionCookie = process.env.E2E_ADMIN_SESSION_COOKIE
  if (sessionCookie) {
    await page.context().addCookies([{ name: 'sb-access-token', value: sessionCookie, domain: new URL(process.env.E2E_BASE_URL ?? 'http://localhost').hostname, path: '/' }])
    await page.goto('/admin')
    await page.waitForURL(/\/admin\/?/, { timeout: 15_000 })
    return
  }
  // Legacy fallback: direct cookie injection via /api/auth/session if credentials present
  const res = await page.request.post('/api/auth/session', {
    data: { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD },
  })
  if (!res.ok()) throw new Error(`Admin session setup failed: ${res.status()}`)
  await page.goto('/admin')
  await page.waitForURL(/\/admin\/?/, { timeout: 15_000 })
}

// ─── Authenticated smoke suite ────────────────────────────────────────────────

test.describe('authenticated', () => {
  test.skip(!hasAdminSmokeCredentials, 'E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD are required for authenticated smoke checks.')

  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  // ─── Admin list routes ──────────────────────────────────────────────────────

  const ADMIN_LIST_ROUTES = [...ADMIN_SMOKE_ROUTES]

  // Explicit stale routes that previously appeared in smoke checks.
  // Keeping this assertion in the suite prevents route-regression drift.
  const KNOWN_STALE_ADMIN_ROUTES = ['/admin/breached', '/admin/supply'] as const

  test('smoke route source excludes known stale admin routes', () => {
    for (const staleRoute of KNOWN_STALE_ADMIN_ROUTES) {
      expect(ADMIN_LIST_ROUTES).not.toContain(staleRoute)
    }
  })

  for (const route of ADMIN_LIST_ROUTES) {
    test(`list route renders without error: ${route}`, async ({ page }) => {
      const response = await page.goto(route)
      expect(response?.status()).toBeLessThan(400)
      // Must not show the Next error shell or the admin error boundary text
      await expect(page.locator('text=An unexpected error occurred')).toHaveCount(0)
      await expect(page.locator('text=Something went wrong on this page')).toHaveCount(0)
    })
  }

  // ─── Public client-PWA routes ───────────────────────────────────────────────
  // These routes are customer-facing handoff/recovery pages that must not 404
  // in production smoke checks.
  const CLIENT_PUBLIC_ROUTES = [...CLIENT_PUBLIC_SMOKE_ROUTES]

  for (const route of CLIENT_PUBLIC_ROUTES) {
    test(`client route renders without error: ${route}`, async ({ page }) => {
      const response = await page.goto(route)
      expect(response?.status()).toBeLessThan(400)
      await expect(page.locator('text=An unexpected error occurred')).toHaveCount(0)
      await expect(page.locator('text=Something went wrong on this page')).toHaveCount(0)
    })
  }

  // ─── Detail page smoke ──────────────────────────────────────────────────────

  test('provider detail renders for the first provider', async ({ page }) => {
    await page.goto('/admin/providers')
    const firstLink = page.locator('a[href^="/admin/providers/"]').first()
    await firstLink.click()
    await expect(page).toHaveURL(/\/admin\/providers\/[^/]+$/)
    await expect(page.locator('text=An unexpected error occurred')).toHaveCount(0)
    await expect(page.locator('text=Could not load provider profile')).toHaveCount(0)
  })

  test('booking detail renders for the first booking', async ({ page }) => {
    await page.goto('/admin/bookings')
    const firstLink = page.locator('a[href^="/admin/bookings/"]').first()
    await firstLink.click()
    await expect(page).toHaveURL(/\/admin\/bookings\/[^/]+$/)
    await expect(page.locator('text=An unexpected error occurred')).toHaveCount(0)
    await expect(page.locator('text=Could not load booking')).toHaveCount(0)
  })

  test('customer detail renders for the first customer', async ({ page }) => {
    await page.goto('/admin/customers')
    const firstLink = page.locator('a[href^="/admin/customers/"]').first()
    await firstLink.click()
    await expect(page).toHaveURL(/\/admin\/customers\/[^/]+$/)
    await expect(page.locator('text=An unexpected error occurred')).toHaveCount(0)
    await expect(page.locator('text=Could not load customer')).toHaveCount(0)
  })

  test('Didit verification refresh backfills local evidence when configured', async ({ page }) => {
    const verificationId = process.env.E2E_DIDIT_VERIFICATION_ID
    test.skip(!verificationId, 'E2E_DIDIT_VERIFICATION_ID not set — skipping Didit refresh smoke')

    await page.goto(`/admin/verifications/${verificationId}`)
    await page.getByRole('button', { name: 'Refresh from Didit' }).click()

    await expect(page).toHaveURL(/message=didit-refreshed/)
    await expect(page.getByRole('link', { name: 'Open private preview' }).first()).toBeVisible()
    await expect(page.getByText('Document confidence')).toBeVisible()
    await expect(page.getByText('Liveness score')).toBeVisible()
    await expect(page.getByText('Selfie match')).toBeVisible()
  })
})

// ─── Mobile viewport smoke ────────────────────────────────────────────────────
// Verifies the customer home page loads correctly on a mobile viewport.
// This test runs in both the chromium and Mobile Chrome projects so that any
// desktop-only layout regression is caught alongside the mobile-first baseline.

test.describe('mobile viewport', () => {
  test('customer home page loads on mobile viewport', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.status()).toBeLessThan(400)
    await expect(page.locator('text=An unexpected error occurred')).toHaveCount(0)
    await expect(page.locator('text=Something went wrong on this page')).toHaveCount(0)
  })
})

// ─── Pay@ sprint — unauthenticated route checks ───────────────────────────────
// These tests run without signing in to verify auth gates and route inventory.
// They use the `request` fixture (no browser) for API checks and the `page`
// fixture for redirect checks.

test.describe('Pay@ sprint — unauthenticated route checks', () => {
  test('/provider/credits redirects unauthenticated users to sign-in', async ({ page }) => {
    const response = await page.goto('/provider/credits')
    // Must either redirect to a sign-in page or return a non-200 auth gate.
    // Acceptable: any redirect destination that is not /provider/credits itself.
    const finalUrl = page.url()
    const isOnCreditsPage = finalUrl.includes('/provider/credits') && response?.status() === 200
    expect(isOnCreditsPage).toBe(false)
  })

  test('cron /api/cron/expire-payment-intents rejects without bearer token', async ({ request }) => {
    const res = await request.get('/api/cron/expire-payment-intents')
    expect(res.status()).toBe(401)
  })

  test('CLIENT_PUBLIC_SMOKE_ROUTES does not contain the stale /provider path', () => {
    // /provider was renamed to /for-providers; the old path must not appear in
    // smoke checks or it will 404 in production.
    expect(CLIENT_PUBLIC_SMOKE_ROUTES).not.toContain('/provider')
  })

  test('CLIENT_PUBLIC_SMOKE_ROUTES contains /for-providers', () => {
    expect(CLIENT_PUBLIC_SMOKE_ROUTES).toContain('/for-providers')
  })
})
