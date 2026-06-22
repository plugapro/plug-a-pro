// ─── Admin: Ops Intelligence ─────────────────────────────────────────────────
// Internal operational intelligence surface. Shows agent recommendations
// (provider applications, incomplete profiles, request friction, stuck matches),
// drafts awaiting approval, and a daily-summary placeholder. Admins review /
// resolve recommendations and approve/reject drafts. Nothing is ever sent.
//
// Gated by admin.ops_intelligence.

export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { OpsAgentKey, OpsRecommendationSeverity, OpsRecommendationStatus, Prisma } from '@prisma/client'

import { requireAdmin } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import {
  reviewRecommendationFromFormAction,
  decideDraftFromFormAction,
  runAgentsNowAction,
} from './actions'

export const metadata = buildMetadata({ title: 'Ops Intelligence', noIndex: true })

const AGENT_LABEL: Record<OpsAgentKey, string> = {
  PROVIDER_APPLICATION_REVIEW: 'Application Review',
  PROVIDER_PROFILE_COACH: 'Profile Coach',
  SERVICE_REQUEST_FRICTION: 'Request Friction',
  MATCHING_JOURNEY_MONITOR: 'Matching Monitor',
  POST_MATCH_FOLLOW_UP: 'Post-Match Follow-Up',
  OPS_DAILY_BRIEFING: 'Daily Briefing',
}

const SEVERITY_VARIANT: Record<OpsRecommendationSeverity, 'destructive' | 'default' | 'secondary' | 'outline'> = {
  CRITICAL: 'destructive',
  HIGH: 'destructive',
  MEDIUM: 'default',
  LOW: 'secondary',
  INFO: 'outline',
}

const STATUS_LABEL: Record<OpsRecommendationStatus, string> = {
  PENDING: 'Pending',
  ACKNOWLEDGED: 'Acknowledged',
  ACTIONED: 'Resolved',
  DISMISSED: 'Dismissed',
  SUPERSEDED: 'Superseded',
}

type SearchParamsPromise = Promise<{
  agent?: string
  severity?: string
  status?: string
  from?: string
  to?: string
}>

function parseEnum<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined
}

const AGENT_KEYS = [
  'PROVIDER_APPLICATION_REVIEW',
  'PROVIDER_PROFILE_COACH',
  'SERVICE_REQUEST_FRICTION',
  'MATCHING_JOURNEY_MONITOR',
] as const
const SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
const STATUSES = ['PENDING', 'ACKNOWLEDGED', 'ACTIONED', 'DISMISSED', 'SUPERSEDED'] as const

type RecWithDrafts = Prisma.OpsRecommendationGetPayload<{ include: { drafts: true } }>

/** One recommendation card with review actions. Reused by the escalations panel
 *  and the main recommendations list so the markup stays in one place. */
function RecommendationCard({ r }: { r: RecWithDrafts }) {
  const actions = (r.recommendedActions as Array<{ code: string; label: string; href?: string }>) ?? []
  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{AGENT_LABEL[r.agentKey]}</Badge>
        <Badge variant={SEVERITY_VARIANT[r.severity]}>{r.severity}</Badge>
        <span className="text-sm font-medium">{r.classification.replace(/_/g, ' ')}</span>
        {typeof r.score === 'number' && (
          <span className="text-muted-foreground text-xs">score {r.score}</span>
        )}
        <Badge variant="outline">{STATUS_LABEL[r.status]}</Badge>
        {r.drafts.length > 0 && <Badge variant="outline">draft</Badge>}
        <span className="text-muted-foreground ml-auto text-xs">
          {r.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
        </span>
      </div>
      <p className="mt-2 text-sm">{r.summary}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {actions.map((a) =>
          a.href ? (
            <Link key={a.code} href={a.href} className="text-primary text-xs underline">{a.label}</Link>
          ) : (
            <span key={a.code} className="text-muted-foreground text-xs">{a.label}</span>
          ),
        )}
      </div>
      {r.status === 'PENDING' && (
        <div className="mt-3 flex gap-2">
          {(['ACKNOWLEDGED', 'ACTIONED', 'DISMISSED'] as const).map((decision) => (
            <form key={decision} action={reviewRecommendationFromFormAction}>
              <input type="hidden" name="recommendationId" value={r.id} />
              <input type="hidden" name="decision" value={decision} />
              <Button type="submit" size="sm" variant={decision === 'DISMISSED' ? 'ghost' : 'outline'}>
                {decision === 'ACKNOWLEDGED' ? 'Acknowledge' : decision === 'ACTIONED' ? 'Resolve' : 'Dismiss'}
              </Button>
            </form>
          ))}
        </div>
      )}
    </div>
  )
}

export default async function OpsIntelligencePage({
  searchParams,
}: {
  searchParams: SearchParamsPromise
}) {
  await requireAdmin()
  const enabled = await isEnabled('admin.ops_intelligence')
  if (!enabled) notFound()

  const sp = await searchParams
  const agent = parseEnum(sp.agent, AGENT_KEYS)
  const severity = parseEnum(sp.severity, SEVERITIES)
  const status = parseEnum(sp.status, STATUSES)
  const from = sp.from ? new Date(sp.from) : undefined
  const to = sp.to ? new Date(sp.to) : undefined
  const createdAt =
    (from && !isNaN(from.getTime())) || (to && !isNaN(to.getTime()))
      ? {
          ...(from && !isNaN(from.getTime()) ? { gte: from } : {}),
          ...(to && !isNaN(to.getTime()) ? { lte: to } : {}),
        }
      : undefined

  const where: Prisma.OpsRecommendationWhereInput = {
    ...(agent ? { agentKey: agent } : {}),
    ...(severity ? { severity } : {}),
    ...(status ? { status } : {}),
    ...(createdAt ? { createdAt } : {}),
  }

  const [recommendations, pendingByAgent, pendingDraftCount, draftsAwaiting, latestBriefing] = await Promise.all([
    db.opsRecommendation.findMany({
      where,
      include: { drafts: { orderBy: { createdAt: 'desc' } } },
      // Highest severity first (CRITICAL→INFO via enum order), then most recent,
      // so the few items that need a human float to the top regardless of volume.
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    }),
    db.opsRecommendation.groupBy({
      by: ['agentKey'],
      where: { status: 'PENDING' },
      _count: { _all: true },
    }),
    db.opsDraftMessage.count({ where: { status: 'PENDING_APPROVAL' } }),
    db.opsDraftMessage.findMany({
      where: { status: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
      include: {
        recommendation: { select: { agentKey: true, entityType: true, entityId: true, summary: true, score: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    db.opsDailyBriefing.findFirst({ orderBy: { forDate: 'desc' } }),
  ])

  const pendingCount = (key: OpsAgentKey) =>
    pendingByAgent.find((g) => g.agentKey === key)?._count._all ?? 0

  // Escalations: the actual worklist — pending items an agent flagged as urgent.
  const escalations = recommendations.filter(
    (r) => r.status === 'PENDING' && (r.severity === 'HIGH' || r.severity === 'CRITICAL'),
  )

  // Group drafts by agent so a high-volume campaign (e.g. profile coaching) shows
  // as one ranked block, not N individual cards. Within a group, least-complete
  // first (lowest recommendation score) — the highest-impact nudges lead.
  const DRAFTS_SHOWN_PER_GROUP = 5
  const draftsByAgent = new Map<OpsAgentKey, typeof draftsAwaiting>()
  for (const d of draftsAwaiting) {
    const key = d.recommendation.agentKey
    const list = draftsByAgent.get(key) ?? []
    list.push(d)
    draftsByAgent.set(key, list)
  }
  const draftGroups = [...draftsByAgent.entries()].map(([key, list]) => {
    const ranked = [...list].sort(
      (a, b) => (a.recommendation.score ?? 999) - (b.recommendation.score ?? 999),
    )
    return { key, total: list.length, shown: ranked.slice(0, DRAFTS_SHOWN_PER_GROUP) }
  })

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Ops Intelligence</h1>
          <p className="text-muted-foreground text-sm">
            Internal agent recommendations and drafts. Nothing is sent without your approval.
          </p>
        </div>
        <form action={runAgentsNowAction}>
          <Button type="submit" variant="outline">Run agents now</Button>
        </form>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {AGENT_KEYS.map((key) => (
          <Card key={key}>
            <CardHeader className="pb-2">
              <CardDescription>{AGENT_LABEL[key]}</CardDescription>
              <CardTitle className="text-2xl">{pendingCount(key)}</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground pt-0 text-xs">pending</CardContent>
          </Card>
        ))}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Drafts awaiting</CardDescription>
            <CardTitle className="text-2xl">{pendingDraftCount}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground pt-0 text-xs">approval</CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <form method="GET" className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-xs">
              Agent
              <select name="agent" defaultValue={agent ?? ''} className="mt-1 rounded-md border px-2 py-1 text-sm">
                <option value="">All</option>
                {AGENT_KEYS.map((k) => (
                  <option key={k} value={k}>{AGENT_LABEL[k]}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs">
              Severity
              <select name="severity" defaultValue={severity ?? ''} className="mt-1 rounded-md border px-2 py-1 text-sm">
                <option value="">All</option>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs">
              Status
              <select name="status" defaultValue={status ?? ''} className="mt-1 rounded-md border px-2 py-1 text-sm">
                <option value="">All</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs">
              From
              <input type="date" name="from" defaultValue={sp.from ?? ''} className="mt-1 rounded-md border px-2 py-1 text-sm" />
            </label>
            <label className="flex flex-col text-xs">
              To
              <input type="date" name="to" defaultValue={sp.to ?? ''} className="mt-1 rounded-md border px-2 py-1 text-sm" />
            </label>
            <Button type="submit" size="sm">Filter</Button>
            <Link href="/admin/ops-intelligence" className="text-muted-foreground self-center text-xs underline">Reset</Link>
          </form>
        </CardContent>
      </Card>

      {/* Needs attention — the worklist: pending HIGH/CRITICAL items */}
      {escalations.length > 0 && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Needs attention ({escalations.length})</CardTitle>
            <CardDescription>Pending high-severity items — stuck jobs, suspicious applications, urgent friction.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {escalations.map((r) => (
              <RecommendationCard key={r.id} r={r} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Recommendations (severity-ordered) */}
      <Card>
        <CardHeader>
          <CardTitle>Recommendations ({recommendations.length})</CardTitle>
          <CardDescription>Provider applications, profiles, request friction, and matching alerts — highest severity first.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {recommendations.length === 0 && (
            <p className="text-muted-foreground text-sm">No recommendations match the current filters.</p>
          )}
          {recommendations.map((r) => (
            <RecommendationCard key={r.id} r={r} />
          ))}
        </CardContent>
      </Card>

      {/* Drafts awaiting approval — grouped by agent, highest-impact first */}
      <Card>
        <CardHeader>
          <CardTitle>Message drafts awaiting approval ({draftsAwaiting.length})</CardTitle>
          <CardDescription>WhatsApp drafts proposed by agents, grouped by agent — least-complete first. Approving queues a draft; it does not send.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {draftsAwaiting.length === 0 && (
            <p className="text-muted-foreground text-sm">No drafts awaiting approval.</p>
          )}
          {draftGroups.map((group) => (
            <div key={group.key} className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 border-b pb-1">
                <Badge variant="secondary">{AGENT_LABEL[group.key]}</Badge>
                <span className="text-sm font-medium">{group.total} pending</span>
                {group.total > group.shown.length && (
                  <span className="text-muted-foreground text-xs">showing {group.shown.length} highest-impact</span>
                )}
              </div>
              {group.shown.map((d) => (
                <div key={d.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{d.recipientRole}</Badge>
                    <Badge variant={d.status === 'APPROVED' ? 'default' : 'outline'}>{d.status}</Badge>
                    {typeof d.recommendation.score === 'number' && (
                      <span className="text-muted-foreground text-xs">score {d.recommendation.score}</span>
                    )}
                    {d.templateName && <span className="text-muted-foreground text-xs">{d.templateName}</span>}
                  </div>
                  <pre className="bg-muted mt-2 whitespace-pre-wrap rounded-md p-3 text-sm">{d.renderedPreview}</pre>
                  <p className="text-muted-foreground mt-1 text-xs">{d.rationale}</p>
                  {d.status === 'PENDING_APPROVAL' && (
                    <div className="mt-3 flex gap-2">
                      <form action={decideDraftFromFormAction}>
                        <input type="hidden" name="draftId" value={d.id} />
                        <input type="hidden" name="decision" value="APPROVE" />
                        <Button type="submit" size="sm">Approve (queue, no send)</Button>
                      </form>
                      <form action={decideDraftFromFormAction}>
                        <input type="hidden" name="draftId" value={d.id} />
                        <input type="hidden" name="decision" value="REJECT" />
                        <Button type="submit" size="sm" variant="ghost">Reject</Button>
                      </form>
                    </div>
                  )}
                </div>
              ))}
              {group.total > group.shown.length && (
                <p className="text-muted-foreground text-xs">
                  +{group.total - group.shown.length} more {AGENT_LABEL[group.key]} drafts. Batch review / send lands in Phase 2.
                </p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Daily summary placeholder */}
      <Card>
        <CardHeader>
          <CardTitle>Daily summary</CardTitle>
          <CardDescription>Ops Daily Briefing (Phase 2).</CardDescription>
        </CardHeader>
        <CardContent>
          {latestBriefing ? (
            <pre className="whitespace-pre-wrap text-sm">{latestBriefing.markdown}</pre>
          ) : (
            <p className="text-muted-foreground text-sm">No briefing yet — the Ops Daily Briefing agent lands in Phase 2.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
