import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    conversation: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
    },
    provider: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      // After the duplicate-record trap fix in lib/whatsapp-identity.ts
      // (Phase 4 follow-up), the resolver calls findMany. Each test that
      // sets findFirst on a provider-bearing scenario also mirrors that
      // mock onto findMany via setupProviderRow() below.
      findMany: vi.fn(),
    },
    providerApplication: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    job: {
      count: vi.fn(),
    },
    customer: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    address: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    jobRequest: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    attachment: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}))

vi.mock('@/lib/whatsapp-interactive', () => ({
  parseInbound: vi.fn((message: any) => {
    if (message.type === 'interactive') {
      if (message.interactive?.type === 'button_reply') {
        return {
          type: 'button_reply',
          id: message.interactive.button_reply?.id,
          title: message.interactive.button_reply?.title,
        }
      }
      if (message.interactive?.type === 'list_reply') {
        return {
          type: 'list_reply',
          id: message.interactive.list_reply?.id,
          title: message.interactive.list_reply?.title,
        }
      }
    }
    if (message.type === 'text') return { type: 'text', text: message.text?.body?.trim() }
    return { type: 'other' }
  }),
  sendText: vi.fn().mockResolvedValue(undefined),
  sendButtons: vi.fn().mockResolvedValue(undefined),
  sendList: vi.fn().mockResolvedValue(undefined),
  sendCtaUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/whatsapp-media', () => ({
  downloadAndStoreWhatsAppMedia: vi.fn(),
}))

vi.mock('@/lib/location-nodes', () => ({
  getProvinces: vi.fn(),
  getCities: vi.fn(),
  getRegions: vi.fn(),
  getSuburbs: vi.fn(),
  getStructuredAddressSelection: vi.fn(),
}))

vi.mock('@/lib/service-area-guard', () => ({
  isInActiveServiceArea: vi.fn(),
  isActiveProvince: vi.fn(),
  isActiveCity: vi.fn(),
  isActiveRegion: vi.fn(),
  addToServiceAreaWaitlist: vi.fn(),
}))

vi.mock('@/lib/category-config', () => ({
  resolveCategoryRequirements: vi.fn(),
}))

vi.mock('@/lib/job-requests/create-job-request', () => ({
  createJobRequest: vi.fn(),
}))

vi.mock('@/lib/structured-address', () => ({
  resolveStructuredAddressCapture: vi.fn(),
  InvalidStructuredAddressError: class InvalidStructuredAddressError extends Error {},
}))

vi.mock('@/lib/provider-record', () => ({
  syncProviderRecord: vi.fn(),
}))

vi.mock('@/lib/matching/customer-recontact', () => ({
  checkJobsForNewProviderAvailability: vi.fn(),
}))

import { showMainMenu } from '@/lib/whatsapp-flows/job-request'
import { handleRegistrationFlow } from '@/lib/whatsapp-flows/registration'
import { processInboundMessage } from '@/lib/whatsapp-bot'
import { db } from '@/lib/db'
import * as wa from '@/lib/whatsapp-interactive'

const PHONE = '+27821234567'

function listRows() {
  return vi.mocked(wa.sendList).mock.calls[0]?.[2]?.flatMap((section: any) => section.rows) ?? []
}

// Helper: mirror the same row onto BOTH findFirst AND findMany so existing
// tests written before the Phase 4 follow-up duplicate-trap fix keep working.
// The whatsapp-identity resolver now reads via findMany; some other helpers
// (e.g. menu routing) still use findFirst directly.
function setupProviderRow(row: Record<string, unknown> | null) {
  vi.mocked(db.provider.findFirst).mockResolvedValue(row as never)
  vi.mocked((db.provider as { findMany: typeof vi.fn }).findMany).mockResolvedValue(
    (row ? [row] : []) as never,
  )
}

describe('role-aware WhatsApp main menu routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupProviderRow(null)
    vi.mocked(db.providerApplication.findFirst).mockResolvedValue(null)
    vi.mocked(db.job.count).mockResolvedValue(0)
    vi.mocked(db.customer.findFirst).mockResolvedValue(null)
    vi.mocked(db.conversation.upsert).mockResolvedValue({
      phone: PHONE,
      flow: 'idle',
      step: 'welcome',
      data: {},
      expiresAt: new Date(Date.now() + 60_000),
    } as any)
  })

  it('keeps Find Work for unknown users', async () => {
    await showMainMenu(PHONE)

    const rows = listRows()
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'book' }),
      expect.objectContaining({ id: 'find_work' }),
    ]))
  })

  it('shows application status actions for pending provider applicants', async () => {
    vi.mocked(db.providerApplication.findFirst).mockResolvedValue({
      id: 'app_pending_12345678',
      name: 'Jacob Hesser',
      phone: PHONE,
      status: 'PENDING',
      skills: [],
      serviceAreas: [],
      experience: null,
      availability: null,
      providerId: null,
      submittedAt: new Date(),
    } as any)

    await showMainMenu(PHONE)

    const body = vi.mocked(wa.sendList).mock.calls[0][1]
    const rows = listRows()
    expect(body).toContain('under review')
    expect(body).toContain('12345678')
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'provider_application_status' }),
      expect.objectContaining({ id: 'provider_update_application' }),
    ]))
    expect(rows).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'book' }),
      expect.objectContaining({ id: 'find_work' }),
    ]))
  })

  it('shows customer-only menu for existing customers', async () => {
    vi.mocked(db.customer.findFirst).mockResolvedValue({
      id: 'cust_1',
      phone: PHONE,
      name: 'Sheila Dube',
      addresses: [],
    } as any)

    await showMainMenu(PHONE)

    const body = vi.mocked(wa.sendList).mock.calls[0][1]
    const rows = listRows()
    expect(body).toContain('Hi Sheila')
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'book' }),
      expect.objectContaining({ id: 'status' }),
      expect.objectContaining({ id: 'help' }),
    ]))
    expect(rows).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'find_work' }),
      expect.objectContaining({ id: 'provider_available_jobs' }),
    ]))
  })

  it('shows provider operations for approved active providers', async () => {
    vi.mocked(db.provider.findFirst).mockResolvedValue({
      id: 'prv_1',
      name: 'Jacob Hesser',
      phone: PHONE,
      status: 'ACTIVE',
      active: true,
      verified: true,
      availableNow: true,
      suspendedUntil: null,
      suspendedReason: null,
      skills: ['plumbing'],
      serviceAreas: ['Bromhof'],
    } as any)
    vi.mocked((db.provider as { findMany: typeof vi.fn }).findMany).mockResolvedValue([{
      id: 'prv_1',
      name: 'Jacob Hesser',
      phone: PHONE,
      status: 'ACTIVE',
      active: true,
      verified: true,
      availableNow: true,
      suspendedUntil: null,
      suspendedReason: null,
      skills: ['plumbing'],
      serviceAreas: ['Bromhof'],
    }] as never)

    await showMainMenu(PHONE)

    const body = vi.mocked(wa.sendList).mock.calls[0][1]
    const rows = listRows()
    expect(body).toContain('Welcome back, Jacob')
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'provider_available_jobs' }),
      expect.objectContaining({ id: 'provider_my_jobs' }),
      expect.objectContaining({ id: 'provider_check_status' }),
      expect.objectContaining({ id: 'provider_pause_leads' }),
      expect.objectContaining({ id: 'provider_worker_portal' }),
    ]))
    expect(rows).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'book' }),
      expect.objectContaining({ id: 'find_work' }),
    ]))
  })

  it('highlights active jobs for approved providers', async () => {
    vi.mocked(db.provider.findFirst).mockResolvedValue({
      id: 'prv_1',
      name: 'Jacob Hesser',
      phone: PHONE,
      status: 'ACTIVE',
      active: true,
      verified: true,
      availableNow: true,
      suspendedUntil: null,
      suspendedReason: null,
      skills: [],
      serviceAreas: [],
    } as any)
    vi.mocked((db.provider as { findMany: typeof vi.fn }).findMany).mockResolvedValue([{
      id: 'prv_1',
      name: 'Jacob Hesser',
      phone: PHONE,
      status: 'ACTIVE',
      active: true,
      verified: true,
      availableNow: true,
      suspendedUntil: null,
      suspendedReason: null,
      skills: [],
      serviceAreas: [],
    }] as never)
    vi.mocked(db.job.count).mockResolvedValue(2)

    await showMainMenu(PHONE)

    expect(vi.mocked(wa.sendList).mock.calls[0][1]).toContain('2 active jobs')
  })

  it('shows inactive provider status actions without available leads', async () => {
    vi.mocked(db.provider.findFirst).mockResolvedValue({
      id: 'prv_1',
      name: 'Jacob Hesser',
      phone: PHONE,
      status: 'SUSPENDED',
      active: false,
      verified: true,
      availableNow: false,
      suspendedUntil: null,
      suspendedReason: 'Manual review',
      skills: [],
      serviceAreas: [],
    } as any)
    vi.mocked((db.provider as { findMany: typeof vi.fn }).findMany).mockResolvedValue([{
      id: 'prv_1',
      name: 'Jacob Hesser',
      phone: PHONE,
      status: 'SUSPENDED',
      active: false,
      verified: true,
      availableNow: false,
      suspendedUntil: null,
      suspendedReason: 'Manual review',
      skills: [],
      serviceAreas: [],
    }] as never)

    await showMainMenu(PHONE)

    const body = vi.mocked(wa.sendList).mock.calls[0][1]
    const rows = listRows()
    expect(body).toContain('currently inactive')
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'provider_status' }),
      expect.objectContaining({ id: 'provider_support' }),
    ]))
    expect(rows).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'book' }),
      expect.objectContaining({ id: 'provider_available_jobs' }),
      expect.objectContaining({ id: 'find_work' }),
    ]))
  })

  it('normalizes SA phone numbers before provider lookup', async () => {
    await showMainMenu('0821234567')

    // Phase 4 follow-up: the identity resolver now uses findMany (with
    // ordering + post-filter) to avoid the duplicate-record trap. Assert
    // on the new surface; behaviour around phone normalization is unchanged.
    expect((db.provider as { findMany: typeof vi.fn }).findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          phone: { in: expect.arrayContaining(['+27821234567', '27821234567', '0821234567']) },
        },
      }),
    )
  })

  it('prevents duplicate registration when stale Find Work reaches an existing provider', async () => {
    vi.mocked(db.provider.findFirst).mockResolvedValue({
      id: 'prv_1',
      name: 'Jacob Hesser',
      phone: PHONE,
      status: 'ACTIVE',
      active: true,
      availableNow: true,
    } as any)
    vi.mocked((db.provider as { findMany: typeof vi.fn }).findMany).mockResolvedValue([{
      id: 'prv_1',
      name: 'Jacob Hesser',
      phone: PHONE,
      status: 'ACTIVE',
      active: true,
      availableNow: true,
    }] as never)

    const result = await handleRegistrationFlow({
      phone: PHONE,
      step: 'reg_start',
      flow: 'registration',
      data: {},
      reply: { type: 'button', id: 'find_work' },
    } as any)

    expect(result.nextStep).toBe('pj_toggle_available')
    expect(db.providerApplication.create).not.toHaveBeenCalled()
    expect(wa.sendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("you're already registered"),
      expect.arrayContaining([
        expect.objectContaining({ id: 'provider_my_jobs' }),
      ]),
    )
  })

  it('blocks stale Find Work actions for existing customers', async () => {
    vi.mocked(db.customer.findFirst).mockResolvedValue({
      id: 'cust_1',
      phone: PHONE,
      name: 'Sheila Dube',
      addresses: [],
    } as any)

    await processInboundMessage({
      id: 'wamid-find-work',
      from: PHONE,
      type: 'interactive',
      timestamp: '1',
      interactive: { type: 'button_reply', button_reply: { id: 'find_work', title: 'Find Work' } } as any,
    } as any)

    expect(wa.sendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('already registered as a customer'),
    )
    expect(db.providerApplication.create).not.toHaveBeenCalled()
  })

  it('blocks stale Request a Service actions for existing providers', async () => {
    vi.mocked(db.provider.findFirst).mockResolvedValue({
      id: 'prv_1',
      name: 'Jacob Hesser',
      phone: PHONE,
      status: 'ACTIVE',
      active: true,
      verified: true,
      availableNow: true,
      suspendedUntil: null,
      suspendedReason: null,
      skills: [],
      serviceAreas: [],
    } as any)
    vi.mocked((db.provider as { findMany: typeof vi.fn }).findMany).mockResolvedValue([{
      id: 'prv_1',
      name: 'Jacob Hesser',
      phone: PHONE,
      status: 'ACTIVE',
      active: true,
      verified: true,
      availableNow: true,
      suspendedUntil: null,
      suspendedReason: null,
      skills: [],
      serviceAreas: [],
    }] as never)

    await processInboundMessage({
      id: 'wamid-book',
      from: PHONE,
      type: 'interactive',
      timestamp: '1',
      interactive: { type: 'button_reply', button_reply: { id: 'book', title: 'Request a Service' } } as any,
    } as any)

    expect(wa.sendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('registered as a Plug A Pro provider'),
    )
  })
})
