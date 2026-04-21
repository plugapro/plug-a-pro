import { defineConfig, devices } from '@playwright/test'

// E2E_BASE_URL must be set to run the smoke suite.
// In CI, point it at the Vercel preview URL for the deploy under test.
// Locally, start `pnpm dev` and set E2E_BASE_URL=http://localhost:3000.
const BASE_URL = process.env.E2E_BASE_URL

if (!BASE_URL) {
  console.warn(
    '[playwright] E2E_BASE_URL is not set — smoke tests will be skipped.\n' +
    'Set E2E_BASE_URL to your preview/staging URL to run them.'
  )
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
