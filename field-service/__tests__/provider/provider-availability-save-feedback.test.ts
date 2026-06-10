import { beforeEach, describe, expect, it, vi } from 'vitest'

const tx = {
  providerSchedule: { upsert: vi.fn() },
  provider: { update: vi.fn() },
  technicianAvailability: { upsert: vi.fn() },
}

vi.mock('../../lib/auth', () => ({
  getSession: vi.fn(),
  // requireProvider() now gates the action: it validates the session role and
  // DB-backed portal eligibility, then returns the session (AuthUser). Tests drive
  // its outcome directly — a rejection ⇒ thrown redirect ⇒ session error.
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

vi.mock('../../lib/audit', () => ({
  recordAuditLog: vi.fn().mockResolvedValue(undefined),
}))

describe('provider availability save feedback action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tx.providerSchedule.upsert.mockResolvedValue({})
    tx.provider.update.mockResolvedValue({})
    tx.technicianAvailability.upsert.mockResolvedValue({})
  })

  it('returns a sign-in message when the provider session is missing', async () => {
    const { requireProvider } = await import('../../lib/auth')
    // requireProvider() throws (redirects) when there is no eligible provider session.
    ;(requireProvider as any).mockRejectedValue(new Error('NEXT_REDIRECT'))

    const { saveProviderAvailabilityFromFormAction } = await import('../../app/(provider)/provider/availability/actions')
    const result = await saveProviderAvailabilityFromFormAction(new FormData())

    expect(result).toEqual({
      ok: false,
      error: 'Your session expired. Sign in again to continue.',
    })
  })

  it('returns a validation error for an invalid pause-until value', async () => {
    const { requireProvider } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    ;(requireProvider as any).mockResolvedValue({ id: 'user-1', role: 'provider', phone: null })
    ;(db.provider.findFirst as any).mockResolvedValue({
      id: 'provider-1',
      active: true,
      status: 'ACTIVE',
      availableNow: true,
      technicianAvailability: null,
    })

    const formData = new FormData()
    formData.set('availabilityMode', 'PAUSED')
    formData.set('pausedUntil', 'not-a-date')

    const { saveProviderAvailabilityFromFormAction } = await import('../../app/(provider)/provider/availability/actions')
    const result = await saveProviderAvailabilityFromFormAction(formData)

    expect(result).toEqual({
      ok: false,
      error: 'Enter a valid pause-until date and time.',
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
    ;(db.provider.findFirst as any).mockResolvedValue({
      id: 'own-provider-id',
      active: true,
      status: 'ACTIVE',
      availableNow: true,
      technicianAvailability: null,
    })

    const formData = new FormData()
    formData.set('availabilityMode', 'PAUSED')
    formData.set('pausedUntil', 'not-a-date')

    const { saveProviderAvailabilityFromFormAction } = await import('../../app/(provider)/provider/availability/actions')
    const result = await saveProviderAvailabilityFromFormAction(formData)

    expect(result).toEqual({
      ok: false,
      error: 'Enter a valid pause-until date and time.',
    })
    expect(db.provider.findFirst).toHaveBeenCalledWith({
      where: { userId: 'auth-user-1' },
      include: { technicianAvailability: true },
    })
  })

  it('returns a validation error when active working hours are invalid', async () => {
    const { requireProvider } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    ;(requireProvider as any).mockResolvedValue({ id: 'user-1', role: 'provider', phone: null })
    ;(db.provider.findFirst as any).mockResolvedValue({
      id: 'provider-1',
      active: true,
      status: 'ACTIVE',
      availableNow: true,
      technicianAvailability: null,
    })

    const formData = new FormData()
    formData.set('day_1_active', 'on')
    formData.set('day_1_start', '18:00')
    formData.set('day_1_end', '09:00')

    const { saveProviderAvailabilityFromFormAction } = await import('../../app/(provider)/provider/availability/actions')
    const result = await saveProviderAvailabilityFromFormAction(formData)

    expect(result).toEqual({
      ok: false,
      error: 'Monday working hours are invalid. Set an end time later than the start time.',
    })
  })

  it('returns success when availability save completes', async () => {
    const { requireProvider } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    ;(requireProvider as any).mockResolvedValue({ id: 'user-1', role: 'provider', phone: null })
    ;(db.provider.findFirst as any).mockResolvedValue({
      id: 'provider-1',
      active: true,
      status: 'ACTIVE',
      availableNow: true,
      technicianAvailability: {
        pausedAt: null,
        availabilityMode: 'ALWAYS_AVAILABLE',
        availabilityState: 'AVAILABLE',
        breakUntil: null,
        emergencyAvailable: false,
        sameDayAvailable: true,
      },
    })

    const formData = new FormData()
    formData.set('availabilityMode', 'SCHEDULE')
    formData.set('day_1_active', 'on')
    formData.set('day_1_start', '08:00')
    formData.set('day_1_end', '17:00')

    const { saveProviderAvailabilityFromFormAction } = await import('../../app/(provider)/provider/availability/actions')
    const result = await saveProviderAvailabilityFromFormAction(formData)

    expect(result).toEqual({ ok: true, message: 'Availability saved' })
    expect(tx.providerSchedule.upsert).toHaveBeenCalled()
    expect(tx.technicianAvailability.upsert).toHaveBeenCalled()
  })

  it('returns a user-safe failure message when persistence fails', async () => {
    const { requireProvider } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    ;(requireProvider as any).mockResolvedValue({ id: 'user-1', role: 'provider', phone: null })
    ;(db.provider.findFirst as any).mockResolvedValue({
      id: 'provider-1',
      active: true,
      status: 'ACTIVE',
      availableNow: true,
      technicianAvailability: null,
    })
    tx.providerSchedule.upsert.mockRejectedValueOnce(new Error('database unavailable'))

    const formData = new FormData()
    formData.set('availabilityMode', 'SCHEDULE')

    const { saveProviderAvailabilityFromFormAction } = await import('../../app/(provider)/provider/availability/actions')
    const result = await saveProviderAvailabilityFromFormAction(formData)

    expect(result).toEqual({
      ok: false,
      error: 'Your availability was not saved. Check your connection and try again.',
    })
  })
})
