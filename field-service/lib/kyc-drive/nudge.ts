// KYC drive auto-nudge selection and send orchestration.
//
// Targets the legacy cohort only (created before KYC_GRACE_CUTOFF, still not
// kycStatus=VERIFIED) — the providers grandfathered by
// matching.kyc_grace_legacy_providers. Post-cutoff providers are excluded: they
// already hit the hard KYC gate and are handled by onboarding, not this drive.
//
// Politeness invariants: at most KYC_DRIVE_MAX_NUDGES per provider, spaced at
// least KYC_DRIVE_NUDGE_SPACING_DAYS apart (cadence derived from the
// provider_kyc_nudge MessageEvent history), batch-capped per cron run. Thin
// skill categories rank first so per-skill VERIFIED coverage — the
// grace-flag-retirement gate — recovers fastest.

import { KYC_GRACE_CUTOFF } from '@/lib/matching/kyc-grace'

export const KYC_DRIVE_TEMPLATE = 'provider_kyc_nudge'
export const KYC_DRIVE_MAX_NUDGES = 3
export const KYC_DRIVE_NUDGE_SPACING_DAYS = 7

// Kept in sync with IN_FLIGHT_TEMPLATE_NAMES in
// lib/identity-verification/in-flight-renudge.ts — not imported from there
// because that module imports KYC_DRIVE_TEMPLATE from here (avoids a cycle).
// A resume nudge within the last 24h blocks a kyc-drive nudge to the same
// phone; it does not count toward the kyc-drive max/spacing cadence.
const IN_FLIGHT_RESUME_TEMPLATES = [
  'provider_verification_resume_consent',
  'provider_verification_resume_document',
  'provider_verification_resume_selfie',
] as const

const SPACING_MS = KYC_DRIVE_NUDGE_SPACING_DAYS * 24 * 60 * 60 * 1000
const CROSS_CRON_DEDUP_MS = 24 * 60 * 60 * 1000

export type KycNudgeCandidate = {
  providerId: string
  firstName: string
  phone: string
  skills: string[]
  skillRank: number
  nudgeCount: number
  lastNudgedAt: Date | null
  eligibleNow: boolean
}

type ProviderRow = {
  id: string
  firstName: string | null
  name: string | null
  phone: string | null
  skills: string[]
  kycStatus: string | null
  createdAt: Date
}

export type KycNudgeClient = {
  provider: {
    findMany(args: unknown): Promise<unknown>
  }
  messageEvent: {
    findMany(args: unknown): Promise<unknown>
  }
}

export function firstNameFrom(firstName: string | null, name: string | null): string {
  const candidate = firstName?.trim() || name?.trim().split(/\s+/)[0] || ''
  return candidate || 'there'
}

export async function listKycNudgeCandidates(
  client: KycNudgeClient,
  opts: { now?: Date } = {},
): Promise<KycNudgeCandidate[]> {
  const now = opts.now ?? new Date()

  const allActive = (await client.provider.findMany({
    where: { active: true, verified: true, status: 'ACTIVE', isTestUser: false },
    select: {
      id: true,
      firstName: true,
      name: true,
      phone: true,
      skills: true,
      kycStatus: true,
      createdAt: true,
    },
  })) as ProviderRow[]

  // Per-skill VERIFIED coverage, case-normalized — provider.skills contains
  // mixed-case duplicates of the same category ("Painting" vs "painting").
  const verifiedBySkill = new Map<string, number>()
  for (const p of allActive) {
    if (p.kycStatus !== 'VERIFIED') continue
    for (const raw of p.skills ?? []) {
      const skill = raw.trim().toLowerCase()
      if (!skill) continue
      verifiedBySkill.set(skill, (verifiedBySkill.get(skill) ?? 0) + 1)
    }
  }

  const targets = allActive.filter(
    p => p.kycStatus !== 'VERIFIED' && p.createdAt < KYC_GRACE_CUTOFF && Boolean(p.phone?.trim()),
  )
  if (targets.length === 0) return []

  const events = (await client.messageEvent.findMany({
    where: {
      templateName: { in: [KYC_DRIVE_TEMPLATE, ...IN_FLIGHT_RESUME_TEMPLATES] },
      direction: 'OUTBOUND',
      to: { in: targets.map(p => p.phone as string) },
    },
    select: { to: true, createdAt: true, templateName: true },
  })) as Array<{ to: string; createdAt: Date; templateName: string }>

  const crossCronCutoff = new Date(now.getTime() - CROSS_CRON_DEDUP_MS)
  const history = new Map<string, { count: number; last: Date }>()
  const recentlyResumeNudged = new Set<string>()
  for (const e of events) {
    if (e.templateName !== KYC_DRIVE_TEMPLATE) {
      // In-flight resume nudge: only the 24h cross-cron window applies.
      if (e.createdAt >= crossCronCutoff) recentlyResumeNudged.add(e.to)
      continue
    }
    const row = history.get(e.to)
    if (!row) history.set(e.to, { count: 1, last: e.createdAt })
    else {
      row.count += 1
      if (e.createdAt > row.last) row.last = e.createdAt
    }
  }

  const candidates = targets.map((p): KycNudgeCandidate => {
    const phone = (p.phone as string).trim()
    const h = history.get(phone)
    const nudgeCount = h?.count ?? 0
    const lastNudgedAt = h?.last ?? null
    // Rarest skill drives priority: a provider whose skill has the fewest
    // VERIFIED peers unblocks the per-category flip floor soonest.
    const skillRank = Math.min(
      ...(p.skills ?? [])
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)
        .map(s => verifiedBySkill.get(s) ?? 0),
      Number.MAX_SAFE_INTEGER,
    )
    const eligibleNow =
      nudgeCount < KYC_DRIVE_MAX_NUDGES &&
      (lastNudgedAt === null || now.getTime() - lastNudgedAt.getTime() >= SPACING_MS) &&
      !recentlyResumeNudged.has(phone)
    return {
      providerId: p.id,
      firstName: firstNameFrom(p.firstName, p.name),
      phone,
      skills: p.skills ?? [],
      skillRank,
      nudgeCount,
      lastNudgedAt,
      eligibleNow,
    }
  })

  candidates.sort((a, b) =>
    a.skillRank - b.skillRank ||
    a.nudgeCount - b.nudgeCount ||
    (a.lastNudgedAt?.getTime() ?? 0) - (b.lastNudgedAt?.getTime() ?? 0),
  )
  return candidates
}

export function summarizeKycNudgeRows(rows: KycNudgeCandidate[]) {
  return {
    candidates: rows.length,
    eligibleNow: rows.filter(r => r.eligibleNow).length,
    exhausted: rows.filter(r => r.nudgeCount >= KYC_DRIVE_MAX_NUDGES).length,
  }
}

export type SendKycDriveNudgesDeps = {
  issueLink(input: { providerId: string }): Promise<{ verificationUrl: string | null }>
  // Writes the cadence MessageEvent. Called BEFORE send: if the attempt cannot
  // be recorded, the message is not sent. This makes the politeness invariants
  // (max nudges, spacing) hold even when a run crashes mid-batch or a post-send
  // write would have failed — a provider can never receive more messages than
  // recorded attempts.
  recordAttempt(params: { to: string; metadata: Record<string, unknown> }): Promise<unknown>
  send(params: {
    providerPhone: string
    providerFirstName: string
    deadline: string
    verificationUrl: string
    metadata?: Record<string, unknown>
  }): Promise<string>
}

export async function sendKycDriveNudges(
  client: KycNudgeClient,
  opts: {
    deadline: string
    batchCap: number
    deps: SendKycDriveNudgesDeps
    now?: Date
  },
): Promise<{ rows: KycNudgeCandidate[]; sent: number; skipped: number; errors: number }> {
  const rows = await listKycNudgeCandidates(client, { now: opts.now })
  const eligible = rows.filter(r => r.eligibleNow)
  const batch = eligible.slice(0, Math.max(0, opts.batchCap))

  let sent = 0
  let errors = 0
  for (const candidate of batch) {
    try {
      const { verificationUrl } = await opts.deps.issueLink({ providerId: candidate.providerId })
      if (!verificationUrl) {
        errors += 1
        console.error('[kyc-drive] no verification URL issued', { providerId: candidate.providerId })
        continue
      }
      const metadata = { kycDrive: true, providerId: candidate.providerId }
      // Attempt-first: consume the nudge slot before any message can go out.
      // A failed send after this point burns a slot — polite bias by design.
      await opts.deps.recordAttempt({ to: candidate.phone, metadata })
      await opts.deps.send({
        providerPhone: candidate.phone,
        providerFirstName: candidate.firstName,
        deadline: opts.deadline,
        verificationUrl,
        metadata,
      })
      sent += 1
    } catch (error) {
      errors += 1
      console.error('[kyc-drive] nudge send failed', {
        providerId: candidate.providerId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { rows, sent, skipped: eligible.length - batch.length, errors }
}
