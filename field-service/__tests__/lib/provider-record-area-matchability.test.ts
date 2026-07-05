import { describe, it, expect, vi } from 'vitest'
import { upsertStructuredServiceAreas } from '@/lib/provider-record'

function makeClient(node: Record<string, unknown>) {
  const upsert = vi.fn().mockResolvedValue({})
  const client = {
    locationNode: { findMany: vi.fn().mockResolvedValue([node]) },
    technicianServiceArea: { upsert },
  }
  return { client, upsert }
}

const BASE = {
  id: 'node-1',
  nodeType: 'SUBURB',
  provinceKey: 'gauteng',
  cityKey: 'johannesburg',
  label: 'Test Suburb',
}

describe('upsertStructuredServiceAreas matchability contract', () => {
  it('creates a jhb_north area with active=false (registered, held from leads)', async () => {
    const { client, upsert } = makeClient({
      ...BASE,
      slug: 'gauteng__johannesburg__jhb_north__sandton',
      regionKey: 'jhb_north',
      label: 'Sandton',
    })
    await upsertStructuredServiceAreas(client as never, 'prov-1', ['node-1'])
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ active: false }),
        update: expect.objectContaining({ active: false }),
      }),
    )
  })

  it('creates a jhb_west area with active=true (matchable now)', async () => {
    const { client, upsert } = makeClient({
      ...BASE,
      slug: 'gauteng__johannesburg__jhb_west__florida',
      regionKey: 'jhb_west',
      label: 'Florida',
    })
    await upsertStructuredServiceAreas(client as never, 'prov-1', ['node-1'])
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ active: true }),
      }),
    )
  })
})
