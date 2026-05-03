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
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
