import * as Sentry from '@sentry/nextjs'
import { redactSentryEvent } from '@/lib/observability/sentry-redaction'

// ─── Client-side Sentry ───────────────────────────────────────────────────────
// Under Turbopack (our build) Next.js loads `instrumentation-client.ts`, NOT the
// legacy `sentry.client.config.ts` (webpack-only). Without this file, browser
// errors across the customer/provider/admin UI never reach Sentry — the exact
// blind spot that let the mobile-registration crash ship unnoticed.
//
// NOTE: session replay is intentionally NOT enabled. Plug A Pro renders POPIA
// special personal information (ID documents, ID numbers) in the KYC flow, and
// replay would capture those frames. Errors + tracing only, with PII scrubbed.

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN,
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  beforeSend: redactSentryEvent,
})

// Instruments client-side App Router navigations so Sentry can tie errors to the
// route transition that triggered them.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
