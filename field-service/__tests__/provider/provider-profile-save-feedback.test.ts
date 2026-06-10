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
  // requireProvider() now gates every action: it validates the session role and
  // DB-backed portal eligibility, then returns the session (AuthUser). Tests drive
  // its outcome via getSession — null session ⇒ thrown redirect ⇒ session error.
  requireProvider: vi.fn(),
  providerAuthWhere: (session: { id: string; phone: string | null }) => ({
    OR: [
      { userId: session.id },
      ...(session.phone ? [{ phone: session.phone, userId: null }] : []),
    ],
  }),
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
    const { requireProvider } = await import('../../lib/auth')
    // requireProvider() throws (redirects) when there is no eligible provider session.
    ;(requireProvider as any).mockRejectedValue(new Error('NEXT_REDIRECT'))

    const { updateProviderProfileFromFormAction } = await import('../../app/(provider)/provider/profile/actions')
    const result = await updateProviderProfileFromFormAction(new FormData())

    expect(result).toEqual({
      ok: false,
      error: 'Your session expired. Sign in again to continue.',
    })
  })

  it('returns a plain validation error when no skills are selected', async () => {
    const { requireProvider } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    ;(requireProvider as any).mockResolvedValue({ id: 'user-1', role: 'provider', phone: null })
    ;(db.provider.findFirst as any).mockResolvedValue({ id: 'provider-1', active: true, status: 'ACTIVE' })

    const formData = new FormData()
    formData.set('name', 'Lovemore')

    const { updateProviderProfileFromFormAction } = await import('../../app/(provider)/provider/profile/actions')
    const result = await updateProviderProfileFromFormAction(formData)

    expect(result).toEqual({
      ok: false,
      error: 'Select at least one skill before saving your profile.',
    })
  })

  it('binds the provider lookup to the authenticated userId, never metadata providerId', async () => {
    const { requireProvider } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    // The session may carry a forged providerId; the action must ignore it and
    // bind the provider lookup exclusively to the authenticated session.id (userId).
    ;(requireProvider as any).mockResolvedValue({
      id: 'auth-user-1',
      role: 'provider',
      phone: '+27820000000',
      providerId: 'forged-provider-id',
    })
    ;(db.provider.findFirst as any).mockResolvedValue({ id: 'own-provider-id', active: true, status: 'ACTIVE' })

    const formData = new FormData()
    formData.set('name', 'Lovemore')

    const { updateProviderProfileFromFormAction } = await import('../../app/(provider)/provider/profile/actions')
    const result = await updateProviderProfileFromFormAction(formData)

    expect(result).toEqual({
      ok: false,
      error: 'Select at least one skill before saving your profile.',
    })
    expect(db.provider.findFirst).toHaveBeenCalledWith({
      where: { userId: 'auth-user-1' },
      select: { id: true, active: true, status: true },
    })
  })

  it('returns success when profile save completes', async () => {
    const { requireProvider } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    const { syncProviderSkills } = await import('../../lib/provider-skills')
    ;(requireProvider as any).mockResolvedValue({ id: 'user-1', role: 'provider', phone: null })
    ;(db.provider.findFirst as any).mockResolvedValue({ id: 'provider-1', active: true, status: 'ACTIVE' })
    ;(syncProviderSkills as any).mockResolvedValue(undefined)

    const formData = new FormData()
    formData.set('name', 'Lovemore Dube')
    // Must be an allowed pilot skill tag (lowercase) to pass server-side validation.
    formData.append('skillTags', 'plumbing')

    const { updateProviderProfileFromFormAction } = await import('../../app/(provider)/provider/profile/actions')
    const result = await updateProviderProfileFromFormAction(formData)

    expect(result).toEqual({ ok: true, message: 'Profile updated' })
    expect(tx.provider.update).toHaveBeenCalled()
    expect(tx.providerSchedule.upsert).toHaveBeenCalledTimes(7)
  })

  it('rejects skill tags outside the pilot allowed list', async () => {
    const { requireProvider } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    ;(requireProvider as any).mockResolvedValue({ id: 'user-1', role: 'provider', phone: null })
    ;(db.provider.findFirst as any).mockResolvedValue({ id: 'provider-1', active: true, status: 'ACTIVE' })

    const formData = new FormData()
    formData.set('name', 'Lovemore Dube')
    // 'electrical' is a restricted (non-pilot) skill — the action must reject it.
    formData.append('skillTags', 'electrical')

    const { updateProviderProfileFromFormAction } = await import('../../app/(provider)/provider/profile/actions')
    const result = await updateProviderProfileFromFormAction(formData)

    expect(result).toEqual({
      ok: false,
      error: 'One or more selected skills are not available in the current pilot. Please refresh and try again.',
    })
    expect(tx.provider.update).not.toHaveBeenCalled()
  })

  it('maps unique email errors to a user-safe message', async () => {
    const { requireProvider } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    ;(requireProvider as any).mockResolvedValue({ id: 'user-1', role: 'provider', phone: null })
    ;(db.provider.findFirst as any).mockResolvedValue({ id: 'provider-1', active: true, status: 'ACTIVE' })
    tx.provider.update.mockRejectedValueOnce(new Error('Unique constraint failed on the fields: (`email`)'))

    const formData = new FormData()
    formData.set('email', 'duplicate@example.com')
    // Use an allowed pilot skill so we reach the persistence step under test.
    formData.append('skillTags', 'plumbing')

    const { updateProviderProfileFromFormAction } = await import('../../app/(provider)/provider/profile/actions')
    const result = await updateProviderProfileFromFormAction(formData)

    expect(result).toEqual({
      ok: false,
      error: 'That email is already in use. Use a different email and try again.',
    })
  })
})
