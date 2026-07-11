import * as Sentry from '@sentry/nextjs'
import { redactSentryEvent } from '@/lib/observability/sentry-redaction'

// ─── App-level instrumentation ────────────────────────────────────────────────
// Next.js calls register() once per server instance (and per edge runtime
// boot). We use it to lock the process timezone to SAST so date formatting,
// cron evaluation, and inbound webhook timestamps all use the same wall clock
// as the South African market, and to initialise server-side Sentry.

export async function register() {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN
  if (dsn) {
    Sentry.init({
      dsn,
      sendDefaultPii: false,
      tracesSampleRate: 0.1,
      beforeSend: redactSentryEvent,
    })
  }

  if (!process.env.TZ) {
    process.env.TZ = 'Africa/Johannesburg'
  }
}

// Capture errors thrown in Server Components, route handlers, server actions,
// and the proxy. Without this export those errors never reach Sentry — this is
// the gap that hid the mobile-registration outage (client-side error boundary
// with only console.error).
export const onRequestError = Sentry.captureRequestError
