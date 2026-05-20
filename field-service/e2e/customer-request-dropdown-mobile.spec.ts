import { test, expect } from '@playwright/test'

test.describe('customer request dropdown rendering', () => {
  test.skip(({ isMobile }) => !isMobile, 'Runs only on mobile projects')

  test('shared select popover is opaque and above sticky mobile nav on request form', async ({ page }) => {
    const response = await page.goto('/book/plumbing')
    expect(response?.status()).toBeLessThan(400)

    const mobileNav = page.locator('nav[aria-label="Main navigation"]')
    await expect(mobileNav).toBeVisible()
    const stickyZ = await mobileNav.evaluate((el) => Number.parseInt(getComputedStyle(el).zIndex || '0', 10) || 0)

    const provinceTrigger = page.locator('#province')
    await expect(provinceTrigger).toBeVisible()
    await provinceTrigger.click()

    const selectContent = page.locator('[data-slot="select-content"]').filter({ visible: true }).first()
    await expect(selectContent).toBeVisible()
    await expect(page.getByRole('option', { name: 'Gauteng' })).toBeVisible()

    const provinceSurface = await selectContent.evaluate((el) => {
      const css = getComputedStyle(el)
      return {
        backgroundColor: css.backgroundColor,
        zIndex: Number.parseInt(css.zIndex || '0', 10) || 0,
      }
    })

    expect(provinceSurface.backgroundColor).not.toBe('transparent')
    expect(provinceSurface.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(provinceSurface.zIndex).toBeGreaterThan(stickyZ)
  })
})
