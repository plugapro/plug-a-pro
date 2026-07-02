// ─── Match Domain Events ──────────────────────────────────────────────────────
// Structured event logging for the matching engine.
// Every match outcome emits exactly one event.
//
// These are currently written to stdout as JSON. The event field is stable -
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
      // Aggregated reason and per-stage funnel counts. See diagnostics.ts.
      noMatchReason?:
        | 'INSUFFICIENT_REQUEST_DATA'
        | 'NO_LOCATION_MATCH'
        | 'NO_SKILL_MATCH_IN_LOCATION'
        | 'NO_APPROVED_PROVIDER'
        | 'NO_MATCH'
      stageCounts?: {
        locationCandidates: number | null
        skillCandidates: number
        eligibleCount: number
        rankedCount: number
      }
    }
  | {
      event: 'match.accepted'
      jobRequestId: string
      providerId: string
      bookingId: string
      latencyMs: number
      // Present (true) when the accept was honored inside the late-response
      // grace window after lead.expiresAt. See MATCHING_CONFIG.lateResponseGraceMinutes.
      lateAccepted?: boolean
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
      // Optional — present when emitted from the orchestrator path. Lets log
      // aggregators partition SKIPs by trigger source (cron / job_creation /
      // manual / rematch) alongside other match.* events.
      triggeredBy?: string
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
  | {
      event: 'provider.auto_paused'
      providerId: string
      reason: string
      timeoutCount: number
      windowHours: number
      pauseType: 'temporary' | 'hard'
    }

export function emitMatchEvent(event: MatchDomainEvent): void {
  console.log(JSON.stringify({
    ...event,
    ts: new Date().toISOString(),
  }))
}
