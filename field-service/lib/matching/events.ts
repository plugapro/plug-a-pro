// ─── Match Domain Events ──────────────────────────────────────────────────────
// Structured event logging for the matching engine.
// Every match outcome emits exactly one event.
//
// These are currently written to stdout as JSON. The event field is stable —
// future integrations (analytics, alerting, pub/sub) should depend on it.

export type MatchDomainEvent =
  | {
      event: 'match.dispatched'
      jobRequestId: string
      providerId: string
      holdId: string
      triggeredBy: string
      latencyMs: number
    }
  | {
      event: 'match.no_providers'
      jobRequestId: string
      category: string
      suburb?: string
      consideredCount: number
      triggeredBy: string
      latencyMs: number
    }
  | {
      event: 'match.accepted'
      jobRequestId: string
      providerId: string
      bookingId: string
      latencyMs: number
    }
  | {
      event: 'match.declined'
      jobRequestId: string
      providerId: string
      holdId: string
      reason?: string
    }
  | {
      event: 'match.hold_expired'
      jobRequestId: string
      providerId: string
      holdId: string
      cascaded: boolean
    }
  | {
      event: 'match.rematch'
      jobRequestId: string
      attempt: number
      triggeredBy: string
    }
  | {
      event: 'match.exhausted'
      jobRequestId: string
      attempts: number
    }
  | {
      event: 'match.skipped'
      jobRequestId: string
      reason: string
    }
  | {
      event: 'pool.hit'
      categorySlug: string
      count: number
    }
  | {
      event: 'pool.miss'
      categorySlug: string
      fallbackCount: number
    }
  | {
      event: 'reservation.failed'
      jobRequestId: string
      providerId: string
      reason: string
    }

export function emitMatchEvent(event: MatchDomainEvent): void {
  console.log(JSON.stringify({
    ...event,
    ts: new Date().toISOString(),
  }))
}
