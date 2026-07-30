// ─── Provider Application Review Agent — candidate loader ────────────────────
// All I/O lives here. Loads PENDING provider applications for the window and
// projects each onto the pure ApplicationCandidate the evaluator consumes,
// pre-computing the two cross-record signals (duplicate, pilot-area) so the
// evaluator stays pure.

import { db } from '@/lib/db'
import { hasApplicationIdNumber } from '@/lib/pii-id-number'
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
      providerId: true,
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
      idNumberLast4: true,
      callOutFee: true,
      hourlyRate: true,
    },
    orderBy: { submittedAt: 'desc' },
    take: 200,
  })

  if (apps.length === 0) return []

  // Cross-record duplicate signal. NOTE: the registration flow creates a nascent
  // Provider row (status APPLICATION_PENDING, linked via ProviderApplication.providerId)
  // for every applicant, so "a Provider exists with this phone" is the NORMAL case —
  // it must NOT be treated as suspicious. We flag only:
  //   (a) the same phone appearing on more than one application, or
  //   (b) a phone whose matching Provider is a DIFFERENT, already-established account
  //       (ACTIVE or verified) — i.e. an already-onboarded provider re-applying.
  const phones = Array.from(new Set(apps.map((a) => a.phone).filter(Boolean)))
  const [sameProviders, appPhoneGroups] = await Promise.all([
    db.provider.findMany({
      where: { phone: { in: phones } },
      select: { id: true, phone: true, verified: true, status: true },
    }),
    db.providerApplication.groupBy({
      by: ['phone'],
      where: { phone: { in: phones } },
      _count: { phone: true },
    }),
  ])
  const providersByPhone = new Map<string, typeof sameProviders>()
  for (const p of sameProviders) {
    const list = providersByPhone.get(p.phone) ?? []
    list.push(p)
    providersByPhone.set(p.phone, list)
  }
  const appPhoneCount = new Map(appPhoneGroups.map((g) => [g.phone, g._count.phone]))
  const isEstablished = (p: (typeof sameProviders)[number]) =>
    p.verified === true || p.status === 'ACTIVE'

  return apps.map((a): ApplicationCandidate => {
    const otherEstablishedProvider = (providersByPhone.get(a.phone) ?? []).some(
      // exclude the applicant's own nascent provider record
      (p) => p.id !== a.providerId && isEstablished(p),
    )
    const duplicateSignal =
      (appPhoneCount.get(a.phone) ?? 0) > 1 || otherEstablishedProvider
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
      hasIdNumber: hasApplicationIdNumber(a),
      hasRateInfo: a.callOutFee != null || a.hourlyRate != null,
      inPilotArea: computeInPilotArea(a.serviceAreas),
      duplicateSignal,
      firstName,
    }
  })
}
