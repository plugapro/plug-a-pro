import { defineConfig } from 'vitest/config'
import path from 'path'

// Tests run in SAST to match production. Locally most contributors are
// already in Africa/Johannesburg; CI runners are UTC, so the GitHub Actions
// workflow exports `TZ=Africa/Johannesburg` at the job level. Setting TZ
// here in vitest.config has no effect on worker processes (Node caches it
// before workers start), so the env-var-at-launch approach is canonical.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // SECURITY (finding ca4b71d2): the internal-test cohort is sourced from env
    // at module import time (see lib/internal-test-cohort.ts). Real staff numbers
    // are NEVER committed. Tests use SYNTHETIC reserved-style numbers, set here so
    // they are present at process LAUNCH (the module reads env on import, before
    // any test body runs). Keep these in sync with the synthetic numbers used as
    // inputs in the cohort-aware test files.
    env: {
      INTERNAL_TEST_PHONE_NUMBERS:
        '+27000000001,+27000000002,+27000000003,+27000000004,+27000000005,+27000000006,+27000000009',
      INTERNAL_TEST_ONBOARDING_CREDIT_PHONE_NUMBERS: '+27000000009',
    },
    exclude: ['e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: [
        'lib/auth.ts',
        'lib/provider-wallet.ts',
        'lib/review-first.ts',
        'lib/payments.ts',
        'lib/provider-accepted-lock.ts',
        'lib/provider-credit-application.ts',
        'lib/customer-shortlists.ts',
        'lib/provider-opportunity-responses.ts',
        'lib/selected-provider-acceptance.ts',
        'lib/matching/**',
        'lib/whatsapp.ts',
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
      },
    },
  },
  resolve: {
    // Prefer TypeScript source files over compiled JS when both exist.
    // Without this, Vite's default order ('.js' before '.ts') causes
    // lib/whatsapp.js (a legacy prototype stub) to shadow lib/whatsapp.ts
    // (the real production module), breaking any test that imports
    // @/lib/whatsapp without an explicit extension.
    extensions: ['.mts', '.ts', '.tsx', '.mjs', '.js', '.jsx', '.json'],
    alias: {
      '@': path.resolve(__dirname, '.'),
      // server-only throws in non-Next.js environments (Vitest runs in plain Node).
      // Redirect to a no-op shim so server-only guards work in production but
      // don't break the test suite.
      'server-only': path.resolve(__dirname, './__mocks__/server-only.ts'),
      // next/headers throws outside a request context (tests run in plain Node).
      'next/headers': path.resolve(__dirname, './__mocks__/next-headers.ts'),
    },
  },
})
