import * as Sentry from '@sentry/nextjs'

function sanitizeEvent(event: unknown) {
  try {
    const serialized = JSON.stringify(event)
    return JSON.parse(serialized.replace(/\+?27\d{9}/g, '[REDACTED]'))
  } catch {
    return event
  }
}

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  beforeSend: sanitizeEvent,
})
