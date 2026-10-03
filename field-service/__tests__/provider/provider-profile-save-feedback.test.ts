import { beforeEach, describe, expect, it, vi } from 'vitest'

const tx = {
  provider: { update: vi.fn(), findUnique: vi.fn() },
  providerSchedule: { upsert: vi.fn() },
  technicianServiceArea: {
    updateMany: vi.fn(),
    findMany: vi.fn(),
    createMany: vi.fn(),
  },
  locationNode: { findMany: vi.fn() },
  providerCategory: { findMany: vi.fn(), createMany: vi.fn() },
  category: { findMany: vi.fn() },
  auditLog: { createMany: vi.fn() },
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

vi.mock('../../lib/flags', () => ({
  isEnabled: vi.fn().mockResolvedValue(false),
}))

describe('provider profile save feedback action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tx.provider.update.mockResolvedValue({})
    tx.provider.findUnique.mockResolvedValue({ status: 'ACTIVE' })
    tx.providerSchedule.upsert.mockResolvedValue({})
    tx.technicianServiceArea.updateMany.mockResolvedValue({})
    tx.technicianServiceArea.findMany.mockResolvedValue([])
    tx.technicianServiceArea.createMany.mockResolvedValue({})
    tx.locationNode.findMany.mockResolvedValue([])
    tx.providerCategory.findMany.mockResolvedValue([])
    tx.providerCategory.createMany.mockResolvedValue({ count: 0 })
    tx.category.findMany.mockResolvedValue([])
    tx.auditLog.createMany.mockResolvedValue({ count: 0 })
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

  it('creates a PENDING_REVIEW category row for a newly added skill when the review flag is on', async () => {
    const { requireProvider } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    const { syncProviderSkills } = await import('../../lib/provider-skills')
    const { isEnabled } = await import('../../lib/flags')
    ;(requireProvider as any).mockResolvedValue({ id: 'user-1', role: 'provider', phone: null })
    ;(db.provider.findFirst as any).mockResolvedValue({ id: 'provider-1', active: true, status: 'ACTIVE' })
    ;(syncProviderSkills as any).mockResolvedValue(undefined)
    ;(isEnabled as any).mockResolvedValue(true)
    tx.category.findMany.mockResolvedValue([{ slug: 'plumbing', id: 'cat-plumb', riskTier: 'STANDARD' }])

    const formData = new FormData()
    formData.set('name', 'Lovemore Dube')
    formData.append('skillTags', 'plumbing')

    const { updateProviderProfileFromFormAction } = await import('../../app/(provider)/provider/profile/actions')
    const result = await updateProviderProfileFromFormAction(formData)

    expect(result).toEqual({ ok: true, message: 'Profile updated' })
    expect(isEnabled).toHaveBeenCalledWith('provider.skill_category_review')
    expect(tx.providerCategory.createMany).toHaveBeenCalledOnce()
    const { data } = tx.providerCategory.createMany.mock.calls[0][0]
    expect(data[0]).toMatchObject({
      providerId: 'provider-1',
      categorySlug: 'plumbing',
      approvalStatus: 'PENDING_REVIEW',
    })
  })

  it('does not create category rows when the review flag is off (current behaviour preserved)', async () => {
    const { requireProvider } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    const { syncProviderSkills } = await import('../../lib/provider-skills')
    const { isEnabled } = await import('../../lib/flags')
    ;(requireProvider as any).mockResolvedValue({ id: 'user-1', role: 'provider', phone: null })
    ;(db.provider.findFirst as any).mockResolvedValue({ id: 'provider-1', active: true, status: 'ACTIVE' })
    ;(syncProviderSkills as any).mockResolvedValue(undefined)
    ;(isEnabled as any).mockResolvedValue(false)

    const formData = new FormData()
    formData.set('name', 'Lovemore Dube')
    formData.append('skillTags', 'plumbing')

    const { updateProviderProfileFromFormAction } = await import('../../app/(provider)/provider/profile/actions')
    const result = await updateProviderProfileFromFormAction(formData)

    expect(result).toEqual({ ok: true, message: 'Profile updated' })
    expect(tx.providerCategory.createMany).not.toHaveBeenCalled()
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

  it('saves a whole-region (REGION node) service area instead of rejecting it', async () => {
    const { requireProvider } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    const { syncProviderSkills } = await import('../../lib/provider-skills')
    ;(requireProvider as any).mockResolvedValue({ id: 'user-1', role: 'provider', phone: null })
    ;(db.provider.findFirst as any).mockResolvedValue({ id: 'provider-1', active: true, status: 'ACTIVE' })
    ;(syncProviderSkills as any).mockResolvedValue(undefined)
    tx.locationNode.findMany.mockResolvedValue([
      {
        id: 'region-1',
        slug: 'western_cape__cape_town__cape_town_cbd',
        label: 'Cape Town CBD & Atlantic Seaboard',
        nodeType: 'REGION',
        provinceKey: 'western_cape',
        cityKey: 'cape_town',
        regionKey: 'cape_town_cbd',
      },
    ])
    tx.technicianServiceArea.findMany.mockResolvedValue([])

    const formData = new FormData()
    formData.set('name', 'Lovemore Dube')
    formData.append('skillTags', 'plumbing')
    formData.set('serviceAreasPickerRendered', '1')
    formData.append('locationNodeIds', 'region-1')

    const { updateProviderProfileFromFormAction } = await import('../../app/(provider)/provider/profile/actions')
    const result = await updateProviderProfileFromFormAction(formData)

    expect(result).toEqual({ ok: true, message: 'Profile updated' })
    expect(tx.technicianServiceArea.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          providerId: 'provider-1',
          locationNodeId: 'region-1',
          areaType: 'REGION',
          regionKey: 'cape_town_cbd',
          suburbKey: null,
          active: true,
        }),
      ],
      skipDuplicates: true,
    })
  })

  it('still refuses CITY nodes submitted through the picker', async () => {
    const { requireProvider } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    const { syncProviderSkills } = await import('../../lib/provider-skills')
    ;(requireProvider as any).mockResolvedValue({ id: 'user-1', role: 'provider', phone: null })
    ;(db.provider.findFirst as any).mockResolvedValue({ id: 'provider-1', active: true, status: 'ACTIVE' })
    ;(syncProviderSkills as any).mockResolvedValue(undefined)
    tx.locationNode.findMany.mockResolvedValue([
      {
        id: 'city-1',
        slug: 'western_cape__cape_town',
        label: 'Cape Town',
        nodeType: 'CITY',
        provinceKey: 'western_cape',
        cityKey: 'cape_town',
        regionKey: null,
      },
    ])

    const formData = new FormData()
    formData.set('name', 'Lovemore Dube')
    formData.append('skillTags', 'plumbing')
    formData.set('serviceAreasPickerRendered', '1')
    formData.append('locationNodeIds', 'city-1')

    const { updateProviderProfileFromFormAction } = await import('../../app/(provider)/provider/profile/actions')
    const result = await updateProviderProfileFromFormAction(formData)

    expect(result).toEqual({ ok: false, error: 'Could not save your changes. Please try again.' })
    expect(tx.technicianServiceArea.createMany).not.toHaveBeenCalled()
    // The mock transaction has no rollback, so this proves validation runs
    // before the deactivating updateMany rather than relying on rollback.
    expect(tx.technicianServiceArea.updateMany).not.toHaveBeenCalled()
  })

  it('fails the save, with no service-area writes, when no posted node id resolves to an active node', async () => {
    const { requireProvider } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    const { syncProviderSkills } = await import('../../lib/provider-skills')
    ;(requireProvider as any).mockResolvedValue({ id: 'user-1', role: 'provider', phone: null })
    ;(db.provider.findFirst as any).mockResolvedValue({ id: 'provider-1', active: true, status: 'ACTIVE' })
    ;(syncProviderSkills as any).mockResolvedValue(undefined)
    tx.locationNode.findMany.mockResolvedValue([])

    const formData = new FormData()
    formData.set('name', 'Lovemore Dube')
    formData.append('skillTags', 'plumbing')
    formData.set('serviceAreasPickerRendered', '1')
    formData.append('locationNodeIds', 'inactive-or-missing-1')

    const { updateProviderProfileFromFormAction } = await import('../../app/(provider)/provider/profile/actions')
    const result = await updateProviderProfileFromFormAction(formData)

    expect(result).toEqual({ ok: false, error: 'Could not save your changes. Please try again.' })
    expect(tx.technicianServiceArea.updateMany).not.toHaveBeenCalled()
    expect(tx.technicianServiceArea.createMany).not.toHaveBeenCalled()
  })

  it('only resolves active location nodes for the posted ids', async () => {
    const { requireProvider } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    const { syncProviderSkills } = await import('../../lib/provider-skills')
    ;(requireProvider as any).mockResolvedValue({ id: 'user-1', role: 'provider', phone: null })
    ;(db.provider.findFirst as any).mockResolvedValue({ id: 'provider-1', active: true, status: 'ACTIVE' })
    ;(syncProviderSkills as any).mockResolvedValue(undefined)
    tx.locationNode.findMany.mockResolvedValue([
      {
        id: 'sub-1',
        slug: 'western_cape__cape_town__cape_town_cbd__sea_point',
        label: 'Sea Point',
        nodeType: 'SUBURB',
        provinceKey: 'western_cape',
        cityKey: 'cape_town',
        regionKey: 'cape_town_cbd',
      },
    ])

    const formData = new FormData()
    formData.set('name', 'Lovemore Dube')
    formData.append('skillTags', 'plumbing')
    formData.set('serviceAreasPickerRendered', '1')
    formData.append('locationNodeIds', 'sub-1')
    formData.append('locationNodeIds', 'stale-1')

    const { updateProviderProfileFromFormAction } = await import('../../app/(provider)/provider/profile/actions')
    const result = await updateProviderProfileFromFormAction(formData)

    expect(result).toEqual({ ok: true, message: 'Profile updated' })
    expect(tx.locationNode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['sub-1', 'stale-1'] }, active: true }),
      }),
    )
    expect(tx.technicianServiceArea.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ locationNodeId: 'sub-1', areaType: 'SUBURB' })],
      skipDuplicates: true,
    })
  })
})
