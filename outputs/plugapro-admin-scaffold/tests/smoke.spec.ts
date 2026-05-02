// Playwright smoke tests — post-deploy safety net.
//
// Wire into CI after every deploy to main. Any non-2xx or page error should
// fail the build. This is the regression that catches the "Error 3811911274"
// class of bug BEFORE your ops team finds it.
//
// Assumes a test admin account exists with credentials in env:
//   E2E_ADMIN_EMAIL
//   E2E_ADMIN_PASSWORD
// Adjust selectors to match your auth form.

import { test, expect, Page } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'https://admin.plugapro.co.za';

async function signIn(page: Page) {
  await page.goto(`${BASE}/sign-in`);
  await page.fill('input[type="email"]', process.env.E2E_ADMIN_EMAIL!);
  await page.fill('input[type="password"]', process.env.E2E_ADMIN_PASSWORD!);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin\/?$/);
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

const ADMIN_LIST_ROUTES = [
  '/admin',
  '/admin/validation',
  '/admin/dispatch',
  '/admin/field-exceptions',
  '/admin/quotes',
  '/admin/bookings',
  '/admin/matches',
  '/admin/applications',
  '/admin/providers',
  '/admin/customers',
  '/admin/categories',
  '/admin/locations',
  '/admin/disputes',
  '/admin/payments',
  '/admin/reports',
  '/admin/messages',
  '/admin/settings',
  '/admin/team',
];

for (const route of ADMIN_LIST_ROUTES) {
  test(`list route renders without error: ${route}`, async ({ page }) => {
    const response = await page.goto(`${BASE}${route}`);
    expect(response?.status()).toBeLessThan(400);
    // Neither the generic Next error shell nor the admin error boundary.
    await expect(page.locator('text=An unexpected error occurred')).toHaveCount(0);
    await expect(page.locator('text=Something went wrong on this page')).toHaveCount(0);
  });
}

test('provider detail renders for the first provider', async ({ page }) => {
  await page.goto(`${BASE}/admin/providers`);
  const firstLink = page.locator('a[href^="/admin/providers/"]').first();
  await firstLink.click();
  await expect(page).toHaveURL(/\/admin\/providers\/[^/]+$/);
  await expect(page.locator('text=An unexpected error occurred')).toHaveCount(0);
});

test('booking detail renders for the first booking', async ({ page }) => {
  await page.goto(`${BASE}/admin/bookings`);
  const firstLink = page.locator('a[href^="/admin/bookings/"]').first();
  await firstLink.click();
  await expect(page).toHaveURL(/\/admin\/bookings\/[^/]+$/);
  await expect(page.locator('text=An unexpected error occurred')).toHaveCount(0);
});

test('customer detail renders for the first customer', async ({ page }) => {
  await page.goto(`${BASE}/admin/customers`);
  const firstLink = page.locator('a[href^="/admin/customers/"]').first();
  await firstLink.click();
  await expect(page).toHaveURL(/\/admin\/customers\/[^/]+$/);
  await expect(page.locator('text=An unexpected error occurred')).toHaveCount(0);
});
