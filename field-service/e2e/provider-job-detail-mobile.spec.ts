import { expect, test, type Page } from '@playwright/test'

// Optional env-driven mobile regression for authenticated provider journeys.
// Set both URLs to enabled this check against a seeded provider account.
const PROVIDER_HOME_URL = process.env.E2E_PROVIDER_HOME_URL
const PROVIDER_JOBS_URL = process.env.E2E_PROVIDER_JOBS_URL

async function openFirstInProgressJob(page: Page) {
  const inProgressSection = page.locator('section').filter({ hasText: /In progress/i }).first()
  await expect(inProgressSection).toBeVisible()

  const firstCard = inProgressSection.locator('a[href^="/provider/jobs/"]').first()
  await expect(firstCard).toBeVisible()
  const href = await firstCard.getAttribute('href')
  await firstCard.click()

  await expect(page.locator('text=Could not load this job right now.')).toHaveCount(0)
  return href
}

async function openFirstUpcomingJob(page: Page) {
  const upcomingSection = page.locator('section').filter({ hasText: /Upcoming/i }).first()
  await expect(upcomingSection).toBeVisible()

  const firstCard = upcomingSection.locator('a[href^="/provider/jobs/"]').first()
  await expect(firstCard).toBeVisible()
  const href = await firstCard.getAttribute('href')
  await firstCard.click()

  await expect(page.locator('text=Could not load this job right now.')).toHaveCount(0)
  return href
}

test('mobile: provider can open in-progress jobs from Home and Jobs without detail loader failure', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'Mobile Chrome', 'Mobile viewport regression only')
  test.skip(!PROVIDER_HOME_URL || !PROVIDER_JOBS_URL, 'E2E_PROVIDER_HOME_URL/E2E_PROVIDER_JOBS_URL not set')

  await page.goto(PROVIDER_HOME_URL!)
  test.skip(page.url().includes('/provider-sign-in'), 'Provider auth session required for this regression test')

  const homeInProgressHref = await openFirstInProgressJob(page)
  expect(homeInProgressHref).toBeTruthy()

  await page.goto(PROVIDER_JOBS_URL!)
  const inProgressSection = page.locator('section').filter({ hasText: /In progress/i }).first()
  await expect(inProgressSection.locator('text=Scheduled')).toHaveCount(0)
  const upcomingSection = page.locator('section').filter({ hasText: /Upcoming/i }).first()

  if (homeInProgressHref) {
    await expect(upcomingSection.locator(`a[href="${homeInProgressHref}"]`)).toHaveCount(0)
    await expect(inProgressSection.locator(`a[href="${homeInProgressHref}"]`)).toHaveCount(1)
    await inProgressSection.locator(`a[href="${homeInProgressHref}"]`).click()
    await expect(page.locator('text=Could not load this job right now.')).toHaveCount(0)
    return
  }

  await openFirstInProgressJob(page)
})

test('mobile: provider can open upcoming/scheduled jobs from Jobs without detail loader failure', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'Mobile Chrome', 'Mobile viewport regression only')
  test.skip(!PROVIDER_JOBS_URL, 'E2E_PROVIDER_JOBS_URL not set')

  await page.goto(PROVIDER_JOBS_URL!)
  test.skip(page.url().includes('/provider-sign-in'), 'Provider auth session required for this regression test')

  const upcomingSection = page.locator('section').filter({ hasText: /Upcoming/i }).first()
  const upcomingCount = await upcomingSection.locator('a[href^="/provider/jobs/"]').count()

  if (upcomingCount === 0) {
    test.skip(true, 'No upcoming jobs available in seed data')
  }

  const href = await openFirstUpcomingJob(page)
  await expect(page.locator('h1')).toContainText(/Job #[a-f0-9]+/i)
  expect(href).toContain('/provider/jobs/')
})
