import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    customer: { findFirst: vi.fn() },
    // After the duplicate-record trap fix (Phase 4 follow-up), the resolver
    // calls findMany so it can prefer ACTIVE+verified rows over stale ones.
    provider: { findFirst: vi.fn(), findMany: vi.fn() },
    providerApplication: { findFirst: vi.fn() },
    job: { count: vi.fn() },
  },
}))

import { db } from '@/lib/db'
import { normalizePhone, phoneLookupVariants, saLocalPhoneToE164 } from '@/lib/utils'
import { resolveWhatsAppIdentity } from '@/lib/whatsapp-identity'

describe('WhatsApp identity resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.customer.findFirst).mockResolvedValue(null)
    vi.mocked(db.provider.findFirst).mockResolvedValue(null)
    vi.mocked((db.provider as unknown as { findMany: typeof vi.fn }).findMany).mockResolvedValue([] as never)
    vi.mocked(db.providerApplication.findFirst).mockResolvedValue(null)
    vi.mocked(db.job.count).mockResolvedValue(0)
  })

  it.each([
    ['0821234567', '+27821234567'],
    ['27821234567', '+27821234567'],
    ['0027821234567', '+27821234567'],
    ['071 234 5678', '+27712345678'],
    ['071-234-5678', '+27712345678'],
    ['+27821234567', '+27821234567'],
    ['whatsapp:+27821234567', '+27821234567'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected)
  })

  // SECURITY: the webhook trust boundary uses normalizePhone(message.from).
  // A bare 9-digit national number must NOT be coerced to +27 here, otherwise a
  // spoofed/mis-routed 9-digit sender could alias an existing +27 account.
  it('keeps a bare 9-digit sender strict (no +27 aliasing at the webhook boundary)', () => {
    expect(normalizePhone('823035070')).toBe('823035070')
  })

  // The lenient 9-digit heuristic lives in the SA-local form-input helper only.
  it.each([
    ['823035070', '+27823035070'],
    ['0821234567', '+27821234567'],
    ['+27821234567', '+27821234567'],
  ])('saLocalPhoneToE164 normalizes trusted form input %s to %s', (input, expected) => {
    expect(saLocalPhoneToE164(input)).toBe(expected)
  })

  it('builds lookup variants for canonical and legacy stored phone formats', () => {
    expect(phoneLookupVariants('0027821234567')).toEqual(expect.arrayContaining([
      '+27821234567',
      '27821234567',
      '0821234567',
      '0027821234567',
    ]))
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
    vi.mocked((db.provider as unknown as { findMany: typeof vi.fn }).findMany).mockResolvedValue([
      {
        id: 'prv_1',
        phone: '+27821234567',
        name: 'Jacob Hesser',
        status: 'ACTIVE',
        active: true,
        verified: true,
        availableNow: true,
        suspendedUntil: null,
        technicianAvailability: null,
      },
    ] as any)

    await expect(resolveWhatsAppIdentity('27821234567')).resolves.toMatchObject({
      role: 'provider',
      providerId: 'prv_1',
      firstName: 'Jacob',
    })
  })

  it.each([
    'PENDING',
    'MORE_INFO_REQUIRED',
  ])('returns provider_pending for a %s provider application', async (status) => {
    vi.mocked(db.providerApplication.findFirst).mockResolvedValue({
      id: `app-${status.toLowerCase()}`,
      phone: '+27821234567',
      name: 'Kobus Terblanche',
      status,
      providerId: null,
      submittedAt: new Date(),
    } as any)

    await expect(resolveWhatsAppIdentity('+27821234567')).resolves.toMatchObject({
      role: 'provider_pending',
      applicationId: `app-${status.toLowerCase()}`,
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
    vi.mocked((db.provider as unknown as { findMany: typeof vi.fn }).findMany).mockResolvedValue([
      {
        id: 'prv_suspended',
        phone: '+27821234567',
        name: 'Thabo Nkosi',
        status: 'SUSPENDED',
        active: false,
        verified: false,
        availableNow: false,
        suspendedUntil: null,
        technicianAvailability: null,
      },
    ] as any)

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
    vi.mocked((db.provider as unknown as { findMany: typeof vi.fn }).findMany).mockResolvedValue([
      {
        id: 'prv_conflict',
        phone: '+27821234567',
        name: 'Dual Role',
        status: 'ACTIVE',
        active: true,
        verified: true,
        availableNow: true,
        suspendedUntil: null,
        technicianAvailability: null,
      },
    ] as any)

    await expect(resolveWhatsAppIdentity('+27821234567')).resolves.toMatchObject({
      conflict: true,
      // Provider wins role precedence over customer
      role: 'provider',
      customerId: 'cust_conflict',
      providerId: 'prv_conflict',
      customerDisplayName: 'Dual Role',
      customerFirstName: 'Dual',
    })
  })

  // ── Duplicate-record trap regression test (Phase 4 follow-up - Task 4) ───
  // Pre-fix: db.provider.findFirst with no orderBy returned an arbitrary row
  // when multiple Provider records existed for the same phone - sometimes the
  // stale APPLICATION_PENDING row, leading the bot to misroute the user.
  // Post-fix: findMany ordered by updatedAt desc + post-filter prefers the
  // ACTIVE+verified row, so the active provider always wins.
  it('prefers ACTIVE+verified provider over a stale pending duplicate for the same phone', async () => {
    vi.mocked((db.provider as unknown as { findMany: typeof vi.fn }).findMany).mockResolvedValue([
      // updatedAt desc means the pending row arrives first if it was touched later.
      {
        id: 'prv_stale_pending',
        phone: '+27821234567',
        name: 'Stale Pending',
        status: 'APPLICATION_PENDING',
        active: false,
        verified: false,
        availableNow: false,
        suspendedUntil: null,
        technicianAvailability: null,
      },
      {
        id: 'prv_real_active',
        phone: '+27821234567',
        name: 'Real Active',
        status: 'ACTIVE',
        active: true,
        verified: true,
        availableNow: true,
        suspendedUntil: null,
        technicianAvailability: null,
      },
    ] as any)

    const identity = await resolveWhatsAppIdentity('+27821234567')
    expect(identity.role).toBe('provider')
    expect(identity.providerId).toBe('prv_real_active')
    expect(identity.providerStatus).toBe('ACTIVE')
  })

  it('falls back to the most recent row of any status when no row is fully ACTIVE+verified', async () => {
    vi.mocked((db.provider as unknown as { findMany: typeof vi.fn }).findMany).mockResolvedValue([
      {
        id: 'prv_under_review',
        phone: '+27821234567',
        name: 'Under Review',
        status: 'UNDER_REVIEW',
        // UNDER_REVIEW means "approved app, not yet ACTIVE on the platform";
        // the row stays `active: true` so the platform can flip status when
        // ready. We assert the resolver still classifies this as pending.
        active: true,
        verified: false,
        availableNow: true,
        suspendedUntil: null,
        technicianAvailability: null,
      },
    ] as any)

    const identity = await resolveWhatsAppIdentity('+27821234567')
    expect(identity.role).toBe('provider_pending')
    expect(identity.providerId).toBe('prv_under_review')
  })

  it('deduplicates saved addresses that render identically in the WhatsApp picker', async () => {
    vi.mocked(db.customer.findFirst).mockResolvedValue({
      id: 'cust_sarah',
      phone: '+27773923802',
      name: 'Sarah Sullivan',
      addresses: [
        {
          id: 'addr_with_unit',
          street: 'Unit 21, 21 Jump Street',
          addressLine1: '21 Jump Street',
          suburb: 'Constantia Kloof',
          region: 'JHB West / Roodepoort',
          city: 'Johannesburg',
          province: 'Gauteng',
          postalCode: '1709',
          locationNodeId: 'sub_constantia_kloof',
          isDefault: false,
        },
        {
          id: 'addr_plain',
          street: '21 Jump Street',
          addressLine1: '21 Jump Street',
          suburb: 'Constantia Kloof',
          region: 'JHB West / Roodepoort',
          city: 'Johannesburg',
          province: 'Gauteng',
          postalCode: '1709',
          locationNodeId: 'sub_constantia_kloof',
          isDefault: false,
        },
      ],
    } as any)

    const identity = await resolveWhatsAppIdentity('+27773923802')

    expect(identity.savedAddresses).toHaveLength(1)
    expect(identity.savedAddresses[0]).toMatchObject({
      id: 'addr_with_unit',
      addressLine1: '21 Jump Street',
      suburb: 'Constantia Kloof',
    })
  })

  it('deduplicates visible address matches even when hidden location metadata differs', async () => {
    vi.mocked(db.customer.findFirst).mockResolvedValue({
      id: 'cust_sarah',
      phone: '+27773923802',
      name: 'Sarah Sullivan',
      addresses: [
        {
          id: 'addr_structured',
          street: '21 Jump Street',
          addressLine1: '21 Jump Street',
          suburb: 'Constantia Kloof',
          region: 'JHB West / Roodepoort',
          city: 'Johannesburg',
          province: 'Gauteng',
          postalCode: '1709',
          locationNodeId: 'sub_constantia_kloof',
          isDefault: false,
        },
        {
          id: 'addr_legacy',
          street: '21 Jump Street',
          addressLine1: '21 Jump Street',
          suburb: 'Constantia Kloof',
          region: null,
          city: 'Johannesburg',
          province: 'Gauteng',
          postalCode: null,
          locationNodeId: null,
          isDefault: false,
        },
      ],
    } as any)

    const identity = await resolveWhatsAppIdentity('+27773923802')

    expect(identity.savedAddresses).toHaveLength(1)
    expect(identity.savedAddresses[0]).toMatchObject({
      id: 'addr_structured',
      postalCode: '1709',
      locationNodeId: 'sub_constantia_kloof',
    })
  })
})
