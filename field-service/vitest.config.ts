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
