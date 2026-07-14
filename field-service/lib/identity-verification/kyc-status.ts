// Bridge between the fine-grained ProviderIdentityVerification.status enum
// (15 values) and the coarse-grained Provider.kycStatus enum (6 values) that
// drives admin and provider PWA badges.
//
// Why this exists:
// Until 2026-06-08, the orchestrator only propagated terminal verification
// states (PASSED -> VERIFIED, FAILED -> REJECTED, EXPIRED -> EXPIRED). All
// intermediate states (STARTED, CONSENTED, AWAITING_*, SUBMITTED, PROCESSING,
// AWAITING_LIVENESS, NEEDS_MANUAL_REVIEW, RETRY_REQUIRED) silently left
// Provider.kycStatus at NOT_STARTED, so providers who had clearly initiated
// or submitted verification still showed "Identity not started" on every UI
// surface that read kycStatus directly.

import type { KycStatus } from '@prisma/client'
import type { VerificationDecision, VerificationStatus } from './types'

// Map an internal VerificationStatus (+ optional decision) to the coarse
// KycStatus that the UI badges read. Returns null when the kycStatus should
// not be touched (e.g. CANCELLED is ambiguous — let an admin decide).
export function kycStatusForVerificationStatus(
  status: VerificationStatus,
  decision?: VerificationDecision | null,
): KycStatus | null {
  switch (status) {
    case 'NOT_STARTED':
      return 'NOT_STARTED'
    case 'STARTED':
    case 'CONSENTED':
    case 'AWAITING_IDENTIFIER':
    case 'AWAITING_DOCUMENT':
    case 'AWAITING_SELFIE':
      return 'IN_PROGRESS'
    case 'SUBMITTED':
    case 'PROCESSING':
    case 'AWAITING_LIVENESS':
    case 'NEEDS_MANUAL_REVIEW':
      return 'SUBMITTED'
    case 'PASSED':
      return decision === 'PASS' ? 'VERIFIED' : 'SUBMITTED'
    case 'FAILED':
      return 'REJECTED'
    case 'EXPIRED':
      return 'EXPIRED'
    case 'RETRY_REQUIRED':
      // RETRY_REQUIRED is a terminal "needs more info" signal; surface as
      // REJECTED so the provider sees the "Identity retry needed" badge.
      return 'REJECTED'
    case 'CANCELLED':
      return null
  }
}

// Decide whether `target` should overwrite `current`, applying these rules:
//
// 1. VERIFIED is sticky. Only another terminal verdict (REJECTED or EXPIRED)
//    can replace it. Re-opening the verification flow on a verified provider
//    must not downgrade them to IN_PROGRESS or SUBMITTED.
//
// 2. Terminal "needs retry" states (REJECTED, EXPIRED) do not auto-downgrade
//    to NOT_STARTED or IN_PROGRESS just because a provider re-opened the
//    flow. A real new submission (SUBMITTED) or a new terminal verdict is
//    required.
//
// 3. SUBMITTED does not auto-downgrade to IN_PROGRESS or NOT_STARTED.
//
// 4. IN_PROGRESS does not auto-downgrade to NOT_STARTED.
//
// Returns the kycStatus to write, or null if the current state should stand.
export function resolveKycStatusUpdate(
  current: KycStatus,
  target: KycStatus | null,
): KycStatus | null {
  if (!target || current === target) return null

  if (current === 'VERIFIED') {
    return target === 'REJECTED' || target === 'EXPIRED' ? target : null
  }

  if (current === 'REJECTED' || current === 'EXPIRED') {
    if (target === 'NOT_STARTED' || target === 'IN_PROGRESS') return null
    return target
  }

  if (current === 'SUBMITTED') {
    if (target === 'NOT_STARTED' || target === 'IN_PROGRESS') return null
    return target
  }

  if (current === 'IN_PROGRESS') {
    if (target === 'NOT_STARTED') return null
    return target
  }

  return target
}
