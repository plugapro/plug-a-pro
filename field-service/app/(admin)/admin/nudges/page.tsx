// ─── Admin: West Rand pilot provider nudge console ─────────────────────────
// Ordered queue of providers who could benefit from a profile-completion nudge.
// Per spec §5.3:
//   - Ordering: R5-plumbing > R5 > R4 > PENDING_R1 (within tier: oldest nudge)
//   - Actions: preview / CSV export / mark-batch-sent (all audit-logged)
//   - No outbound Meta API in v1 — ops sends externally
//
// Gated by launch.west_rand_pilot.nudge_console.

export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'

import { requireAdmin } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { WEST_RAND_PILOT } from '@/lib/launch/west-rand-pilot'
import { buildMetadata } from '@/lib/metadata'
import { listNudgeCandidates } from '@/lib/nudges/queue'

import { NudgeQueueTable } from './queue-table'

export const metadata = buildMetadata({ title: 'Provider nudges', noIndex: true })

type SearchParamsPromise = Promise<{
  suburb?: string
  category?: string
  tier?: string
}>

export default async function NudgesPage({
  searchParams,
}: {
  searchParams: SearchParamsPromise
}) {
  await requireAdmin()
  const enabled = await isEnabled('launch.west_rand_pilot.nudge_console')
  if (!enabled) {
    notFound()
  }

  const params = await searchParams
  const suburbSlug = params.suburb ?? null
  const categorySlug = params.category ?? null
  const tier = (params.tier as 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'PENDING_R1' | undefined) ?? null

  const candidates = await listNudgeCandidates({
    suburbSlug,
    categorySlug,
    tier,
  })

  return (
    <div className="space-y-4 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Provider nudges — {WEST_RAND_PILOT.label}</h1>
        <p className="text-sm text-muted-foreground">
          {candidates.length} candidate{candidates.length === 1 ? '' : 's'} — ordered R5-plumbing → R5 → R4 → PENDING_R1
        </p>
      </header>

      <NudgeQueueTable
        candidates={candidates.map((c) => ({
          providerId: c.providerId,
          name: c.name,
          phone: c.phone,
          tier: c.tier,
          skills: c.skills,
          missingItems: c.missingItems,
          missingItemsLabel: c.missingItemsLabel,
          renderedMessage: c.renderedMessage,
          lastNudgedAt: c.lastNudgedAt ? c.lastNudgedAt.toISOString() : null,
        }))}
        filter={{
          suburbSlug,
          categorySlug,
          tier,
        }}
      />
    </div>
  )
}
