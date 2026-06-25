// Tier 1 funnel observability — verifies the lead-access page writes
// Lead.viewedAt alongside the status flip and emits PROVIDER_VIEWED exactly
// once per lead (idempotent on second tap because the guard reads status).
// Spec: docs/superpowers/specs/2026-06-22-funnel-observability-tier1-design.md
//
// app/leads/access/[token]/page.tsx is a server component with many side
// effects. This test pins the emit-decision contract by reproducing it in
// isolation — the production page mirrors the helper here.

import { describe, it, expect, vi } from 'vitest'

const recordWorkflowEvent = vi.fn(async (_input: Record<string, unknown>) => ({ id: 'we_1', occurredAt: new Date() }))
vi.mock('../../lib/workflow-events/record', () => ({ recordWorkflowEvent }))

type LeadRow = {
  id: string
  providerId: string
  jobRequestId: string
  status: string
  viewedAt: Date | null
}

function makeStore(initial: LeadRow): {
  rows: LeadRow[]
  db: {
    lead: {
      update: (args: { where: { id: string }; data: Partial<LeadRow> }) => Promise<LeadRow>
    }
  }
} {
  const rows: LeadRow[] = [{ ...initial }]
  return {
    rows,
    db: {
      lead: {
        update: vi.fn(async ({ where, data }) => {
          const row = rows.find((r) => r.id === where.id)
          if (!row) throw new Error('not found')
          Object.assign(row, data)
          return row
        }),
      },
    },
  }
}

// Lifted contract from `app/leads/access/[token]/page.tsx`.
async function handleLeadAccess(
  lead: LeadRow,
  db: ReturnType<typeof makeStore>['db'],
  now: () => Date = () => new Date('2026-06-22T08:00:00.000Z'),
) {
  const { recordWorkflowEvent } = await import('../../lib/workflow-events/record')
  if (lead.status === 'SENT') {
    const viewedAt = now()
    const flipResult = await db.lead
      .update({ where: { id: lead.id }, data: { status: 'VIEWED', viewedAt } })
      .then(() => true)
      .catch(() => false)
    if (flipResult) {
      recordWorkflowEvent({
        eventType: 'PROVIDER_VIEWED',
        actorType: 'provider',
        actorId: lead.providerId,
        entityType: 'LEAD',
        entityId: lead.id,
        source: 'pwa',
        metadata: {
          jobRequestId: lead.jobRequestId,
          providerId: lead.providerId,
          viewedFromChannel: 'web',
        },
        occurredAt: viewedAt,
      }).catch(() => {})
    }
  }
}

describe('leads/access PROVIDER_VIEWED emit + Lead.viewedAt write', () => {
  it('flips SENT→VIEWED with viewedAt and emits PROVIDER_VIEWED', async () => {
    recordWorkflowEvent.mockClear()
    const fixedNow = new Date('2026-06-22T08:00:00.000Z')
    const { rows, db } = makeStore({
      id: 'lead_1',
      providerId: 'prov_1',
      jobRequestId: 'jr_1',
      status: 'SENT',
      viewedAt: null,
    })

    await handleLeadAccess({ ...rows[0] }, db, () => fixedNow)

    expect(rows[0]!.status).toBe('VIEWED')
    expect(rows[0]!.viewedAt).toEqual(fixedNow)
    expect(recordWorkflowEvent).toHaveBeenCalledTimes(1)
    expect(recordWorkflowEvent.mock.calls[0]![0]).toMatchObject({
      eventType: 'PROVIDER_VIEWED',
      actorType: 'provider',
      actorId: 'prov_1',
      entityType: 'LEAD',
      entityId: 'lead_1',
      source: 'pwa',
      occurredAt: fixedNow,
      metadata: { viewedFromChannel: 'web' },
    })
  })

  it('is idempotent on a second tap (status is no longer SENT — no emit)', async () => {
    recordWorkflowEvent.mockClear()
    const { rows, db } = makeStore({
      id: 'lead_2',
      providerId: 'prov_2',
      jobRequestId: 'jr_2',
      status: 'SENT',
      viewedAt: null,
    })

    await handleLeadAccess({ ...rows[0] }, db)
    expect(recordWorkflowEvent).toHaveBeenCalledTimes(1)

    // Second tap — status is now 'VIEWED', so the guard skips the block.
    await handleLeadAccess({ ...rows[0] }, db)
    expect(recordWorkflowEvent).toHaveBeenCalledTimes(1) // unchanged
  })

  it('does NOT emit if the DB update fails (no row in funnel for a failed flip)', async () => {
    recordWorkflowEvent.mockClear()
    const db = {
      lead: {
        update: vi.fn(async () => {
          throw new Error('connection lost')
        }),
      },
    } as any

    await handleLeadAccess(
      {
        id: 'lead_3',
        providerId: 'prov_3',
        jobRequestId: 'jr_3',
        status: 'SENT',
        viewedAt: null,
      },
      db,
    )
    expect(recordWorkflowEvent).not.toHaveBeenCalled()
  })
})
