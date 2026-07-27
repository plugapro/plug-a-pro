// ─── TEMPORARY board diagnostic ───────────────────────────────────────────────
// Runs the real board eligibility path inside the deployed prod runtime and
// returns stage-by-stage counts as JSON. Secret-guarded (CRON_SECRET). Remove
// once the empty-board investigation closes. READ-ONLY — no writes.
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import {
  findBoardJobsForProvider,
  boardEligibilityWhere,
  OPEN_INTEREST_STATUSES,
} from '@/lib/board/eligibility'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const url = new URL(request.url)
  const userId = url.searchParams.get('userId') || '736e3eeb-dc7e-4980-8c05-7c50e649d9e8'
  const providerId = url.searchParams.get('providerId') || '078b84eb-666d-43f1-b9e1-cbd287d00af3'
  const now = new Date()

  const flagOn = await isEnabled('provider.board.v1', { userId })

  const provider = await db.provider.findUnique({
    where: { id: providerId },
    select: { id: true, active: true, verified: true, skills: true, userId: true },
  })

  const areas = await db.technicianServiceArea.findMany({
    where: { providerId, active: true },
    select: { locationNodeId: true, suburbKey: true, areaType: true },
  })

  const candidates = (await db.jobRequest.findMany({
    where: boardEligibilityWhere(now) as never,
    select: {
      id: true,
      category: true,
      address: { select: { locationNodeId: true, suburb: true } },
      leads: { where: { status: { in: [...OPEN_INTEREST_STATUSES] } }, select: { status: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })) as Array<{
    id: string
    category: string
    address: { locationNodeId: string | null; suburb: string | null } | null
    leads: { status: string }[]
  }>

  const nodeIds = new Set(areas.map((a) => a.locationNodeId).filter(Boolean))
  const skillSet = new Set((provider?.skills ?? []).map((s) => s.toLowerCase()))

  const jobs = await findBoardJobsForProvider(db, providerId, {}, now)

  return NextResponse.json({
    now: now.toISOString(),
    flagOn,
    provider: provider
      ? { id: provider.id, active: provider.active, verified: provider.verified, userId: provider.userId, skills: provider.skills }
      : null,
    activeAreas: areas.length,
    nodeIds: [...nodeIds],
    eligibleCandidates: candidates.length,
    candidates: candidates.slice(0, 10).map((c) => ({
      id: c.id,
      category: c.category,
      node: c.address?.locationNodeId ?? null,
      suburb: c.address?.suburb ?? null,
      skillMatch: skillSet.has(String(c.category ?? '').toLowerCase()),
      areaMatch: !!(c.address?.locationNodeId && nodeIds.has(c.address.locationNodeId)),
      interests: c.leads.length,
    })),
    finalBoardJobs: jobs.length,
    finalBoardJobIds: jobs.map((j) => j.id),
  })
}
