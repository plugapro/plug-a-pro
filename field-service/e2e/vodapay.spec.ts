// E2E — VodaPay mini-program channel smoke (Task 18)
//
// Drives the whole channel entry with a stubbed window.my bridge (no real
// VodaPay host needed): /vodapay bootstraps, records the pap_channel cookie,
// and hands off into the normal customer home with WhatsApp CTAs hidden.
//
// Requires flags channel.vodapay.v1 (+ payments.vodapay.v1 for the pay leg)
// enabled in the target env. Skipped when the entry 404s (flags off) —
// matches every other flag-gated route in this suite (see smoke.spec.ts's
// ADMIN_FLAGGED_SMOKE_ROUTES pattern: <400 or 404 both acceptable, never a
// hard failure just because the flag happens to be off in this environment).
//
// Required env vars: none — defaults to http://localhost:3000 (see
// playwright.config.ts) when E2E_BASE_URL is not set.

import { expect, test } from '@playwright/test'

test('vodapay entry sets channel and hides WhatsApp CTAs', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { my: unknown }).my = {
      getAuthCode: (o: { success: (r: { authCode: string }) => void }) =>
        o.success({ authCode: 'stub-auth-code' }),
      tradePay: (o: { success: (r: { resultCode: string }) => void }) =>
        o.success({ resultCode: '9000' }),
      getLocation: (o: { fail: () => void }) => o.fail(),
      getEnv: (o: { success: (r: { language: string }) => void }) =>
        o.success({ language: 'en' }),
    }
  })
  const res = await page.goto('/vodapay')
  test.skip(res?.status() === 404, 'channel.vodapay.v1 disabled in this env')
  await page.waitForURL('**/')
  const cookies = await page.context().cookies()
  expect(cookies.find((c) => c.name === 'pap_channel')?.value).toBe('vodapay')
  await expect(page.locator('a[href*="wa.me"]')).toHaveCount(0)
})
