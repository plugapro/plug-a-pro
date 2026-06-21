// ─── Provider Application Review Agent — candidate loader ────────────────────
// All I/O lives here. Loads PENDING provider applications for the window and
// projects each onto the pure ApplicationCandidate the evaluator consumes,
// pre-computing the two cross-record signals (duplicate, pilot-area) so the
// evaluator stays pure.

import { db } from '@/lib/db'
import { computeInPilotArea } from '../../pilot-area'
import type { ApplicationCandidate } from './evaluator'

export interface LoadArgs {
  nowIso: string
  windowFromIso?: string | null
  windowToIso?: string | null
}

export async function loadApplicationCandidates(args: LoadArgs): Promise<ApplicationCandidate[]> {
  const submittedAt =
    args.windowFromIso || args.windowToIso
      ? {
          ...(args.windowFromIso ? { gte: new Date(args.windowFromIso) } : {}),
          ...(args.windowToIso ? { lte: new Date(args.windowToIso) } : {}),
        }
      : undefined

  const apps = await db.providerApplication.findMany({
    where: {
      status: 'PENDING',
      isTestUser: false,
      ...(submittedAt ? { submittedAt } : {}),
    },
    select: {
      id: true,
      name: true,
      phone: true,
      alternateMobileE164: true,
      skills: true,
      serviceAreas: true,
      experience: true,
      availability: true,
      evidenceNote: true,
      evidenceFileUrls: true,
      idNumber: true,
      callOutFee: true,
      hourlyRate: true,
    },
    orderBy: { submittedAt: 'desc' },
    take: 200,
  })

  if (apps.length === 0) return []

  // Cross-record duplicate signal: a phone that already has a Provider account, or
  // that appears on more than one application, is flagged for ops to verify.
  const phones = Array.from(new Set(apps.map((a) => a.phone).filter(Boolean)))
  const [existingProviders, appPhoneGroups] = await Promise.all([
    db.provider.findMany({ where: { phone: { in: phones } }, select: { phone: true } }),
    db.providerApplication.groupBy({
      by: ['phone'],
      where: { phone: { in: phones } },
      _count: { phone: true },
    }),
  ])
  const providerPhones = new Set(existingProviders.map((p) => p.phone))
  const appPhoneCount = new Map(appPhoneGroups.map((g) => [g.phone, g._count.phone]))

  return apps.map((a): ApplicationCandidate => {
    const duplicateSignal =
      providerPhones.has(a.phone) || (appPhoneCount.get(a.phone) ?? 0) > 1
    const firstName = a.name?.trim().split(/\s+/)[0] ?? null
    return {
      id: a.id,
      hasName: Boolean(a.name && a.name.trim()),
      hasContact: Boolean(a.phone || a.alternateMobileE164),
      phone: a.phone ?? null,
      categoryCount: a.skills.length,
      serviceAreaCount: a.serviceAreas.length,
      descriptionLength: (a.evidenceNote ?? '').trim().length,
      portfolioCount: a.evidenceFileUrls.length,
      hasAvailability: Boolean(a.availability),
      hasExperience: Boolean(a.experience),
      hasIdNumber: Boolean(a.idNumber),
      hasRateInfo: a.callOutFee != null || a.hourlyRate != null,
      inPilotArea: computeInPilotArea(a.serviceAreas),
      duplicateSignal,
      firstName,
    }
  })
}
