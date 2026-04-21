import { vi, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    adminUser: { findUnique: vi.fn().mockResolvedValue({ id: 'admin-1', role: 'ADMIN', active: true }) },
    booking: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'bk-1', status: 'CONFIRMED', scheduledDate: new Date(),
      }),
      update: vi.fn().mockResolvedValue({ id: 'bk-1' }),
    },
    auditLog: { create: vi.fn() },
    adminAuditEvent: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({
      booking: {
        findUnique: vi.fn().mockResolvedValue({ id: 'bk-1', status: 'CONFIRMED' }),
        update: vi.fn().mockResolvedValue({ id: 'bk-1' }),
      },
      auditLog: { create: vi.fn() },
      adminAuditEvent: { create: vi.fn() },
    })),
  },
}))
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn().mockResolvedValue({ id: 'user-1' }),
  requireAdmin: vi.fn().mockResolvedValue({ id: 'user-1', adminUserId: 'admin-1', role: 'OPS' }),
}))
vi.mock('@/lib/flags', () => ({ isEnabled: vi.fn().mockResolvedValue(true) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

beforeEach(() => { vi.clearAllMocks() })

it('rescheduleBookingAction returns ok:true', async () => {
  const { rescheduleBookingAction } = await import(
    '@/app/(admin)/admin/bookings/[id]/actions'
  )
  const result = await rescheduleBookingAction({
    bookingId: 'bk-1',
    newDate: new Date(Date.now() + 86400000).toISOString(),
    reason: 'Customer requested reschedule',
  })
  expect(result.ok).toBe(true)
})
