import { beforeEach, describe, expect, it, vi } from 'vitest'
import { main } from '../../scripts/backfill-location-nodes'

/**
 * The backfill script uses PrismaClient via dependency injection (main(prisma)).
 * We construct a mock prisma client inline - no module-level vi.mock needed.
 *
 * The script now has two phases:
 * Phase A: Address.locationNodeId resolution
 * Phase B: Provider structured service areas from legacy serviceAreas[] strings
 */

type NodeStub = { id: string; nodeType: string; slug: string; label: string; cityKey: string | null; regionKey: string | null; provinceKey: string | null }

function makePrisma({
  allNodes = [] as NodeStub[],
  addresses = [] as { id: string; suburb: string; city: string | null }[],
  providers = [] as { id: string; serviceAreas: string[] }[],
} = {}) {
  const addressUpdate = vi.fn().mockResolvedValue({})
  const transaction = vi.fn().mockImplementation(async (ops: Promise<unknown>[]) => {
    return Promise.all(ops)
  })
  const serviceAreaUpsert = vi.fn().mockResolvedValue({})

  return {
    locationNode: {
      findMany: vi.fn().mockResolvedValue(allNodes),
    },
    address: {
      findMany: vi.fn().mockResolvedValue(addresses),
      update: addressUpdate,
    },
    provider: {
      findMany: vi.fn().mockResolvedValue(providers),
    },
    technicianServiceArea: {
      upsert: serviceAreaUpsert,
    },
    $transaction: transaction,
    _addressUpdate: addressUpdate,
    _transaction: transaction,
    _serviceAreaUpsert: serviceAreaUpsert,
  }
}

const SANDTON_NODE: NodeStub = {
  id: 'node-sandton',
  nodeType: 'SUBURB',
  slug: 'johannesburg__sandton',
  label: 'Sandton',
  cityKey: 'johannesburg',
  regionKey: 'sandton_region',
  provinceKey: 'gauteng',
}

const ROSEBANK_NODE: NodeStub = {
  id: 'node-rosebank',
  nodeType: 'SUBURB',
  slug: 'johannesburg__rosebank',
  label: 'Rosebank',
  cityKey: 'johannesburg',
  regionKey: 'rosebank_region',
  provinceKey: 'gauteng',
}

describe('backfill-location-nodes main()', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  // ── Phase A: Address.locationNodeId ───────────────────────────────────────

  it('makes no updates when all addresses already have locationNodeId (idempotent)', async () => {
    // Simulates WHERE { locationNodeId: null } filter returning 0 rows.
    // Verify the correct filter is applied via the findMany call args.
    const prisma = makePrisma({ allNodes: [SANDTON_NODE], addresses: [] })

    await main(prisma as never)

    expect(prisma.address.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ locationNodeId: null }),
      }),
    )
    expect(prisma._transaction).not.toHaveBeenCalled()
    expect(prisma._addressUpdate).not.toHaveBeenCalled()
  })

  it('updates address when suburb label + city match a SUBURB node', async () => {
    const prisma = makePrisma({
      allNodes: [SANDTON_NODE],
      addresses: [{ id: 'addr-1', suburb: 'Sandton', city: 'Johannesburg' }],
    })

    await main(prisma as never)

    expect(prisma._transaction).toHaveBeenCalledTimes(1)
    expect(prisma._addressUpdate).toHaveBeenCalledWith({
      where: { id: 'addr-1' },
      data: { locationNodeId: 'node-sandton' },
    })
  })

  it('uses label-only fallback when city is missing but suburb is unambiguous', async () => {
    const prisma = makePrisma({
      allNodes: [ROSEBANK_NODE],
      addresses: [{ id: 'addr-2', suburb: 'Rosebank', city: null }],
    })

    await main(prisma as never)

    expect(prisma._addressUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { locationNodeId: 'node-rosebank' } }),
    )
  })

  it('does not call address.update when no matching node found (unresolved)', async () => {
    const prisma = makePrisma({
      allNodes: [SANDTON_NODE],
      addresses: [{ id: 'addr-3', suburb: 'Nonexistent Suburb', city: 'Cape Town' }],
    })

    await main(prisma as never)

    expect(prisma._addressUpdate).not.toHaveBeenCalled()
    expect(prisma._transaction).not.toHaveBeenCalled()
  })

  it('uses $transaction for batch updates when multiple addresses match', async () => {
    const prisma = makePrisma({
      allNodes: [SANDTON_NODE, ROSEBANK_NODE],
      addresses: [
        { id: 'addr-1', suburb: 'Sandton', city: 'Johannesburg' },
        { id: 'addr-2', suburb: 'Rosebank', city: 'Johannesburg' },
      ],
    })

    await main(prisma as never)

    expect(prisma._transaction).toHaveBeenCalledTimes(1)
    expect(prisma._addressUpdate).toHaveBeenCalledTimes(2)
  })

  it('handles case-insensitive label matching', async () => {
    const seaPointNode: NodeStub = {
      id: 'node-sea-point',
      nodeType: 'SUBURB',
      slug: 'cape_town__sea_point',
      label: 'Sea Point',
      cityKey: 'cape_town',
      regionKey: 'sea_point_region',
      provinceKey: 'western_cape',
    }
    const prisma = makePrisma({
      allNodes: [seaPointNode],
      addresses: [{ id: 'addr-4', suburb: 'sea point', city: 'Cape Town' }],
    })

    await main(prisma as never)

    expect(prisma._addressUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { locationNodeId: 'node-sea-point' } }),
    )
  })

  it('does not use label-only fallback when suburb name is ambiguous (multiple nodes)', async () => {
    const rosebankCPT: NodeStub = { ...ROSEBANK_NODE, id: 'node-rosebank-cpt', cityKey: 'cape_town' }
    const prisma = makePrisma({
      allNodes: [ROSEBANK_NODE, rosebankCPT],
      addresses: [{ id: 'addr-5', suburb: 'Rosebank', city: null }],
    })

    await main(prisma as never)

    expect(prisma._addressUpdate).not.toHaveBeenCalled()
    expect(prisma._transaction).not.toHaveBeenCalled()
  })

  // ── Phase B: Provider structured service areas ────────────────────────────

  it('creates structured service area rows for providers with only legacy string areas', async () => {
    const prisma = makePrisma({
      allNodes: [SANDTON_NODE],
      providers: [{ id: 'prov-1', serviceAreas: ['sandton'] }],
    })

    await main(prisma as never)

    expect(prisma._serviceAreaUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { providerId_locationNodeId: { providerId: 'prov-1', locationNodeId: 'node-sandton' } },
        create: expect.objectContaining({ areaType: 'SUBURB', suburbKey: 'sandton' }),
      }),
    )
  })

  it('writes REGION areaType for REGION nodes (not SUBURB)', async () => {
    const sandtonRegionNode: NodeStub = {
      id: 'node-sandton-region',
      nodeType: 'REGION',
      slug: 'johannesburg__sandton_region',
      label: 'Sandton Region',
      cityKey: 'johannesburg',
      regionKey: 'sandton_region',
      provinceKey: 'gauteng',
    }
    const prisma = makePrisma({
      allNodes: [sandtonRegionNode],
      providers: [{ id: 'prov-2', serviceAreas: ['sandton region'] }],
    })

    await main(prisma as never)

    expect(prisma._serviceAreaUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ areaType: 'REGION', suburbKey: null }),
      }),
    )
  })

  it('skips Phase B for providers with no resolvable legacy strings', async () => {
    const prisma = makePrisma({
      allNodes: [SANDTON_NODE],
      providers: [{ id: 'prov-3', serviceAreas: ['Unknown Area XYZ'] }],
    })

    await main(prisma as never)

    expect(prisma._serviceAreaUpsert).not.toHaveBeenCalled()
  })
})
