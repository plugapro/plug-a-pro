// Structured, PII-safe logging for the identity verification flow.
//
// These logs are the breadcrumb trail for the document -> selfie transition.
// Never log raw identifiers (SA ID numbers, passport numbers) or access tokens;
// pass only IDs, statuses, document kinds and coarse file metadata.
//
// ─── Observability sink (opt-in) ─────────────────────────────────────────────
// When SENTRY_DSN (or NEXT_PUBLIC_SENTRY_DSN) is set in the environment,
// errors emitted via logIdentityVerificationError are also forwarded to
// Sentry with verification context tags (verificationId, providerId, vendor,
// action) so KYC failures are searchable beyond the Vercel runtime log
// stream. The sink is fail-safe: a Sentry transport error must never bubble
// up into the calling KYC code path.

import * as Sentry from '@sentry/nextjs'

export type IdentityLogContext = Record<string, unknown>

type DescribedError = {
  name: string
  code?: string
  message: string
}

export function describeError(error: unknown): DescribedError {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    return {
      name: error.name,
      ...(typeof code === 'string' ? { code } : {}),
      message: error.message,
    }
  }
  return { name: 'UnknownError', message: String(error) }
}

// Tokens are secrets - only keep a short, non-reversible prefix for correlation.
export function maskToken(token: string | null | undefined): string | null {
  if (!token) return null
  return token.length <= 8 ? '***' : `${token.slice(0, 6)}…`
}

// Tag allow-list: only these keys get promoted to Sentry tags (low-cardinality,
// searchable). The full context is still attached as event "context" for full
// fidelity when an engineer opens the event in the Sentry UI.
const SEARCHABLE_TAG_KEYS = ['verificationId', 'providerId', 'vendor', 'action'] as const

function isSentrySinkEnabled(): boolean {
  // Treat blank / whitespace-only DSN values as "unset" so the fallback to
  // NEXT_PUBLIC_SENTRY_DSN still kicks in. `??` would only fall through on
  // null/undefined, which silently disabled the sink when SENTRY_DSN was
  // copied from .env.example and left empty. See F5 in code review.
  const serverDsn = process.env.SENTRY_DSN?.trim()
  const publicDsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim()
  return Boolean(serverDsn || publicDsn)
}

// Wrap a Sentry call so a transport / scope error can never reach the caller.
// Identity verification is on a hot path (provider onboarding); a misconfigured
// Sentry DSN must degrade gracefully to console-only logging.
function safeSentry(fn: () => void): void {
  if (!isSentrySinkEnabled()) return
  try {
    fn()
  } catch (sinkError) {
    // Last-resort: surface the sink failure to stderr but do not rethrow.
    console.error('[identity-verification] sentry sink failed', {
      error: describeError(sinkError),
    })
  }
}

export function logIdentityVerificationEvent(event: string, context: IdentityLogContext = {}): void {
  console.info(`[identity-verification] ${event}`, context)
  // Info-level events are intentionally NOT forwarded to Sentry — they are
  // breadcrumbs, not incidents. If/when we wire Sentry breadcrumbs, this is
  // the seam to extend (Sentry.addBreadcrumb).
}

export function logIdentityVerificationError(
  event: string,
  error: unknown,
  context: IdentityLogContext = {},
): void {
  const described = describeError(error)
  console.error(`[identity-verification] ${event}`, { ...context, error: described })

  safeSentry(() => {
    Sentry.withScope((scope) => {
      scope.setLevel('error')
      scope.setTag('event', event)
      for (const key of SEARCHABLE_TAG_KEYS) {
        const value = context[key]
        if (typeof value === 'string' && value.length > 0) {
          scope.setTag(key, value)
        }
      }
      scope.setContext('identity_verification', {
        event,
        ...context,
        error: described,
      })
      if (error instanceof Error) {
        Sentry.captureException(error)
      } else {
        // captureException requires an Error; for non-Error rejects (e.g.
        // `throw 'bad'`) fall back to a message so the event still lands.
        Sentry.captureMessage(`[identity-verification] ${event}: ${described.message}`, 'error')
      }
    })
  })
}
