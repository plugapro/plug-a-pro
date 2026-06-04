import { describe, expect, it, vi } from 'vitest'

import {
  findConflictingActiveProviderApplications,
  findLatestActiveProviderApplicationByPhone,
  getConflictingActiveProviderApplicationIds,
} from '@/lib/provider-applications'

describe('provider application identity helpers', () => {
  it('finds the latest active application by all canonical phone variants', async () => {
    const client = {
      providerApplication: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'app_latest',
          phone: '+27821234567',
          status: 'PENDING',
        }),
      },
    }

    const result = await findLatestActiveProviderApplicationByPhone(client as never, '082 123 4567')

    expect(result).toMatchObject({ id: 'app_latest', status: 'PENDING' })
    expect(client.providerApplication.findFirst).toHaveBeenCalledWith({
      where: {
        phone: { in: ['+27821234567', '27821234567', '0821234567'] },
        status: { in: ['PENDING', 'MORE_INFO_REQUIRED', 'APPROVED'] },
      },
      orderBy: { submittedAt: 'desc' },
      select: {
        id: true,
        phone: true,
        status: true,
        name: true,
        providerId: true,
        submittedAt: true,
      },
    })
  })

  it('can exclude the current application id when checking conflicts across phone variants', async () => {
    const client = {
      providerApplication: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'app_other', phone: '+27821234567', status: 'PENDING' },
        ]),
        findFirst: vi.fn(),
      },
    }

    const result = await findConflictingActiveProviderApplications(client as never, '0027821234567', {
      excludeId: 'app_current',
    })

    expect(result).toHaveLength(1)
    expect(client.providerApplication.findMany).toHaveBeenCalledWith({
      where: {
        phone: { in: ['+27821234567', '27821234567', '0821234567'] },
        status: { in: ['PENDING', 'MORE_INFO_REQUIRED', 'APPROVED'] },
        id: { not: 'app_current' },
      },
      orderBy: { submittedAt: 'desc' },
      select: {
        id: true,
        phone: true,
        status: true,
        name: true,
        providerId: true,
        submittedAt: true,
      },
    })
  })

  it('flags only phones with multiple active applications as conflicts', () => {
    const conflictingIds = getConflictingActiveProviderApplicationIds([
      { id: 'app_1', phone: '0821234567', status: 'PENDING' },
      { id: 'app_2', phone: '+27821234567', status: 'APPROVED' },
      { id: 'app_3', phone: '+27825550000', status: 'REJECTED' },
      { id: 'app_4', phone: '+27826660000', status: 'PENDING' },
      { id: 'app_5', phone: '+27826660000', status: 'MORE_INFO_REQUIRED' },
    ])

    expect(conflictingIds).toEqual(new Set(['app_1', 'app_2', 'app_4', 'app_5']))
  })
})
