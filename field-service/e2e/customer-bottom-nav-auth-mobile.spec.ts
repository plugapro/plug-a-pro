import { expect, test } from '@playwright/test'

test.describe('mobile bottom nav auth state', () => {
  test.skip(({ isMobile }) => !isMobile, 'Runs only on mobile projects')

  test('shows Sign in for unauthenticated users', async ({ page }) => {
    await page.route('**/api/auth/session', (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: false, role: null }),
      })
    })

    const response = await page.goto('/book/plumbing')
    expect(response?.status()).toBeLessThan(400)

    const nav = page.locator('nav[aria-label="Main navigation"]')
    await expect(nav).toBeVisible()
    await expect(nav).toContainText('Sign in')
  })

  test('shows Profile instead of Sign in when authenticated', async ({ page }) => {
    await page.route('**/api/auth/session', (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: true, role: 'customer' }),
      })
    })

    const response = await page.goto('/book/plumbing')
    expect(response?.status()).toBeLessThan(400)

    const nav = page.locator('nav[aria-label="Main navigation"]')
    await expect(nav).toBeVisible()
    await expect(nav).toContainText('Profile')
    await expect(nav).not.toContainText('Sign in')

    const profileLink = nav.getByRole('link', { name: 'Profile' }).first()
    await expect(profileLink).toHaveAttribute('href', '/profile')
  })
})
