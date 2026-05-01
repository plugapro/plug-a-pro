import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    customer: { findFirst: vi.fn() },
    provider: { findFirst: vi.fn() },
    providerApplication: { findFirst: vi.fn() },
    job: { count: vi.fn() },
  },
}))

import { db } from '@/lib/db'
import { normalizePhone } from '@/lib/utils'
import { resolveWhatsAppIdentity } from '@/lib/whatsapp-identity'

describe('WhatsApp identity resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.customer.findFirst).mockResolvedValue(null)
    vi.mocked(db.provider.findFirst).mockResolvedValue(null)
    vi.mocked(db.providerApplication.findFirst).mockResolvedValue(null)
    vi.mocked(db.job.count).mockResolvedValue(0)
  })

  it.each([
    ['0821234567', '+27821234567'],
    ['27821234567', '+27821234567'],
    ['+27821234567', '+27821234567'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected)
  })

  it('returns customer for an existing customer number', async () => {
    vi.mocked(db.customer.findFirst).mockResolvedValue({
      id: 'cust_1',
      phone: '+27821234567',
      name: 'Sheila Dube',
      addresses: [],
    } as any)

    await expect(resolveWhatsAppIdentity('0821234567')).resolves.toMatchObject({
      normalizedPhone: '+27821234567',
      role: 'customer',
      customerId: 'cust_1',
      firstName: 'Sheila',
    })
  })

  it('returns provider for an approved active provider number', async () => {
    vi.mocked(db.provider.findFirst).mockResolvedValue({
      id: 'prv_1',
      phone: '+27821234567',
      name: 'Jacob Hesser',
      status: 'ACTIVE',
      active: true,
      availableNow: true,
      suspendedUntil: null,
      technicianAvailability: null,
    } as any)

    await expect(resolveWhatsAppIdentity('27821234567')).resolves.toMatchObject({
      role: 'provider',
      providerId: 'prv_1',
      firstName: 'Jacob',
    })
  })

  it('returns provider_pending for a pending provider application', async () => {
    vi.mocked(db.providerApplication.findFirst).mockResolvedValue({
      id: 'app_1',
      phone: '+27821234567',
      name: 'Kobus Terblanche',
      status: 'PENDING',
      providerId: null,
      submittedAt: new Date(),
    } as any)

    await expect(resolveWhatsAppIdentity('+27821234567')).resolves.toMatchObject({
      role: 'provider_pending',
      applicationId: 'app_1',
      firstName: 'Kobus',
    })
  })

  it('returns unknown for a new number', async () => {
    await expect(resolveWhatsAppIdentity('+27821234567')).resolves.toMatchObject({
      role: 'unknown',
      normalizedPhone: '+27821234567',
    })
  })

  it('returns provider_inactive for a suspended provider', async () => {
    vi.mocked(db.provider.findFirst).mockResolvedValue({
      id: 'prv_suspended',
      phone: '+27821234567',
      name: 'Thabo Nkosi',
      status: 'SUSPENDED',
      active: false,
      availableNow: false,
      suspendedUntil: null,
      technicianAvailability: null,
    } as any)

    await expect(resolveWhatsAppIdentity('+27821234567')).resolves.toMatchObject({
      role: 'provider_inactive',
      providerId: 'prv_suspended',
    })
  })

  it('sets conflict: true when the same phone is registered as both customer and provider', async () => {
    vi.mocked(db.customer.findFirst).mockResolvedValue({
      id: 'cust_conflict',
      phone: '+27821234567',
      name: 'Dual Role',
      addresses: [],
    } as any)
    vi.mocked(db.provider.findFirst).mockResolvedValue({
      id: 'prv_conflict',
      phone: '+27821234567',
      name: 'Dual Role',
      status: 'ACTIVE',
      active: true,
      availableNow: true,
      suspendedUntil: null,
      technicianAvailability: null,
    } as any)

    await expect(resolveWhatsAppIdentity('+27821234567')).resolves.toMatchObject({
      conflict: true,
      // Provider wins role precedence over customer
      role: 'provider',
      customerId: 'cust_conflict',
      providerId: 'prv_conflict',
    })
  })
})
