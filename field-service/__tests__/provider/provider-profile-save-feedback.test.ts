import { beforeEach, describe, expect, it, vi } from 'vitest'

const tx = {
  provider: { update: vi.fn() },
  providerSchedule: { upsert: vi.fn() },
  technicianServiceArea: {
    updateMany: vi.fn(),
    findMany: vi.fn(),
    createMany: vi.fn(),
  },
  locationNode: { findMany: vi.fn() },
}

vi.mock('../../lib/auth', () => ({
  getSession: vi.fn(),
}))

vi.mock('../../lib/db', () => ({
  db: {
    provider: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(async (runner: (client: typeof tx) => Promise<unknown>) => runner(tx)),
  },
}))

vi.mock('../../lib/provider-skills', () => ({
  syncProviderSkills: vi.fn(),
}))

describe('provider profile save feedback action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tx.provider.update.mockResolvedValue({})
    tx.providerSchedule.upsert.mockResolvedValue({})
    tx.technicianServiceArea.updateMany.mockResolvedValue({})
    tx.technicianServiceArea.findMany.mockResolvedValue([])
    tx.technicianServiceArea.createMany.mockResolvedValue({})
    tx.locationNode.findMany.mockResolvedValue([])
  })

  it('returns a sign-in message when the provider session is missing', async () => {
    const { getSession } = await import('../../lib/auth')
    ;(getSession as any).mockResolvedValue(null)

    const { updateProviderProfileFromFormAction } = await import('../../app/(provider)/provider/profile/actions')
    const result = await updateProviderProfileFromFormAction(new FormData())

    expect(result).toEqual({
      ok: false,
      error: 'Your session expired. Sign in again to continue.',
    })
  })

  it('returns a plain validation error when no skills are selected', async () => {
    const { getSession } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    ;(getSession as any).mockResolvedValue({ id: 'user-1', role: 'provider', providerId: 'provider-1' })
    ;(db.provider.findFirst as any).mockResolvedValue({ id: 'provider-1' })

    const formData = new FormData()
    formData.set('name', 'Lovemore')

    const { updateProviderProfileFromFormAction } = await import('../../app/(provider)/provider/profile/actions')
    const result = await updateProviderProfileFromFormAction(formData)

    expect(result).toEqual({
      ok: false,
      error: 'Select at least one skill before saving your profile.',
    })
  })

  it('returns success when profile save completes', async () => {
    const { getSession } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    const { syncProviderSkills } = await import('../../lib/provider-skills')
    ;(getSession as any).mockResolvedValue({ id: 'user-1', role: 'provider', providerId: 'provider-1' })
    ;(db.provider.findFirst as any).mockResolvedValue({ id: 'provider-1' })
    ;(syncProviderSkills as any).mockResolvedValue(undefined)

    const formData = new FormData()
    formData.set('name', 'Lovemore Dube')
    formData.append('skillTags', 'Plumbing')

    const { updateProviderProfileFromFormAction } = await import('../../app/(provider)/provider/profile/actions')
    const result = await updateProviderProfileFromFormAction(formData)

    expect(result).toEqual({ ok: true, message: 'Profile updated' })
    expect(tx.provider.update).toHaveBeenCalled()
    expect(tx.providerSchedule.upsert).toHaveBeenCalledTimes(7)
  })

  it('maps unique email errors to a user-safe message', async () => {
    const { getSession } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    ;(getSession as any).mockResolvedValue({ id: 'user-1', role: 'provider', providerId: 'provider-1' })
    ;(db.provider.findFirst as any).mockResolvedValue({ id: 'provider-1' })
    tx.provider.update.mockRejectedValueOnce(new Error('Unique constraint failed on the fields: (`email`)'))

    const formData = new FormData()
    formData.set('email', 'duplicate@example.com')
    formData.append('skillTags', 'Electrical')

    const { updateProviderProfileFromFormAction } = await import('../../app/(provider)/provider/profile/actions')
    const result = await updateProviderProfileFromFormAction(formData)

    expect(result).toEqual({
      ok: false,
      error: 'That email is already in use. Use a different email and try again.',
    })
  })
})
