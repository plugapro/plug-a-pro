import { describe, expect, it, vi } from 'vitest'

import { createOrResolveProviderApprovalAuthUser } from '@/lib/provider-approval-auth-user'

describe('createOrResolveProviderApprovalAuthUser', () => {
  it('reuses the existing Supabase auth user when provider approval hits phone_exists', async () => {
    const createUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: {
        status: 422,
        code: 'phone_exists',
        message: 'Phone number already registered by another user',
      },
    })
    const db = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          id: 'auth_existing',
          phone: '27821234567',
          raw_user_meta_data: { role: 'provider', providerId: 'provider_1' },
        },
      ]),
    }

    const result = await createOrResolveProviderApprovalAuthUser({
      db: db as never,
      supabase: { auth: { admin: { createUser } } } as never,
      phone: '+27821234567',
      name: 'Cornilious Dokotera',
      providerId: 'provider_1',
    })

    expect(createUser).toHaveBeenCalledWith({
      phone: '27821234567',
      phone_confirm: true,
      user_metadata: {
        role: 'provider',
        name: 'Cornilious Dokotera',
        providerId: 'provider_1',
      },
    })
    expect(db.$queryRaw).toHaveBeenCalledOnce()
    expect(result).toEqual({
      userId: 'auth_existing',
      source: 'existing',
    })
  })
})
