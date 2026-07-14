import { describe, expect, it, vi } from 'vitest'

import { resolveApplicationLocationNodeIds } from '@/lib/provider-application-service-areas'

const NODE_ROODEPOORT = {
  id: 'sub_roodepoort',
  label: 'Roodepoort',
  nodeType: 'SUBURB',
  slug: 'gauteng__johannesburg__jhb_west__roodepoort',
}
const NODE_RUIMSIG = {
  id: 'sub_ruimsig',
  label: 'Ruimsig',
  nodeType: 'SUBURB',
  slug: 'gauteng__johannesburg__jhb_west__ruimsig',
}

describe('resolveApplicationLocationNodeIds', () => {
  it('prefers the registration draft node ids when a linked draft exists', async () => {
    const client = {
      providerApplicationDraft: {
        findFirst: vi.fn().mockResolvedValue({ locationNodeIds: ['sub_roodepoort', 'sub_ruimsig'] }),
      },
      locationNode: {
        findMany: vi.fn().mockResolvedValue([NODE_ROODEPOORT, NODE_RUIMSIG]),
      },
    }

    const result = await resolveApplicationLocationNodeIds(client, {
      applicationId: 'app-1',
      serviceAreas: ['Some Unmatched Label'],
    })

    expect(result.source).toBe('draft')
    expect(result.locationNodeIds).toEqual(['sub_roodepoort', 'sub_ruimsig'])
    expect(result.unresolvedLabels).toEqual([])
    expect(client.providerApplicationDraft.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { submittedApplicationId: 'app-1' } }),
    )
    // Draft ids are validated against live active nodes.
    expect(client.locationNode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['sub_roodepoort', 'sub_ruimsig'] }, active: true }),
      }),
    )
  })

  it('drops stale draft ids that no longer resolve to active nodes and falls back to labels', async () => {
    const findMany = vi.fn()
      // draft validation returns nothing (stale ids)
      .mockResolvedValueOnce([])
      // label fallback finds one unambiguous node
      .mockResolvedValueOnce([NODE_ROODEPOORT])
    const client = {
      providerApplicationDraft: {
        findFirst: vi.fn().mockResolvedValue({ locationNodeIds: ['deleted_node'] }),
      },
      locationNode: { findMany },
    }

    const result = await resolveApplicationLocationNodeIds(client, {
      applicationId: 'app-2',
      serviceAreas: ['Roodepoort'],
    })

    expect(result.source).toBe('label_match')
    expect(result.locationNodeIds).toEqual(['sub_roodepoort'])
  })

  it('resolves legacy applications by unambiguous label match', async () => {
    const client = {
      providerApplicationDraft: { findFirst: vi.fn().mockResolvedValue(null) },
      locationNode: {
        findMany: vi.fn().mockResolvedValue([NODE_ROODEPOORT, NODE_RUIMSIG]),
      },
    }

    const result = await resolveApplicationLocationNodeIds(client, {
      applicationId: 'app-3',
      serviceAreas: ['roodepoort', 'RUIMSIG'],
    })

    expect(result.source).toBe('label_match')
    expect(result.locationNodeIds).toEqual(['sub_roodepoort', 'sub_ruimsig'])
    expect(result.unresolvedLabels).toEqual([])
  })

  it('never guesses on ambiguous labels and reports unknown labels', async () => {
    const client = {
      providerApplicationDraft: { findFirst: vi.fn().mockResolvedValue(null) },
      locationNode: {
        findMany: vi.fn().mockResolvedValue([
          // Two different nodes share the same label — ambiguous.
          { id: 'sub_ext_a', label: 'Extension 1', nodeType: 'SUBURB', slug: 'a__extension_1' },
          { id: 'sub_ext_b', label: 'Extension 1', nodeType: 'SUBURB', slug: 'b__extension_1' },
        ]),
      },
    }

    const result = await resolveApplicationLocationNodeIds(client, {
      applicationId: 'app-4',
      serviceAreas: ['Extension 1', 'Atlantis-on-Vaal'],
    })

    expect(result.locationNodeIds).toEqual([])
    expect(result.source).toBe('none')
    expect(result.unresolvedLabels).toEqual(['extension 1', 'atlantis-on-vaal'])
  })

  it('returns empty resolution when the client has no locationNode model (legacy test doubles)', async () => {
    const result = await resolveApplicationLocationNodeIds({}, {
      applicationId: 'app-5',
      serviceAreas: ['Roodepoort'],
    })

    expect(result).toEqual({ locationNodeIds: [], source: 'none', unresolvedLabels: [] })
  })

  it('survives a draft lookup failure and still resolves labels', async () => {
    const client = {
      providerApplicationDraft: {
        findFirst: vi.fn().mockRejectedValue(new Error('column does not exist')),
      },
      locationNode: {
        findMany: vi.fn().mockResolvedValue([NODE_RUIMSIG]),
      },
    }

    const result = await resolveApplicationLocationNodeIds(client, {
      applicationId: 'app-6',
      serviceAreas: ['Ruimsig'],
    })

    expect(result.source).toBe('label_match')
    expect(result.locationNodeIds).toEqual(['sub_ruimsig'])
  })
})
