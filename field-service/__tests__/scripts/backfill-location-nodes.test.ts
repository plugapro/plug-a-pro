import { beforeEach, describe, expect, it, vi } from 'vitest'
import { main } from '../../scripts/backfill-location-nodes'

/**
 * The backfill script uses PrismaClient via dependency injection (main(prisma)).
 * We construct a mock prisma client inline — no module-level vi.mock needed.
 */

function makePrisma({
  suburbNodes = [] as { id: string; label: string; cityKey: string | null }[],
  addresses = [] as { id: string; suburb: string; city: string | null }[],
} = {}) {
  const addressUpdate = vi.fn().mockResolvedValue({})
  const transaction = vi.fn().mockImplementation(async (ops: Promise<unknown>[]) => {
    return Promise.all(ops)
  })

  return {
    locationNode: {
      findMany: vi.fn().mockResolvedValue(suburbNodes),
    },
    address: {
      findMany: vi.fn().mockResolvedValue(addresses),
      update: addressUpdate,
    },
    $transaction: transaction,
    _addressUpdate: addressUpdate,
    _transaction: transaction,
  }
}

describe('backfill-location-nodes main()', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('makes no updates when all addresses already have locationNodeId (idempotent)', async () => {
    // locationNodeId IS NULL filter means prisma returns 0 addresses
    const prisma = makePrisma({ suburbNodes: [], addresses: [] })

    await main(prisma as never)

    expect(prisma._transaction).not.toHaveBeenCalled()
    expect(prisma._addressUpdate).not.toHaveBeenCalled()
  })

  it('updates address when suburb label + city match a SUBURB node', async () => {
    const prisma = makePrisma({
      suburbNodes: [{ id: 'node-sandton', label: 'Sandton', cityKey: 'johannesburg' }],
      addresses: [{ id: 'addr-1', suburb: 'Sandton', city: 'Johannesburg' }],
    })

    await main(prisma as never)

    expect(prisma._transaction).toHaveBeenCalledTimes(1)
    // transaction receives an array of promises — verify update was called with correct args
    expect(prisma._addressUpdate).toHaveBeenCalledWith({
      where: { id: 'addr-1' },
      data: { locationNodeId: 'node-sandton' },
    })
  })

  it('uses label-only fallback when city is missing but suburb is unambiguous', async () => {
    const prisma = makePrisma({
      suburbNodes: [{ id: 'node-rosebank', label: 'Rosebank', cityKey: 'johannesburg' }],
      addresses: [{ id: 'addr-2', suburb: 'Rosebank', city: null }],
    })

    await main(prisma as never)

    expect(prisma._addressUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { locationNodeId: 'node-rosebank' } }),
    )
  })

  it('does not call address.update when no matching node found (unresolved)', async () => {
    const prisma = makePrisma({
      suburbNodes: [{ id: 'node-sandton', label: 'Sandton', cityKey: 'johannesburg' }],
      addresses: [{ id: 'addr-3', suburb: 'Nonexistent Suburb', city: 'Cape Town' }],
    })

    await main(prisma as never)

    expect(prisma._addressUpdate).not.toHaveBeenCalled()
    expect(prisma._transaction).not.toHaveBeenCalled()
  })

  it('uses $transaction for batch updates when multiple matches exist', async () => {
    const prisma = makePrisma({
      suburbNodes: [
        { id: 'node-1', label: 'Sandton', cityKey: 'johannesburg' },
        { id: 'node-2', label: 'Rosebank', cityKey: 'johannesburg' },
      ],
      addresses: [
        { id: 'addr-1', suburb: 'Sandton', city: 'Johannesburg' },
        { id: 'addr-2', suburb: 'Rosebank', city: 'Johannesburg' },
      ],
    })

    await main(prisma as never)

    expect(prisma._transaction).toHaveBeenCalledTimes(1)
    expect(prisma._addressUpdate).toHaveBeenCalledTimes(2)
  })

  it('handles case-insensitive label matching (address suburb with different case)', async () => {
    const prisma = makePrisma({
      suburbNodes: [{ id: 'node-sea-point', label: 'Sea Point', cityKey: 'cape_town' }],
      addresses: [{ id: 'addr-4', suburb: 'sea point', city: 'Cape Town' }],
    })

    await main(prisma as never)

    expect(prisma._addressUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { locationNodeId: 'node-sea-point' } }),
    )
  })

  it('does not use label-only fallback when suburb name is ambiguous (multiple cities)', async () => {
    // "Rosebank" exists in both Johannesburg and Cape Town — ambiguous, so no fallback
    const prisma = makePrisma({
      suburbNodes: [
        { id: 'node-rosebank-jhb', label: 'Rosebank', cityKey: 'johannesburg' },
        { id: 'node-rosebank-cpt', label: 'Rosebank', cityKey: 'cape_town' },
      ],
      addresses: [{ id: 'addr-5', suburb: 'Rosebank', city: null }],
    })

    await main(prisma as never)

    // No city to disambiguate + multiple nodes = unresolved
    expect(prisma._addressUpdate).not.toHaveBeenCalled()
    expect(prisma._transaction).not.toHaveBeenCalled()
  })
})
