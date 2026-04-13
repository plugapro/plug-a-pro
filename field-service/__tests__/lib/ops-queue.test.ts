import { describe, expect, it, vi } from 'vitest'

import {
  OPS_QUEUE_TYPES,
  claimOpsQueueItem,
  formatOpsQueueOwnerLabel,
  listOpsQueueAssignments,
  releaseOpsQueueItem,
} from '@/lib/ops-queue'

describe('ops queue helpers', () => {
  it('loads assignments into an entity-id keyed map', async () => {
    const client = {
      opsQueueAssignment: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'assign_1',
            queueType: OPS_QUEUE_TYPES.VALIDATION,
            entityId: 'job_1',
            claimedById: 'admin_1',
            claimedByRole: 'OWNER',
            claimedByLabel: 'ops@plugapro.co.za',
            claimedAt: new Date('2026-04-13T10:00:00.000Z'),
          },
        ]),
      },
    }

    const assignments = await listOpsQueueAssignments(
      client as never,
      OPS_QUEUE_TYPES.VALIDATION,
      ['job_1', 'job_2'],
    )

    expect(client.opsQueueAssignment.findMany).toHaveBeenCalledWith({
      where: {
        queueType: OPS_QUEUE_TYPES.VALIDATION,
        entityId: { in: ['job_1', 'job_2'] },
      },
      select: {
        id: true,
        queueType: true,
        entityId: true,
        claimedById: true,
        claimedByRole: true,
        claimedByLabel: true,
        claimedAt: true,
      },
    })
    expect(assignments.get('job_1')?.claimedByLabel).toBe('ops@plugapro.co.za')
    expect(assignments.has('job_2')).toBe(false)
  })

  it('upserts claim ownership onto a queue item', async () => {
    const claimedAt = new Date('2026-04-13T10:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(claimedAt)

    const client = {
      opsQueueAssignment: {
        upsert: vi.fn().mockResolvedValue({
          id: 'assign_1',
          queueType: OPS_QUEUE_TYPES.QUOTE_APPROVAL,
          entityId: 'quote_1',
          claimedById: 'admin_1',
          claimedByRole: 'OWNER',
          claimedByLabel: 'ops@plugapro.co.za',
          claimedAt,
        }),
      },
    }

    await claimOpsQueueItem(client as never, {
      queueType: OPS_QUEUE_TYPES.QUOTE_APPROVAL,
      entityId: 'quote_1',
      claimedById: 'admin_1',
      claimedByRole: 'OWNER',
      claimedByLabel: 'ops@plugapro.co.za',
    })

    expect(client.opsQueueAssignment.upsert).toHaveBeenCalledWith({
      where: {
        queueType_entityId: {
          queueType: OPS_QUEUE_TYPES.QUOTE_APPROVAL,
          entityId: 'quote_1',
        },
      },
      create: {
        queueType: OPS_QUEUE_TYPES.QUOTE_APPROVAL,
        entityId: 'quote_1',
        claimedById: 'admin_1',
        claimedByRole: 'OWNER',
        claimedByLabel: 'ops@plugapro.co.za',
        claimedAt,
      },
      update: {
        claimedById: 'admin_1',
        claimedByRole: 'OWNER',
        claimedByLabel: 'ops@plugapro.co.za',
        claimedAt,
      },
      select: {
        id: true,
        queueType: true,
        entityId: true,
        claimedById: true,
        claimedByRole: true,
        claimedByLabel: true,
        claimedAt: true,
      },
    })

    vi.useRealTimers()
  })

  it('releases claim ownership from a queue item', async () => {
    const client = {
      opsQueueAssignment: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }

    await releaseOpsQueueItem(client as never, {
      queueType: OPS_QUEUE_TYPES.DISPUTE,
      entityId: 'dispute_1',
    })

    expect(client.opsQueueAssignment.updateMany).toHaveBeenCalledWith({
      where: {
        queueType: OPS_QUEUE_TYPES.DISPUTE,
        entityId: 'dispute_1',
      },
      data: {
        claimedById: null,
        claimedByRole: null,
        claimedByLabel: null,
        claimedAt: null,
      },
    })
  })

  it('formats owner labels for unclaimed, self-claimed, and other-claimed work', () => {
    expect(formatOpsQueueOwnerLabel(undefined, 'admin_1')).toBe('Unclaimed')
    expect(
      formatOpsQueueOwnerLabel(
        {
          id: 'assign_1',
          queueType: OPS_QUEUE_TYPES.VALIDATION,
          entityId: 'job_1',
          claimedById: 'admin_1',
          claimedByRole: 'OWNER',
          claimedByLabel: 'ops@plugapro.co.za',
          claimedAt: new Date(),
        },
        'admin_1',
      ),
    ).toBe('Claimed by you')
    expect(
      formatOpsQueueOwnerLabel({
        id: 'assign_1',
        queueType: OPS_QUEUE_TYPES.VALIDATION,
        entityId: 'job_1',
        claimedById: 'admin_2',
        claimedByRole: 'OWNER',
        claimedByLabel: 'ops-2@plugapro.co.za',
        claimedAt: new Date(),
      }),
    ).toBe('Claimed by ops-2@plugapro.co.za')
  })
})
