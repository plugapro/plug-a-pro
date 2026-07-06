// ─── Client-side Sentry bootstrap (audit OBS-01) ──────────────────────────────
// Turbopack builds (next.config.ts `turbopack: {}`) do NOT load the legacy
// sentry.client.config.ts - since Next 15.3 / @sentry/nextjs 10.x the client
// init must live in instrumentation-client.ts. We import the existing config
// module so there is a single source of truth for the DSN gating, SA-phone
// redaction and sample rates; module caching guarantees a single init even if
// a webpack build also evaluates sentry.client.config.ts.
import * as Sentry from '@sentry/nextjs'

import './sentry.client.config'

// Instruments App Router navigations for tracing. No-op while the DSN is
// unset (Sentry.init without a DSN leaves the SDK disabled).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
