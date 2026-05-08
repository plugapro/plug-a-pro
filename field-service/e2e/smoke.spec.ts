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

// ─── Sign-in helper ───────────────────────────────────────────────────────────
// The admin sign-in form is at /admin-sign-in and uses email/password inputs
// with a submit button. After success, the browser is hard-navigated to /admin.

async function signIn(page: Page) {
  await page.goto('/admin-sign-in')
  await page.fill('input[type="email"]', process.env.E2E_ADMIN_EMAIL ?? '')
  await page.fill('input[type="password"]', process.env.E2E_ADMIN_PASSWORD ?? '')
  await page.click('button[type="submit"]')
  // Hard navigation via window.location.assign — wait for the /admin shell
  await page.waitForURL(/\/admin\/?$/, { timeout: 15_000 })
}

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

// ─── Admin list routes ────────────────────────────────────────────────────────

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

// ─── Public client-PWA routes ────────────────────────────────────────────────
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

// ─── Detail page smoke ────────────────────────────────────────────────────────

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
