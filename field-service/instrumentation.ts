import * as Sentry from '@sentry/nextjs'

// ─── App-level instrumentation ────────────────────────────────────────────────
// Next.js calls register() once per server instance (and per edge runtime
// boot). We use it to lock the process timezone to SAST so date formatting,
// cron evaluation, and inbound webhook timestamps all use the same wall clock
// as the South African market.

export async function register() {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN
  if (dsn) {
    Sentry.init({
      dsn,
      sendDefaultPii: false,
      tracesSampleRate: 0.1,
      beforeSend(event) {
        try {
          return JSON.parse(JSON.stringify(event).replace(/\+?27\d{9}/g, '[REDACTED]'))
        } catch {
          return event
        }
      },
    })
  }

  if (!process.env.TZ) {
    process.env.TZ = 'Africa/Johannesburg'
  }
}
