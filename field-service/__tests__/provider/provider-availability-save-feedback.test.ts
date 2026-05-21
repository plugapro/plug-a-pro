import { beforeEach, describe, expect, it, vi } from 'vitest'

const tx = {
  providerSchedule: { upsert: vi.fn() },
  provider: { update: vi.fn() },
  technicianAvailability: { upsert: vi.fn() },
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
    const { getSession } = await import('../../lib/auth')
    ;(getSession as any).mockResolvedValue(null)

    const { saveProviderAvailabilityFromFormAction } = await import('../../app/(provider)/provider/availability/actions')
    const result = await saveProviderAvailabilityFromFormAction(new FormData())

    expect(result).toEqual({
      ok: false,
      error: 'Your session expired. Sign in again to continue.',
    })
  })

  it('returns a validation error for an invalid pause-until value', async () => {
    const { getSession } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    ;(getSession as any).mockResolvedValue({ id: 'user-1', role: 'provider', providerId: 'provider-1' })
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

  it('returns a validation error when active working hours are invalid', async () => {
    const { getSession } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    ;(getSession as any).mockResolvedValue({ id: 'user-1', role: 'provider', providerId: 'provider-1' })
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
    const { getSession } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    ;(getSession as any).mockResolvedValue({ id: 'user-1', role: 'provider', providerId: 'provider-1' })
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
    const { getSession } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    ;(getSession as any).mockResolvedValue({ id: 'user-1', role: 'provider', providerId: 'provider-1' })
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
