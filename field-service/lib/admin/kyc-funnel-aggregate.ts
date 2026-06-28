// Admin KYC funnel reporting — data layer for /admin/reports/kyc-funnel.
//
// Two views:
//   1. Snapshot — current Provider.kycStatus distribution (NOT_STARTED → VERIFIED).
//      Operational summary: how many providers are missing KYC right now.
//   2. Activity — ProviderIdentityVerification rows started + terminal-decided
//      in a date window. Useful for tracking conversion velocity.
//
// Read-only aggregations. No PII surfaces — counts only.

import { Prisma, type ProviderStatus, type VerificationStatus } from '@prisma/client'

import { db as defaultDb } from '@/lib/db'

export const KYC_FUNNEL_STAGES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'SUBMITTED',
  'VERIFIED',
  'REJECTED',
  'EXPIRED',
] as const

export const ACTIVE_MISSING_KYC_STATUSES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'SUBMITTED',
  'REJECTED',
  'EXPIRED',
] as const

export type KycFunnelSnapshot = {
  notStarted: number
  inProgress: number
  submitted: number
  verified: number
  rejected: number
  expired: number
  total: number
  /** Active providers whose kycStatus is anything but VERIFIED. */
  activeMissingKyc: number
}

type DbClient = typeof defaultDb

export async function fetchKycSnapshot(opts: {
  db?: DbClient
  status?: ProviderStatus
}): Promise<KycFunnelSnapshot> {
  const db = opts.db ?? defaultDb
  const where: Prisma.ProviderWhereInput = {}
  if (opts.status) where.status = opts.status

  const rows = await db.provider.groupBy({
    by: ['kycStatus'],
    where,
    _count: { _all: true },
  })

  const byStatus = new Map<string, number>(rows.map(r => [r.kycStatus, r._count._all]))
  const get = (s: string) => byStatus.get(s) ?? 0
  const notStarted = get('NOT_STARTED')
  const inProgress = get('IN_PROGRESS')
  const submitted = get('SUBMITTED')
  const verified = get('VERIFIED')
  const rejected = get('REJECTED')
  const expired = get('EXPIRED')
  const total = notStarted + inProgress + submitted + verified + rejected + expired
  return {
    notStarted,
    inProgress,
    submitted,
    verified,
    rejected,
    expired,
    total,
    activeMissingKyc: total - verified,
  }
}

export type KycActivityCounts = {
  newStarts: number
  verifiedInWindow: number
  rejectedInWindow: number
  expiredInWindow: number
}

// VerificationStatus terminal values that drive the activity counts.
// PASSED is the success state; FAILED + EXPIRED are the failure surfaces
// (the Provider-level kycStatus calls these REJECTED + EXPIRED, but the
// per-verification enum uses FAILED — see prisma/schema.prisma).
const TERMINAL_DECISION_STATUSES: VerificationStatus[] = ['PASSED', 'FAILED', 'EXPIRED']

export async function fetchKycActivity(args: {
  db?: DbClient
  from: Date
  to: Date
}): Promise<KycActivityCounts> {
  const db = args.db ?? defaultDb
  const [newStarts, decisionRows] = await Promise.all([
    db.providerIdentityVerification.count({
      where: { createdAt: { gte: args.from, lt: args.to } },
    }),
    db.providerIdentityVerification.groupBy({
      by: ['status'],
      where: {
        decisionAt: { gte: args.from, lt: args.to },
        status: { in: TERMINAL_DECISION_STATUSES },
      },
      _count: { _all: true },
    }),
  ])

  const byStatus = new Map<VerificationStatus, number>(
    decisionRows.map(r => [r.status, r._count._all]),
  )
  return {
    newStarts,
    verifiedInWindow: byStatus.get('PASSED') ?? 0,
    rejectedInWindow: byStatus.get('FAILED') ?? 0,
    expiredInWindow: byStatus.get('EXPIRED') ?? 0,
  }
}
