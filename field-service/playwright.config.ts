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

// SECURITY (finding 85d4a2cb): the smoke suite submits real admin credentials
// (E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD) to E2E_BASE_URL. If that URL can be set
// by a less-trusted actor (e.g. a repo variable override), it could be pointed at
// an attacker-controlled host to capture those credentials. We therefore enforce a
// hostname allowlist here and refuse to run against any host that is not an
// expected Plug A Pro deployment (or an explicit localhost loopback for local
// dev). This is independent of, and in addition to, preferring the protected
// secret in CI.
const ALLOWED_HOST_SUFFIXES = [
  '.plugapro.co.za', // production + preview/staging subdomains
  '.vercel.app',     // Vercel preview deployments for this project
]
const ALLOWED_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

function assertAllowedBaseUrl(rawUrl: string | undefined): void {
  if (!rawUrl) return
  let host: string
  try {
    host = new URL(rawUrl).hostname.toLowerCase()
  } catch {
    throw new Error(`[playwright] E2E_BASE_URL is not a valid URL: ${rawUrl}`)
  }
  const isLoopback = ALLOWED_LOOPBACK_HOSTS.has(host)
  const isAllowedSuffix = ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  if (!isLoopback && !isAllowedSuffix) {
    throw new Error(
      `[playwright] Refusing to run smoke tests against untrusted host "${host}". ` +
        `Admin credentials are only ever sent to allowlisted deployment hosts ` +
        `(${ALLOWED_HOST_SUFFIXES.join(', ')}) or localhost.`,
    )
  }
}

assertAllowedBaseUrl(BASE_URL)

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
    {
      name: 'Mobile Chrome',
      use: {
        ...devices['Pixel 5'],
      },
    },
  ],
})
